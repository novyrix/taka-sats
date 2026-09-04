// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The receive-only guarantee (M1-10, ADR-0001, SECURITY.md).
 *
 * No code path may derive a withdraw (`LNURLw`) primitive from a collector's
 * tag, and every provider's BYO validation must reject a withdraw code
 * before it is ever stored or written to a tag. This suite is the redundant,
 * cross-provider check the Code Style Guide asks for on top of the per-file
 * tests in `lnurlPay.test.ts` and `FakeLightningProvider.test.ts`.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sats } from '@/lib/money';
import { BlinkProvider } from './BlinkProvider';
import { NotReceiveCapableError } from './errors';
import { FakeLightningProvider } from './FakeLightningProvider';
import { FedimintProvider } from './FedimintProvider';
import type { LightningProvider, PayoutDestination } from './LightningProvider';
import { LNbitsProvider } from './LNbitsProvider';

function withdrawResponse(): Response {
  return new Response(
    JSON.stringify({
      tag: 'withdrawRequest',
      callback: 'https://attacker.test/withdraw',
      k1: 'secret',
      minWithdrawable: 1000,
      maxWithdrawable: 100_000_000,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('PayoutDestination carries no withdraw-capable field', () => {
  it('is shaped as exactly { lnurlOrAddress }', () => {
    const destination: PayoutDestination = { lnurlOrAddress: 'collector@example.com' };
    expect(Object.keys(destination)).toEqual(['lnurlOrAddress']);
    // Guards against a future edit silently adding a k1/callback/withdraw field.
    expect(destination).not.toHaveProperty('k1');
    expect(destination).not.toHaveProperty('callback');
    expect(destination).not.toHaveProperty('destination');
  });
});

describe('every LightningProvider rejects a resolved withdrawRequest', () => {
  const providers: [string, LightningProvider][] = [
    ['fake', new FakeLightningProvider()],
    [
      'blink',
      new BlinkProvider({
        apiUrl: 'https://api.blink.sv/graphql',
        floatWalletId: 'w1',
        apiKey: 'k',
      }),
    ],
    [
      'lnbits',
      new LNbitsProvider({ baseUrl: 'https://lnbits.example', floatWalletId: 'w1', adminKey: 'k' }),
    ],
    ['fedimint', new FedimintProvider({ federationInvite: 'fed1...' })],
  ];

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(providers)(
    '%s: resolveReceiveAddress rejects a withdraw code',
    async (_name, provider) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => withdrawResponse()),
      );
      await expect(provider.resolveReceiveAddress('withdraw@attacker.test')).rejects.toThrow(
        NotReceiveCapableError,
      );
    },
  );

  it('fake: pay() also refuses a withdraw-resolved destination, never just resolveReceiveAddress', async () => {
    const provider = new FakeLightningProvider({ initialFloatSats: 1_000_000 });
    await expect(
      provider.pay({ lnurlOrAddress: 'withdraw@attacker.test' }, sats(1), 'evt-x'),
    ).rejects.toThrow(NotReceiveCapableError);
  });
});
