// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The single home for sats arithmetic (REQUIREMENTS §12, Code Style Guide §9).
 *
 * Rules encoded here:
 *  - Sats are a branded integer type, constructed only through {@link sats}.
 *  - {@link computePayoutDetail} (and {@link computePayout}, its sats-only wrapper) is
 *    the ONLY code that turns weight + rate into an amount. `weight * rate` anywhere
 *    else in the codebase is a bug.
 *  - Payout *destination* is never an argument here — it is resolved server-side
 *    from the tag mapping by the caller (§12.3).
 *
 * Zero framework imports (D-04). All arithmetic is exact integer maths (BigInt for
 * the products), never floating point — see {@link computePayoutDetail}.
 */

/** 1 BTC = 100,000,000 sats. A protocol constant, not an operational tunable. */
export const SATS_PER_BTC = 100_000_000;

/**
 * Decimal places of a fiat minor unit (KES cents: 2). Rates (`material_rates`) and payout
 * amounts are stored in minor units; the exchange feed quotes BTC in major units.
 */
export const FIAT_MINOR_DECIMALS = 2;

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

/** The two figures a payout row stores: what was earned in fiat, and what is sent in sats. */
export type PayoutAmounts = {
  readonly sats: Sats;
  /** `weight × rate`, rounded half-up to a whole fiat minor unit. */
  readonly fiatMinor: number;
};

const MILLI = 1000n;
const BTC_SATS = BigInt(SATS_PER_BTC);

/** Integer division rounding half-up — operands are non-negative. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (2n * numerator + denominator) / (2n * denominator);
}

/** A positive safe integer, or a {@link MoneyError} naming the field. */
function positiveInteger(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new MoneyError(`${name} must be a positive integer, received ${value}`);
  }
  return BigInt(value);
}

/**
 * Whole milli-kilograms of a weight with ≤ 3 decimals. Parsed from the number's
 * shortest decimal string rather than multiplied by 1000, so `1.005` is exactly
 * 1005 and `1.0005` (or an exponent form like `1e-7`) is rejected.
 */
function milliKg(weightKg: number): bigint {
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    throw new MoneyError(`weightKg must be a positive finite number, received ${weightKg}`);
  }
  const match = /^(\d+)(?:\.(\d{1,3}))?$/.exec(String(weightKg));
  if (!match) {
    throw new MoneyError(`weightKg must have at most 3 decimal places, received ${weightKg}`);
  }
  return BigInt(match[1] ?? '0') * MILLI + BigInt((match[2] ?? '').padEnd(3, '0'));
}

/**
 * The ONE arithmetic core of a payout (REQUIREMENTS §12.2). Everything is exact
 * integer maths:
 *
 *   fiatMinor = round_half_up(weightKg × rateFiatMinorPerKg)
 *   sats      = round_half_up(fiatMinor × SATS_PER_BTC / fiatMinorPerBtc)
 *
 * The sats figure derives from the rounded `fiatMinor`, so a stored payout row is
 * reproducible from its own `amount_fiat_minor` and its snapshot's price.
 *
 * Rejects (every one a {@link MoneyError}): a non-positive, non-finite or
 * >3-decimal weight; a non-positive rate or BTC price; a snapshot older than
 * `rateStalenessTtlSeconds`; a result of 0 fiat minor units or 0 sats (a payout
 * that would send nothing is an error, not a no-op); a result beyond the safe
 * integer range.
 */
export function computePayoutDetail(input: ComputePayoutInput): PayoutAmounts {
  const milli = milliKg(input.weightKg);
  const rate = positiveInteger(input.rateFiatMinorPerKg, 'rateFiatMinorPerKg');
  const price = positiveInteger(input.exchange.fiatMinorPerBtc, 'exchange.fiatMinorPerBtc');

  if (!Number.isFinite(input.rateStalenessTtlSeconds) || input.rateStalenessTtlSeconds < 0) {
    throw new MoneyError('rateStalenessTtlSeconds must be a non-negative number');
  }
  const ageMs = (input.now ?? new Date()).getTime() - input.exchange.capturedAt.getTime();
  if (!(ageMs <= input.rateStalenessTtlSeconds * 1000)) {
    throw new MoneyError(
      `exchange snapshot is stale (older than ${input.rateStalenessTtlSeconds}s) or has an invalid timestamp`,
    );
  }

  const fiatMinor = divRoundHalfUp(milli * rate, MILLI);
  if (fiatMinor === 0n) {
    throw new MoneyError('payout rounds to 0 fiat minor units');
  }
  const satsAmount = divRoundHalfUp(fiatMinor * BTC_SATS, price);
  if (satsAmount === 0n) {
    throw new MoneyError('payout rounds to 0 sats');
  }
  if (satsAmount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError('payout exceeds the safe integer range');
  }
  return { sats: sats(Number(satsAmount)), fiatMinor: Number(fiatMinor) };
}

/** The payout amount in sats — see {@link computePayoutDetail}, the single arithmetic core. */
export function computePayout(input: ComputePayoutInput): Sats {
  return computePayoutDetail(input).sats;
}

/**
 * Convert a snapshot's price — `exchange_rate_snapshots.rate`, a numeric string in fiat
 * MAJOR units per 1 BTC (e.g. `'5000000'` or `'5012345.678'`) — to a positive integer of
 * fiat MINOR units, rounded half-up. String maths, so no float drift on the way in.
 */
export function fiatMinorPerBtcFromMajor(rateMajor: string): number {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(rateMajor.trim());
  if (!match) {
    throw new MoneyError(`exchange rate must be a plain decimal string, received "${rateMajor}"`);
  }
  const fraction = (match[2] ?? '').padEnd(FIAT_MINOR_DECIMALS + 1, '0');
  const kept = BigInt((match[1] ?? '0') + fraction.slice(0, FIAT_MINOR_DECIMALS));
  // The first dropped digit decides the rounding (half-up).
  const minor = Number(fraction[FIAT_MINOR_DECIMALS]) >= 5 ? kept + 1n : kept;
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MoneyError(`exchange rate is out of range: "${rateMajor}"`);
  }
  return Number(minor);
}
