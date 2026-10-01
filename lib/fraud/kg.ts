// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Exact kilogram arithmetic. Weights are stored as `numeric(_, 3)` (milli-kg); summing them
 * as floats would drift, so reconciliation sums in Postgres and does the rest here in
 * integer milli-kg (`bigint`). Pure — no database, no framework (D-04).
 */

/** Parse a Postgres `numeric` text (`"12.5"`, `"-0.250"`) — or a ≤ 3-decimal number — into milli-kg. */
export function toMilli(kg: string | number): bigint {
  const text = typeof kg === 'number' ? kg.toFixed(3) : kg.trim();
  const match = /^(-)?(\d+)(?:\.(\d*))?$/.exec(text);
  if (!match) {
    throw new RangeError(`not a kilogram value: "${text}"`);
  }
  const [, sign, whole = '0', fraction = ''] = match;
  if (/[1-9]/.test(fraction.slice(3))) {
    throw new RangeError(`more than 3 decimals: "${text}"`);
  }
  const milli = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0').slice(0, 3));
  return sign ? -milli : milli;
}

/** Milli-kg as a 3-decimal string (`12500n` → `"12.500"`), the form Postgres `numeric(_, 3)` takes. */
export function fromMilli(milli: bigint): string {
  const abs = milli < 0n ? -milli : milli;
  const text = `${abs / 1000n}.${String(abs % 1000n).padStart(3, '0')}`;
  return milli < 0n ? `-${text}` : text;
}

/** Integer division rounding half away from zero. `denominator` must be positive. */
function divideRound(numerator: bigint, denominator: bigint): bigint {
  const half = denominator / 2n;
  return numerator >= 0n ? (numerator + half) / denominator : -((-numerator + half) / denominator);
}

/** `numerator / denominator × 100` as a 3-decimal percentage string; `"0.000"` when the denominator is 0. */
export function percentOf(numeratorMilli: bigint, denominatorMilli: bigint): string {
  if (denominatorMilli === 0n) {
    return '0.000';
  }
  return fromMilli(divideRound(numeratorMilli * 100_000n, denominatorMilli));
}

/**
 * Is `|variance| / collected × 100` strictly above `tolerancePct`? Compared in integers
 * (cross-multiplied), so a variance exactly at the tolerance is within it and no rounding
 * of the displayed percentage can flip the answer.
 */
export function exceedsTolerance(
  varianceMilli: bigint,
  collectedMilli: bigint,
  tolerancePct: number,
): boolean {
  const toleranceMilli = BigInt(Math.round(tolerancePct * 1000));
  const absVariance = varianceMilli < 0n ? -varianceMilli : varianceMilli;
  return absVariance * 100_000n > toleranceMilli * collectedMilli;
}

/** Round milli-kg down to a multiple of `bucketKg` (public figures never reveal finer detail). */
export function floorToBucket(milli: bigint, bucketKg: number): bigint {
  const bucketMilli = BigInt(Math.max(1, Math.round(bucketKg * 1000)));
  return milli - (milli % bucketMilli);
}
