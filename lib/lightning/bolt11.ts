// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Read the amount out of a BOLT11 invoice — pure, no network, no signature check (the
 * paying rail verifies the invoice fully; this is only the guard that what we are about to
 * pay is the amount we decided to pay).
 *
 * Why it exists: the LNURL callback is chosen by whoever owns the destination. A hostile or
 * buggy server can answer `?amount=21000` with an invoice for a hundred times that, and rails
 * pay an invoice's own amount. `requestLnurlInvoice` therefore refuses any invoice whose
 * amount is not exactly the one requested.
 *
 * Format (BOLT11): human-readable part `ln` + network (`bc`, `tb`, `tbs`, `bcrt`) + optional
 * amount (digits + optional multiplier `m`/`u`/`n`/`p`, in BTC), a `1` separator, then data.
 */

import { bech32 } from 'bech32';

const HRP = /^ln(?:bcrt|bc|tbs|tb)(?:(\d+)([munp])?)?$/;

/** Invoices run to ~1 KiB+; bech32's default 90-char limit would reject every real one. */
const BECH32_LIMIT = 4000;

const MSAT_PER_BTC = 100_000_000_000n;

/** BTC-per-unit denominators for each multiplier (1 BTC = 10^3 mBTC = 10^6 µBTC = 10^9 nBTC = 10^12 pBTC). */
const DIVISOR: Record<string, bigint> = {
  m: 1_000n,
  u: 1_000_000n,
  n: 1_000_000_000n,
  p: 1_000_000_000_000n,
};

/**
 * The invoice amount in millisatoshis, or `null` for a zero-amount (payer-chooses) invoice.
 * @throws {Error} the string is not a well-formed BOLT11 invoice.
 */
export function bolt11AmountMsat(invoice: string): bigint | null {
  const text = invoice
    .trim()
    .toLowerCase()
    .replace(/^lightning:/, '');
  let hrp: string;
  try {
    hrp = bech32.decode(text, BECH32_LIMIT).prefix;
  } catch {
    throw new Error('not a valid BOLT11 invoice');
  }

  const match = HRP.exec(hrp);
  if (!match) {
    throw new Error('not a BOLT11 invoice');
  }
  const [, digits, multiplier] = match;
  if (digits === undefined) {
    return null;
  }
  if (digits.length > 1 && digits.startsWith('0')) {
    throw new Error('BOLT11 amount has a leading zero');
  }

  const amount = BigInt(digits);
  if (multiplier === undefined) {
    return amount * MSAT_PER_BTC;
  }
  const msat = (amount * MSAT_PER_BTC) / (DIVISOR[multiplier] as bigint);
  // 'p' amounts must be a multiple of 10 (a tenth of a millisatoshi is not payable).
  if ((amount * MSAT_PER_BTC) % (DIVISOR[multiplier] as bigint) !== 0n) {
    throw new Error('BOLT11 amount is not a whole number of millisatoshis');
  }
  return msat;
}
