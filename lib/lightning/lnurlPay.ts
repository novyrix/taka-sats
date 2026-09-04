// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The network half of LNURL-pay (LUD-06): resolve a code and, once resolved,
 * request an invoice for a specific amount. Every provider's
 * `resolveReceiveAddress` and the LNURL leg of `pay()` go through here so the
 * receive-only guarantee (M1-10) is enforced in exactly one place.
 *
 * `fetchImpl` is injectable so tests never make a real network call.
 * Zero framework imports (D-04).
 */

import { sats, type Sats } from '@/lib/money';
import { InvalidLightningAddressError, NotReceiveCapableError } from './errors';
import { normalizeToResolvableUrl } from './lnurl';
import type { ResolvedAddress } from './LightningProvider';

export type FetchLike = typeof fetch;

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

async function fetchJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new InvalidLightningAddressError(
      `Could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new InvalidLightningAddressError(`${url} returned HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new InvalidLightningAddressError(`${url} did not return valid JSON`);
  }
}

/**
 * Resolve a raw scanned/submitted code to a {@link ResolvedAddress}.
 *
 * @throws {InvalidLightningAddressError} if the code cannot be normalised or resolved.
 * @throws {NotReceiveCapableError} if it resolves to anything but a `payRequest`
 *   (in particular a withdraw `LNURLw` code — never accepted, ADR-0001).
 */
export async function resolveLnurlPay(
  raw: string,
  fetchImpl: FetchLike = fetch,
): Promise<ResolvedAddress> {
  const url = normalizeToResolvableUrl(raw);
  const body = await fetchJson(url, fetchImpl);

  if (isErrorResponse(body)) {
    throw new InvalidLightningAddressError(`${url} rejected the request: ${body.reason}`);
  }
  if (!isPayResponse(body)) {
    throw new InvalidLightningAddressError(`${url} did not return a valid LNURL response`);
  }
  if (body.tag !== 'payRequest') {
    throw new NotReceiveCapableError(
      `${raw} resolved to a "${body.tag}" code, not a receive-capable payRequest`,
    );
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
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const separator = callback.includes('?') ? '&' : '?';
  const url = `${callback}${separator}amount=${amount * 1000}`;
  const body = await fetchJson(url, fetchImpl);

  if (isErrorResponse(body)) {
    throw new InvalidLightningAddressError(`Invoice request rejected: ${body.reason}`);
  }
  const pr = (body as { pr?: unknown }).pr;
  if (typeof pr !== 'string' || pr.length === 0) {
    throw new InvalidLightningAddressError('LNURL callback did not return an invoice');
  }
  return pr;
}

/** Resolve a code and immediately request an invoice for `amount` sats. */
export async function requestInvoiceFor(
  raw: string,
  amount: Sats,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const url = normalizeToResolvableUrl(raw);
  const body = await fetchJson(url, fetchImpl);

  if (isErrorResponse(body)) {
    throw new InvalidLightningAddressError(`${url} rejected the request: ${body.reason}`);
  }
  if (!isPayResponse(body) || body.tag !== 'payRequest') {
    throw new NotReceiveCapableError(`${raw} is not a receive-capable payRequest`);
  }

  return requestLnurlInvoice(body.callback, amount, fetchImpl);
}
