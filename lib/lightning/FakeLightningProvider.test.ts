// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { sats } from '@/lib/money';
import { NotReceiveCapableError, PaymentFailedError } from './errors';
import { FakeLightningProvider } from './FakeLightningProvider';

describe('FakeLightningProvider', () => {
  it('resolves a normal address as receive-capable', async () => {
    const provider = new FakeLightningProvider();
    const resolved = await provider.resolveReceiveAddress('collector@example.com');
    expect(resolved.receiveCapable).toBe(true);
  });

  it('simulates a withdraw code for an address containing "withdraw"', async () => {
    const provider = new FakeLightningProvider();
    await expect(provider.resolveReceiveAddress('withdraw@evil.test')).rejects.toThrow(
      NotReceiveCapableError,
    );
  });

  it('pays, deducts the float, and is idempotent by key', async () => {
    const provider = new FakeLightningProvider({ initialFloatSats: 1000 });
    const first = await provider.pay(
      { lnurlOrAddress: 'collector@example.com' },
      sats(300),
      'evt-1',
    );
    expect(first.amount).toBe(300);

    const balanceAfterFirst = await provider.getFloatBalance();
    expect(balanceAfterFirst.available).toBe(700);

    const second = await provider.pay(
      { lnurlOrAddress: 'collector@example.com' },
      sats(300),
      'evt-1',
    );
    expect(second).toEqual(first);

    const balanceAfterRetry = await provider.getFloatBalance();
    expect(balanceAfterRetry.available).toBe(700); // unchanged — no double spend
  });

  it('rejects a payout exceeding the float (adversarial case)', async () => {
    const provider = new FakeLightningProvider({ initialFloatSats: 100 });
    await expect(
      provider.pay({ lnurlOrAddress: 'collector@example.com' }, sats(500), 'evt-2'),
    ).rejects.toThrow(PaymentFailedError);
  });

  it('never pays to a resolved withdraw code, even if asked to', async () => {
    const provider = new FakeLightningProvider({ initialFloatSats: 100_000 });
    await expect(
      provider.pay({ lnurlOrAddress: 'withdraw@evil.test' }, sats(100), 'evt-3'),
    ).rejects.toThrow(NotReceiveCapableError);
    expect((await provider.getFloatBalance()).available).toBe(100_000); // untouched
  });
});
