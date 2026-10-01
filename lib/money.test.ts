// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  computePayout,
  computePayoutDetail,
  fiatMinorPerBtcFromMajor,
  MoneyError,
  SATS_PER_BTC,
  sats,
  type ComputePayoutInput,
} from './money';

describe('sats()', () => {
  it('brands a non-negative safe integer', () => {
    expect(sats(0)).toBe(0);
    expect(sats(50_000)).toBe(50_000);
  });

  it('rejects a negative amount', () => {
    expect(() => sats(-1)).toThrow(MoneyError);
  });

  it('rejects a fractional amount', () => {
    expect(() => sats(1.5)).toThrow(MoneyError);
  });

  it('rejects a non-finite amount', () => {
    expect(() => sats(Number.NaN)).toThrow(MoneyError);
    expect(() => sats(Number.POSITIVE_INFINITY)).toThrow(MoneyError);
  });

  it('rejects an unsafe integer', () => {
    expect(() => sats(Number.MAX_SAFE_INTEGER + 2)).toThrow(MoneyError);
  });
});

describe('SATS_PER_BTC', () => {
  it('is the protocol constant', () => {
    expect(SATS_PER_BTC).toBe(100_000_000);
  });
});

describe('computePayout()', () => {
  const NOW = new Date('2026-09-04T00:05:00Z');
  const baseInput: ComputePayoutInput = {
    weightKg: 2.5,
    rateFiatMinorPerKg: 2000,
    exchange: {
      id: 'snap_test',
      fiatMinorPerBtc: 500_000_000, // KES 5,000,000 per BTC
      capturedAt: new Date('2026-09-04T00:00:00Z'),
    },
    rateStalenessTtlSeconds: 900,
    now: NOW,
  };
  const withInput = (over: Partial<ComputePayoutInput>): ComputePayoutInput => ({
    ...baseInput,
    ...over,
  });
  const withPrice = (fiatMinorPerBtc: number): ComputePayoutInput =>
    withInput({ exchange: { ...baseInput.exchange, fiatMinorPerBtc } });

  it('multiplies weight by the fiat rate, then converts at the snapshot price', () => {
    // 2.5 kg × 2000 = 5000 minor (KES 50); 5000 / 500,000,000 BTC = 1000 sats.
    expect(computePayoutDetail(baseInput)).toEqual({ sats: 1000, fiatMinor: 5000 });
    expect(computePayout(baseInput)).toBe(1000);
  });

  it('rounds the fiat amount half-up to a whole minor unit', () => {
    const fiat = (weightKg: number, rate: number) =>
      computePayoutDetail({ ...withPrice(1_000_000), weightKg, rateFiatMinorPerKg: rate })
        .fiatMinor;
    expect(fiat(0.003, 500)).toBe(2); // 1.5 → 2
    expect(fiat(0.001, 500)).toBe(1); // 0.5 → 1
    expect(fiat(1.005, 100)).toBe(101); // 100.5 → 101
    expect(fiat(0.001, 1499)).toBe(1); // 1.499 → 1
  });

  it('rounds the sats amount half-up, exactly at .5', () => {
    // fiat 5 minor at KES 2,000,000/BTC: 5 × 1e8 / 2e8 = 2.5 → 3.
    const at = (fiatMinorPerBtc: number) =>
      computePayout({ ...withPrice(fiatMinorPerBtc), weightKg: 0.5, rateFiatMinorPerKg: 10 });
    expect(at(200_000_000)).toBe(3);
    expect(at(200_000_001)).toBe(2); // 2.49999998 → 2
    expect(at(199_999_999)).toBe(3); // 2.50000001 → 3
  });

  it('never loses precision to floating point (1.005 kg is exactly 1005 g)', () => {
    // 1.005 is not exactly representable as a double; the integer parse keeps it 1005 g.
    expect(computePayoutDetail(withInput({ weightKg: 1.005, rateFiatMinorPerKg: 2000 }))).toEqual({
      sats: 402,
      fiatMinor: 2010,
    });
  });

  it('handles the largest legal weight without overflow', () => {
    // 2000 kg × 2000 = 4,000,000 minor → 800,000 sats.
    expect(computePayout(withInput({ weightKg: 2000 }))).toBe(800_000);
    // A pathological weight × price combination fails loudly instead of losing precision.
    expect(() =>
      computePayout({ ...withPrice(1), weightKg: 999_999.999, rateFiatMinorPerKg: 8000 }),
    ).toThrow(MoneyError);
  });

  it('rejects a zero, negative or non-finite weight', () => {
    for (const weightKg of [0, -0.001, -2.5, Number.NaN, Infinity, -Infinity]) {
      expect(() => computePayout(withInput({ weightKg }))).toThrow(MoneyError);
    }
  });

  it('rejects a weight with more than 3 decimal places (and exponent forms)', () => {
    for (const weightKg of [1.0005, 0.0001, 0.1 + 0.2, 1e-7, 1e21]) {
      expect(() => computePayout(withInput({ weightKg }))).toThrow(MoneyError);
    }
    expect(computePayout(withInput({ weightKg: 0.001, rateFiatMinorPerKg: 100_000 }))).toBe(20);
  });

  it('rejects a zero, negative, fractional or non-finite fiat rate', () => {
    for (const rateFiatMinorPerKg of [0, -1, 1.5, Number.NaN, Infinity]) {
      expect(() => computePayout(withInput({ rateFiatMinorPerKg }))).toThrow(MoneyError);
    }
  });

  it('rejects a zero, negative, fractional or non-finite BTC price', () => {
    for (const price of [0, -1, 0.5, Number.NaN, Infinity]) {
      expect(() => computePayout(withPrice(price))).toThrow(MoneyError);
    }
  });

  it('rejects a payout that rounds to zero fiat or zero sats (a 0-sat payout is an error)', () => {
    // 1 gram at 1 minor/kg = 0.001 minor → 0
    expect(() => computePayout(withInput({ weightKg: 0.001, rateFiatMinorPerKg: 1 }))).toThrow(
      /0 fiat/,
    );
    // 1 minor unit at KES 1e10/BTC = 0.0001 sat → 0
    expect(() =>
      computePayout({ ...withPrice(1_000_000_000_000), weightKg: 0.001, rateFiatMinorPerKg: 1000 }),
    ).toThrow(/0 sats/);
  });

  it('rejects an exchange snapshot older than rateStalenessTtlSeconds', () => {
    const at = (ageSeconds: number) =>
      withInput({ now: new Date(baseInput.exchange.capturedAt.getTime() + ageSeconds * 1000) });
    expect(computePayout(at(900))).toBe(1000); // exactly the TTL is still fresh
    expect(() => computePayout(at(901))).toThrow(/stale/);
    expect(() => computePayout(withInput({ rateStalenessTtlSeconds: -1 }))).toThrow(MoneyError);
    expect(() => computePayout(withInput({ rateStalenessTtlSeconds: Number.NaN }))).toThrow(
      MoneyError,
    );
  });

  it('rejects a snapshot with an invalid timestamp', () => {
    expect(() =>
      computePayout(withInput({ exchange: { ...baseInput.exchange, capturedAt: new Date('x') } })),
    ).toThrow(MoneyError);
  });

  it('reads the clock only through now', () => {
    expect(computePayout(withInput({ now: new Date('2026-09-04T00:14:59Z') }))).toBe(1000);
    expect(() => computePayout(withInput({ now: new Date('2026-09-04T00:15:01Z') }))).toThrow(
      /stale/,
    );
  });

  it('returns a value built through sats() (positive safe integer)', () => {
    const result = computePayout(baseInput);
    expect(Number.isSafeInteger(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });

  it('is deterministic for identical inputs', () => {
    const results = new Set(Array.from({ length: 50 }, () => computePayout(baseInput)));
    expect(results.size).toBe(1);
  });

  it('does not accept a payout destination as an argument', () => {
    // @ts-expect-error — destination is not part of ComputePayoutInput (§12.3)
    const result = computePayout({ ...baseInput, destination: 'attacker@evil.example' });
    expect(result).toBe(1000);
  });
});

describe('fiatMinorPerBtcFromMajor()', () => {
  it('converts major units to minor units exactly', () => {
    expect(fiatMinorPerBtcFromMajor('5000000')).toBe(500_000_000);
    expect(fiatMinorPerBtcFromMajor('5012345.67')).toBe(501_234_567);
    expect(fiatMinorPerBtcFromMajor('0.01')).toBe(1);
  });

  it('rounds a sub-minor remainder half-up', () => {
    expect(fiatMinorPerBtcFromMajor('5012345.674')).toBe(501_234_567);
    expect(fiatMinorPerBtcFromMajor('5012345.675')).toBe(501_234_568);
    expect(fiatMinorPerBtcFromMajor('5000000.999999')).toBe(500_000_100);
  });

  it('rejects zero, negative, exponent, empty and non-numeric input', () => {
    for (const bad of ['0', '0.004', '-5', '1e6', '', 'abc', '5,000,000', 'NaN']) {
      expect(() => fiatMinorPerBtcFromMajor(bad)).toThrow(MoneyError);
    }
  });

  it('rejects a price beyond the safe integer range', () => {
    expect(() => fiatMinorPerBtcFromMajor('9'.repeat(30))).toThrow(MoneyError);
  });
});
