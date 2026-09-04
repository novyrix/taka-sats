// SPDX-License-Identifier: AGPL-3.0-only

/**
 * LNURL / Lightning Address normalisation (LUD-01, LUD-16) — pure, no I/O.
 *
 * Turns whatever a collector's QR or a submitted string contains into the
 * single HTTPS URL a provider fetches to learn whether the code is
 * receive-capable (§7.1 Path A step 2). Actually fetching that URL, and
 * rejecting a resolved `withdrawRequest`, happens in `lnurlPay.ts` — this
 * file never makes a network call, so it is fully unit-testable. Zero
 * framework imports (D-04).
 */

import { bech32 } from 'bech32';
import { InvalidLightningAddressError } from './errors';

// LNURL bech32 strings encode a full URL and routinely exceed bech32's
// default 90-character limit — decode with a generous ceiling instead.
const BECH32_LIMIT = 4000;

const LIGHTNING_ADDRESS_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

export function isLightningAddress(input: string): boolean {
  return LIGHTNING_ADDRESS_PATTERN.test(input.trim());
}

export function isLnurlBech32(input: string): boolean {
  return /^lnurl1[02-9ac-hj-np-z]+$/i.test(input.trim());
}

/** `name@domain` → the LUD-16 well-known LNURL-pay URL. */
export function lightningAddressToUrl(address: string): string {
  const trimmed = address.trim();
  if (!isLightningAddress(trimmed)) {
    throw new InvalidLightningAddressError(`Not a valid Lightning Address: ${address}`);
  }
  const [localPart, domain] = trimmed.split('@');
  return `https://${domain}/.well-known/lnurlp/${encodeURIComponent(localPart ?? '')}`;
}

/** Decode an `lnurl1…` bech32 string to the URL it encodes (LUD-01). */
export function decodeLnurlBech32(encoded: string): string {
  const trimmed = encoded.trim();
  let decoded: { prefix: string; words: number[] };
  try {
    decoded = bech32.decode(trimmed, BECH32_LIMIT);
  } catch (error) {
    throw new InvalidLightningAddressError(
      `Could not decode LNURL bech32 string: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (decoded.prefix.toLowerCase() !== 'lnurl') {
    throw new InvalidLightningAddressError(
      `Not an LNURL bech32 string (prefix "${decoded.prefix}")`,
    );
  }

  const bytes = Uint8Array.from(bech32.fromWords(decoded.words));
  const url = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!/^https?:\/\//i.test(url)) {
    throw new InvalidLightningAddressError('Decoded LNURL payload is not an http(s) URL');
  }
  return url;
}

/**
 * Normalise whatever a collector's QR or a submitted string contains — a
 * Lightning Address, an `lnurl1…` bech32 string (optionally prefixed
 * `lightning:`), or an already-resolvable `https://` LNURL-pay URL — into
 * the URL to fetch next.
 */
export function normalizeToResolvableUrl(raw: string): string {
  const trimmed = raw.trim().replace(/^lightning:/i, '');

  if (isLightningAddress(trimmed)) {
    return lightningAddressToUrl(trimmed);
  }
  if (isLnurlBech32(trimmed)) {
    return decodeLnurlBech32(trimmed);
  }
  if (/^https:\/\//i.test(trimmed)) {
    return trimmed;
  }

  throw new InvalidLightningAddressError(
    `Unrecognised Lightning code — not a Lightning Address, LNURL, or https URL: ${raw}`,
  );
}
