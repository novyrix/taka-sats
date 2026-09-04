// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  computePayout,
  MoneyError,
  NotYetImplemented,
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
  const baseInput: ComputePayoutInput = {
    weightKg: 2.5,
    rateFiatMinorPerKg: 2000,
    exchange: {
      id: 'snap_test',
      fiatMinorPerBtc: 500_000_000,
      capturedAt: new Date('2026-09-04T00:00:00Z'),
    },
    rateStalenessTtlSeconds: 900,
    now: new Date('2026-09-04T00:05:00Z'),
  };

  it('is not implemented before M5-2', () => {
    expect(() => computePayout(baseInput)).toThrow(NotYetImplemented);
  });

  // Adversarial contract cases (Code Style Guide §9.5) — activate with M5-2.
  it.todo('multiplies weight by the active fiat rate, then converts at the snapshot price');
  it.todo('rounds half-up to a whole sat');
  it.todo('rejects a negative weight');
  it.todo('rejects a weight with more than 3 decimal places');
  it.todo('rejects a zero or negative fiat rate');
  it.todo('rejects a zero or negative BTC price');
  it.todo('rejects an exchange snapshot older than rateStalenessTtlSeconds');
  it.todo('returns a value constructed through sats() (non-negative integer)');
  it.todo('is deterministic for identical inputs');
  it.todo('does not accept a payout destination as an argument');
});
