// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What `pay()` must say when a rail answers — the classification the payout engine relies on:
 *   PaymentFailedError          → definitely NOT sent  → the payout may be retried by staff
 *   PaymentOutcomeUnknownError  → may have settled     → the payout must NOT be retried
 * Getting this wrong is how a retry double-pays. Fake HTTP only: no live Blink/LNbits account
 * has been exercised yet (docs/PILOT.md §6 makes the first real payment a supervised step).
 */

import { bech32 } from 'bech32';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sats } from '@/lib/money';
import { BlinkProvider } from './BlinkProvider';
import { PaymentFailedError, PaymentOutcomeUnknownError } from './errors';
import { LNbitsProvider } from './LNbitsProvider';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const invoiceFor = (n: number): string =>
  bech32.encode(`lnbc${n * 10}n`, new Array(40).fill(7), 4000);

/** The destination's LNURL leg (always fine here) plus whatever the rail answers. */
function stubNetwork(
  rail: (url: string, init?: RequestInit) => Response | Promise<Response>,
  amount = 500,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.includes('/.well-known/lnurlp/')) {
        return json({
          tag: 'payRequest',
          callback: 'https://wallet.example/cb',
          minSendable: 1000,
          maxSendable: 100_000_000_000,
        });
      }
      if (url.startsWith('https://wallet.example/cb')) {
        return json({ pr: invoiceFor(amount) });
      }
      return rail(url, init);
    }),
  );
}

const DESTINATION = { lnurlOrAddress: 'me@wallet.example' };

describe('BlinkProvider.pay', () => {
  const blink = new BlinkProvider({
    apiUrl: 'https://api.blink.example/graphql',
    floatWalletId: 'wallet-1',
    apiKey: 'test-key',
  });
  const answers =
    (status: string, errors: { message: string }[] = []) =>
    () =>
      json({ data: { lnInvoicePaymentSend: { status, errors } } });

  it('SUCCESS → a PayResult', async () => {
    stubNetwork(answers('SUCCESS'));
    const result = await blink.pay(DESTINATION, sats(500), 'payout-1');
    expect(result.amount).toBe(500);
  });

  it('FAILURE → PaymentFailedError (nothing was sent; staff may retry)', async () => {
    stubNetwork(answers('FAILURE', [{ message: 'no route' }]));
    await expect(blink.pay(DESTINATION, sats(500), 'payout-1')).rejects.toBeInstanceOf(
      PaymentFailedError,
    );
  });

  it.each(['PENDING', 'SOMETHING_NEW'])(
    '%s → PaymentOutcomeUnknownError — it may still settle, so it must never be a failure',
    async (status) => {
      stubNetwork(answers(status));
      const error = await blink.pay(DESTINATION, sats(500), 'payout-1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
      expect(error).not.toBeInstanceOf(PaymentFailedError);
    },
  );

  it.each([500, 502, 503, 504, 408, 429])(
    'HTTP %s → outcome unknown (the request may have been processed before the response was lost)',
    async (status) => {
      stubNetwork(() => json({}, status));
      const error = await blink.pay(DESTINATION, sats(500), 'payout-1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
    },
  );

  it.each([400, 401, 403, 404])(
    'HTTP %s → definitely rejected, nothing attempted',
    async (status) => {
      stubNetwork(() => json({}, status));
      await expect(blink.pay(DESTINATION, sats(500), 'payout-1')).rejects.toBeInstanceOf(
        PaymentFailedError,
      );
    },
  );

  it('a network error talking to the rail is neither "failed" nor swallowed', async () => {
    stubNetwork(() => {
      throw new TypeError('fetch failed');
    });
    const error = await blink.pay(DESTINATION, sats(500), 'payout-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(PaymentFailedError);
  });

  it('refuses to pay an invoice for a different amount — nothing reaches the rail', async () => {
    const rail = vi.fn(answers('SUCCESS'));
    stubNetwork(rail, 50_000); // the destination answers 100× too much
    await expect(blink.pay(DESTINATION, sats(500), 'payout-1')).rejects.toBeInstanceOf(
      PaymentFailedError,
    );
    expect(rail).not.toHaveBeenCalled();
  });
});

describe('LNbitsProvider.pay', () => {
  const lnbits = new LNbitsProvider({
    baseUrl: 'https://lnbits.example',
    floatWalletId: 'w',
    adminKey: 'admin',
  });

  it('a payment hash → a PayResult', async () => {
    stubNetwork(() => json({ payment_hash: 'abc123' }));
    expect((await lnbits.pay(DESTINATION, sats(500), 'payout-1')).paymentRef).toBe('abc123');
  });

  it.each([500, 502, 504, 429])('HTTP %s → outcome unknown', async (status) => {
    stubNetwork(() => json({}, status));
    await expect(lnbits.pay(DESTINATION, sats(500), 'payout-1')).rejects.toBeInstanceOf(
      PaymentOutcomeUnknownError,
    );
  });

  it.each([400, 401, 402])('HTTP %s → definitely rejected', async (status) => {
    stubNetwork(() => json({ detail: 'nope' }, status));
    await expect(lnbits.pay(DESTINATION, sats(500), 'payout-1')).rejects.toBeInstanceOf(
      PaymentFailedError,
    );
  });

  it("never copies the rail's response body into the error (it can echo an invoice or a key)", async () => {
    stubNetwork(() => new Response('bolt11=lnbc1secretinvoice key=ADMINKEY', { status: 400 }));
    const error = (await lnbits
      .pay(DESTINATION, sats(500), 'payout-1')
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toMatch(/secretinvoice|ADMINKEY/);
  });
});
