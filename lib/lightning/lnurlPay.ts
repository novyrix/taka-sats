// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The network half of LNURL-pay (LUD-06): resolve a code and, once resolved,
 * request an invoice for a specific amount. Every provider's
 * `resolveReceiveAddress` and the LNURL leg of `pay()` go through here so the
 * receive-only guarantee (M1-10) is enforced in exactly one place.
 *
 * The targets are attacker-influenced (a scanned code, and the `callback` a
 * remote LNURL server returns), so every request is guarded: public-https
 * only (static checks in `lnurl.ts`, plus a DNS check that every resolved
 * address is public), a per-request timeout (`lightning.lnurl_timeout_ms`),
 * redirects never followed, and the response capped at 64 KiB before parsing.
 *
 * Residual risk: the DNS check and the connection are two separate lookups, so
 * a DNS-rebinding server could answer "public" to the first and "private" to
 * the second. Closing that needs the connection pinned to the checked address,
 * which `fetch` cannot do without a custom dispatcher (a new dependency).
 * Documented in docs/THREAT_MODEL.md.
 *
 * `fetchImpl` is injectable so tests never make a real network call; the DNS
 * check is skipped when one is injected. Zero framework imports (D-04).
 */

import { lookup } from 'node:dns/promises';
import { getSettings } from '@/lib/config';
import { sats, type Sats } from '@/lib/money';
import {
  InvalidLightningAddressError,
  InvoiceMismatchError,
  LightningEndpointUnreachableError,
  NotReceiveCapableError,
  UnsafeLnurlTargetError,
} from './errors';
import { bolt11AmountMsat } from './bolt11';
import { describeHost, isPublicIp, normalizeToResolvableUrl, parseLnurlUrl } from './lnurl';
import type { LnurlPolicy } from './lnurl';
import type { ResolvedAddress } from './LightningProvider';

export type FetchLike = typeof fetch;

const MAX_RESPONSE_BYTES = 64 * 1024;

type LnurlErrorResponse = { status: 'ERROR'; reason: string };

type LnurlPayResponse = {
  tag: string;
  callback: string;
  minSendable: number;
  maxSendable: number;
  metadata: string;
};

function isErrorResponse(body: unknown): body is LnurlErrorResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    'status' in body &&
    (body as { status?: unknown }).status === 'ERROR'
  );
}

function isPayResponse(body: unknown): body is LnurlPayResponse {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as { tag?: unknown }).tag === 'string' &&
    typeof (body as { callback?: unknown }).callback === 'string'
  );
}

function lnurlPolicy(): LnurlPolicy & { readonly timeoutMs: number } {
  const { spend_link_hosts, lnurl_timeout_ms } = getSettings().lightning;
  return { spendLinkHosts: spend_link_hosts, timeoutMs: lnurl_timeout_ms };
}

/** Reject if `host` resolves to any non-public address; DNS failure is transient. */
async function assertResolvesPublic(host: string, signal: AbortSignal): Promise<void> {
  if (/^[\d.]+$|^\[/.test(host)) {
    return; // an IP literal — already vetted statically by parseLnurlUrl
  }
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  let addresses: { address: string }[];
  try {
    addresses = await Promise.race([lookup(host, { all: true, verbatim: true }), aborted]);
  } catch {
    throw signal.aborted
      ? signal.reason
      : new LightningEndpointUnreachableError(`Could not resolve ${host}`);
  }
  if (addresses.length === 0 || !addresses.every(({ address }) => isPublicIp(address))) {
    throw new UnsafeLnurlTargetError(`${host} does not resolve to a public internet address`);
  }
}

/** Read the body as text, giving up past {@link MAX_RESPONSE_BYTES}. */
async function readBounded(response: Response, host: string): Promise<string> {
  const tooLarge = () => new InvalidLightningAddressError(`${host} returned an oversize response`);
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return '';
  }

  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return text + decoder.decode();
    }
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
}

/**
 * GET `url` (already vetted by {@link parseLnurlUrl}) and parse the JSON body.
 * Transient failures (DNS, network, timeout, 5xx/429) → {@link LightningEndpointUnreachableError};
 * definitive ones (redirect, 4xx, oversize, non-JSON) → {@link InvalidLightningAddressError}.
 */
async function fetchJson(url: string, fetchImpl?: FetchLike): Promise<unknown> {
  const host = describeHost(url);
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new LightningEndpointUnreachableError(`Timed out contacting ${host}`)),
    lnurlPolicy().timeoutMs,
  );

  try {
    if (!fetchImpl) {
      await assertResolvesPublic(host, controller.signal);
    }

    let response: Response;
    try {
      response = await (fetchImpl ?? fetch)(url, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
    } catch {
      throw controller.signal.aborted
        ? controller.signal.reason
        : new LightningEndpointUnreachableError(`Could not reach ${host}`);
    }

    if (response.status >= 300 && response.status < 400) {
      throw new InvalidLightningAddressError(
        `${host} redirected the request; redirects are not followed`,
      );
    }
    if (response.status >= 500 || response.status === 429) {
      throw new LightningEndpointUnreachableError(`${host} returned HTTP ${response.status}`);
    }
    if (!response.ok) {
      throw new InvalidLightningAddressError(`${host} returned HTTP ${response.status}`);
    }

    let text: string;
    try {
      text = await readBounded(response, host);
    } catch (error) {
      if (error instanceof InvalidLightningAddressError) {
        throw error;
      }
      throw controller.signal.aborted
        ? controller.signal.reason
        : new LightningEndpointUnreachableError(`Connection to ${host} dropped`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new InvalidLightningAddressError(`${host} did not return valid JSON`);
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch a pay-request URL and require a `payRequest`; a withdraw code is never accepted (ADR-0001). */
async function fetchPayRequest(
  raw: string,
  fetchImpl: FetchLike | undefined,
): Promise<{ host: string; body: LnurlPayResponse }> {
  const url = normalizeToResolvableUrl(raw, lnurlPolicy());
  const host = describeHost(url);
  const body = await fetchJson(url, fetchImpl);

  if (isErrorResponse(body)) {
    throw new InvalidLightningAddressError(`${host} rejected the request`);
  }
  if (!isPayResponse(body)) {
    throw new InvalidLightningAddressError(`${host} did not return a valid LNURL response`);
  }
  if (body.tag !== 'payRequest') {
    throw new NotReceiveCapableError(
      `${host} resolved to a "${body.tag.slice(0, 32)}" code, not a receive-capable payRequest`,
    );
  }
  return { host, body };
}

/**
 * Resolve a raw scanned/submitted code to a {@link ResolvedAddress}.
 *
 * @throws {SpendCredentialRejectedError} for a known spend-link host (before any network call).
 * @throws {UnsafeLnurlTargetError} for a non-public or non-https target.
 * @throws {LightningEndpointUnreachableError} on a transient network/server failure.
 * @throws {InvalidLightningAddressError} if the code cannot be normalised or resolved.
 * @throws {NotReceiveCapableError} if it resolves to anything but a `payRequest`
 *   (in particular a withdraw `LNURLw` code — never accepted, ADR-0001).
 */
export async function resolveLnurlPay(
  raw: string,
  fetchImpl?: FetchLike,
): Promise<ResolvedAddress> {
  const { host, body } = await fetchPayRequest(raw, fetchImpl);
  if (!Number.isFinite(body.minSendable) || !Number.isFinite(body.maxSendable)) {
    throw new InvalidLightningAddressError(`${host} did not return a sendable range`);
  }

  return {
    lnurlOrAddress: raw,
    receiveCapable: true,
    minSendableSats: sats(Math.ceil(body.minSendable / 1000)),
    maxSendableSats: sats(Math.floor(body.maxSendable / 1000)),
  };
}

/** Request a bolt11 invoice for `amount` sats from an already-resolved pay callback. */
export async function requestLnurlInvoice(
  callback: string,
  amount: Sats,
  fetchImpl?: FetchLike,
): Promise<string> {
  // The callback comes from a remote server — vet it exactly like a scanned URL.
  const base = parseLnurlUrl(callback, lnurlPolicy()).href;
  const separator = base.includes('?') ? '&' : '?';
  const body = await fetchJson(`${base}${separator}amount=${amount * 1000}`, fetchImpl);

  if (isErrorResponse(body)) {
    throw new InvalidLightningAddressError('Invoice request rejected');
  }
  const pr = (body as { pr?: unknown }).pr;
  if (typeof pr !== 'string' || pr.length === 0) {
    throw new InvalidLightningAddressError('LNURL callback did not return an invoice');
  }

  // The destination chose this invoice — and rails pay an invoice's own amount. Refuse anything
  // that is not exactly what we asked for, before it can reach a rail.
  let invoiceMsat: bigint | null;
  try {
    invoiceMsat = bolt11AmountMsat(pr);
  } catch {
    throw new InvoiceMismatchError('The wallet returned something that is not a valid invoice');
  }
  if (invoiceMsat !== BigInt(amount) * 1000n) {
    throw new InvoiceMismatchError('The wallet returned an invoice for a different amount');
  }
  return pr;
}

/** Resolve a code and immediately request an invoice for `amount` sats. */
export async function requestInvoiceFor(
  raw: string,
  amount: Sats,
  fetchImpl?: FetchLike,
): Promise<string> {
  const { body } = await fetchPayRequest(raw, fetchImpl);
  const msat = amount * 1000;
  if (msat < body.minSendable || msat > body.maxSendable) {
    throw new InvoiceMismatchError("The amount is outside the wallet's sendable range");
  }
  return requestLnurlInvoice(body.callback, amount, fetchImpl);
}
