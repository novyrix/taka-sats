// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The single home for sats arithmetic (REQUIREMENTS §12, Code Style Guide §9).
 *
 * Rules encoded here:
 *  - Sats are a branded integer type, constructed only through {@link sats}.
 *  - {@link computePayout} is the ONLY function that turns weight + rate into an
 *    amount. `weight * rate` anywhere else in the codebase is a bug.
 *  - Payout *destination* is never an argument here — it is resolved server-side
 *    from the tag mapping by the caller (§12.3).
 *
 * Zero framework imports (D-04). The payout body is intentionally unimplemented
 * until M5-2; the signature and the contract are frozen now so callers and
 * tests can be written against them.
 */

/** 1 BTC = 100,000,000 sats. A protocol constant, not an operational tunable. */
export const SATS_PER_BTC = 100_000_000;

/** Integer number of satoshis. Never construct directly — use {@link sats}. */
export type Sats = number & { readonly __brand: 'Sats' };

/** Thrown by code paths that are specified but not yet built. */
export class NotYetImplemented extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotYetImplemented';
  }
}

/** Thrown when a value cannot be a valid sat amount or payout input. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/**
 * Validate and brand a satoshi amount: a non-negative safe integer.
 * @throws {MoneyError} on a negative, fractional, non-finite, or unsafe value.
 */
export function sats(value: number): Sats {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`sats must be a finite number, received ${value}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError(`sats must be an integer, received ${value}`);
  }
  if (value < 0) {
    throw new MoneyError(`sats must be non-negative, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`sats exceeds the safe integer range, received ${value}`);
  }
  return value as Sats;
}

/** A BTC price observation used to convert a fiat amount to sats (D-14, D-18). */
export type ExchangeSnapshot = {
  /** Opaque id of the persisted `exchange_rate_snapshots` row. */
  readonly id: string;
  /** Price of 1 BTC in fiat *minor* units (e.g. KES cents). Positive integer. */
  readonly fiatMinorPerBtc: number;
  /** When the price was observed. */
  readonly capturedAt: Date;
};

export type ComputePayoutInput = {
  /** Weighed mass in kilograms; `NUMERIC(6,3)` in the schema, so ≤ 3 decimals. */
  readonly weightKg: number;
  /** Active rate at `recordedAt`, in fiat minor units per kg (D-14). */
  readonly rateFiatMinorPerKg: number;
  /** The BTC price snapshot the payout is computed against. */
  readonly exchange: ExchangeSnapshot;
  /** Reject the snapshot if older than this many seconds (D-18). */
  readonly rateStalenessTtlSeconds: number;
  /** Reference time for the staleness check; defaults to now. */
  readonly now?: Date;
};

/**
 * Compute the payout for one verified collection event, in sats, at the given
 * BTC price snapshot.
 *
 * Contract (to be honoured by the M5-2 implementation):
 *  - `fiatMinor = weightKg * rateFiatMinorPerKg`, then
 *    `sats = round(fiatMinor / fiatMinorPerBtc * SATS_PER_BTC)`.
 *  - Rejects: negative or non-finite `weightKg`; `weightKg` with > 3 decimals;
 *    `rateFiatMinorPerKg <= 0`; non-positive `fiatMinorPerBtc`; a snapshot
 *    older than `rateStalenessTtlSeconds`.
 *  - Returns a value built through {@link sats}; rounding half-up to a whole sat.
 *  - Deterministic: same inputs → same output, no clock read beyond `now`.
 *
 * @throws {NotYetImplemented} until M5-2.
 */
export function computePayout(_input: ComputePayoutInput): Sats {
  throw new NotYetImplemented(
    'computePayout is specified in REQUIREMENTS §12 but not implemented until M5-2',
  );
}
