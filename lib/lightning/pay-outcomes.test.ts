// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What `pay()` must say when a rail answers — the classification the payout engine relies on:
 *   PaymentFailedError          → definitely NOT sent  → the payout may be retried by staff
 *   PaymentOutcomeUnknownError  → may have settled     → the payout must NOT be retried
 * Getting this wrong is how a retry double-pays. Fake HTTP only: no live Blink/LNbits account
 * has been exercised yet (docs/PILOT.md §6 makes the first real payment a supervised step).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sats } from '@/lib/money';
import { testInvoice, testPreimage } from '@/lib/testing/bolt11';
import { PaymentFailedError, PaymentOutcomeUnknownError } from './errors';
import { LNbitsProvider } from './LNbitsProvider';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const HASH = testPreimage('pay-outcomes').paymentHash;
const invoiceFor = (n: number): string => testInvoice(n, HASH);

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

describe('LNbitsProvider.pay', () => {
  const lnbits = new LNbitsProvider({
    baseUrl: 'https://lnbits.example',
    floatWalletId: 'w',
    adminKey: 'admin',
  });
  const payment = (extra: Record<string, unknown>) => ({
    payment_hash: HASH,
    checking_id: HASH,
    amount: -500_000,
    fee: -1_000,
    ...extra,
  });

  it('status success → a PayResult with the real payment hash and the fee in sats', async () => {
    stubNetwork(() => json(payment({ status: 'success' }), 201));
    const result = await lnbits.pay(DESTINATION, sats(500), 'payout-1');
    expect(result.paymentRef).toBe(HASH);
    expect(result.feeSats).toBe(1);
  });

  it('a 201 whose status is pending is NOT paid: the outcome is unknown, with the hash kept', async () => {
    stubNetwork(() => json(payment({ status: 'pending' }), 201));
    const error = await lnbits.pay(DESTINATION, sats(500), 'payout-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
    expect((error as PaymentOutcomeUnknownError).paymentRef).toBe(HASH);
  });

  it('an answer with no status at all is unknown, never paid', async () => {
    stubNetwork(() => json({ payment_hash: HASH, checking_id: HASH }, 201));
    await expect(lnbits.pay(DESTINATION, sats(500), 'payout-1')).rejects.toBeInstanceOf(
      PaymentOutcomeUnknownError,
    );
  });

  it('status failed → PaymentFailedError', async () => {
    stubNetwork(() => json(payment({ status: 'failed' }), 201));
    await expect(lnbits.pay(DESTINATION, sats(500), 'payout-1')).rejects.toBeInstanceOf(
      PaymentFailedError,
    );
  });

  it.each([500, 502, 504, 429, 520])(
    'HTTP %s → outcome unknown, carrying the hash',
    async (status) => {
      stubNetwork(() => json({}, status));
      const error = await lnbits.pay(DESTINATION, sats(500), 'payout-1').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
      expect((error as PaymentOutcomeUnknownError).paymentRef).toBe(HASH);
    },
  );

  it.each([400, 401, 402])('HTTP %s → definitely rejected', async (status) => {
    stubNetwork(() => json({ detail: 'nope' }, status));
    await expect(lnbits.pay(DESTINATION, sats(500), 'payout-1')).rejects.toBeInstanceOf(
      PaymentFailedError,
    );
  });

  it('a lost connection is an unknown outcome, not a failure', async () => {
    stubNetwork(() => {
      throw new TypeError('fetch failed');
    });
    const error = await lnbits.pay(DESTINATION, sats(500), 'payout-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
    expect(error).not.toBeInstanceOf(PaymentFailedError);
  });

  it("never copies the rail's response body into the error (it can echo an invoice or a key)", async () => {
    stubNetwork(() => new Response('bolt11=lnbc1secretinvoice key=ADMINKEY', { status: 400 }));
    const error = (await lnbits
      .pay(DESTINATION, sats(500), 'payout-1')
      .catch((e: unknown) => e)) as Error;
    expect(error.message).not.toMatch(/secretinvoice|ADMINKEY/);
  });

  it('lookupPayment reads GET /api/v1/payments/{hash}', async () => {
    stubNetwork((url) =>
      url.endsWith(`/api/v1/payments/${HASH}`)
        ? json({ payment_hash: HASH, paid: true })
        : json({}, 404),
    );
    const found = await lnbits.lookupPayment({ paymentRef: HASH, idempotencyKey: 'payout-1' });
    expect(found.state).toBe('paid');
  });

  it('lookupPayment without a hash cannot guess: it says so', async () => {
    await expect(lnbits.lookupPayment({ idempotencyKey: 'payout-1' })).rejects.toThrow(
      /payment hash/,
    );
  });
});
