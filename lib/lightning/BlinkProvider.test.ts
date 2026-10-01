// SPDX-License-Identifier: AGPL-3.0-only

/**
 * BlinkProvider against fake HTTP. The response bodies below follow Blink's published GraphQL
 * schema (PaymentSendPayload, Transaction, SettlementViaLn ...). No live account has been used:
 * see docs/providers/blink.md for what that leaves unverified.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { sats } from '@/lib/money';
import { testInvoice, testPreimage } from '@/lib/testing/bolt11';
import { BlinkProvider } from './BlinkProvider';
import { PaymentFailedError, PaymentOutcomeUnknownError } from './errors';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

afterEach(() => vi.unstubAllGlobals());

const API_KEY = 'blink_test_SECRETKEY';
const WALLET = 'wallet-btc-1';
const { preimage: PREIMAGE, paymentHash: HASH } = testPreimage('blink');
const DESTINATION = { lnurlOrAddress: 'me@wallet.example' };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Rail = (body: { query: string; variables: Record<string, unknown> }) => Response;

/** The destination's LNURL leg (always fine) plus whatever Blink answers. Returns the calls to Blink. */
function stubNetwork(rail: Rail, invoiceSats = 500) {
  const calls: {
    url: string;
    init: RequestInit;
    body: { query: string; variables: Record<string, unknown> };
  }[] = [];
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
        return json({ pr: testInvoice(invoiceSats, HASH) });
      }
      const body = JSON.parse(String(init?.body)) as {
        query: string;
        variables: Record<string, unknown>;
      };
      calls.push({ url, init: init ?? {}, body });
      return rail(body);
    }),
  );
  return calls;
}

const blink = new BlinkProvider({
  apiUrl: 'https://api.blink.example/graphql',
  floatWalletId: WALLET,
  apiKey: API_KEY,
});

/** A documented `Transaction` for an outgoing payment. */
const sendTx = (over: Record<string, unknown> = {}) => ({
  id: 'tx-1',
  status: 'SUCCESS',
  direction: 'SEND',
  memo: 'payout-1',
  createdAt: 1_790_000_000,
  settlementFee: 2,
  initiationVia: { paymentHash: HASH },
  settlementVia: { preImage: PREIMAGE },
  ...over,
});

const sendResult = (
  status: string | null,
  errors: { message: string; code?: string | null; path?: string[] }[] = [],
  transaction: unknown = null,
) => json({ data: { lnInvoicePaymentSend: { status, errors, transaction } } });

const pay = () => blink.pay(DESTINATION, sats(500), 'payout-1');
const caught = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

describe('BlinkProvider.pay: the request', () => {
  it('sends lnInvoicePaymentSend with the documented input and the X-API-KEY header', async () => {
    const calls = stubNetwork(() => sendResult('SUCCESS', [], sendTx()));
    await pay();
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.url).toBe('https://api.blink.example/graphql');
    expect((call?.init.headers as Record<string, string>)['X-API-KEY']).toBe(API_KEY);
    expect(call?.body.query).toContain('lnInvoicePaymentSend(input: $input)');
    expect(call?.body.variables.input).toEqual({
      walletId: WALLET,
      paymentRequest: testInvoice(500, HASH),
      memo: 'payout-1',
    });
  });

  it('refuses to run without an API key and sends nothing', async () => {
    const calls = stubNetwork(() => sendResult('SUCCESS'));
    const keyless = new BlinkProvider({
      apiUrl: 'https://x.example/graphql',
      floatWalletId: WALLET,
      apiKey: '',
    });
    await expect(keyless.pay(DESTINATION, sats(500), 'payout-1')).rejects.toBeInstanceOf(
      PaymentFailedError,
    );
    expect(calls).toHaveLength(0);
  });

  it('refuses to pay an invoice for a different amount: nothing reaches Blink', async () => {
    const calls = stubNetwork(() => sendResult('SUCCESS'), 50_000); // the destination answers 100x too much
    await expect(pay()).rejects.toBeInstanceOf(PaymentFailedError);
    expect(calls).toHaveLength(0);
  });
});

describe('BlinkProvider.pay: classification', () => {
  it('SUCCESS with a matching preimage → a PayResult whose reference is the payment hash', async () => {
    stubNetwork(() => sendResult('SUCCESS', [], sendTx()));
    const result = await pay();
    expect(result.paymentRef).toBe(HASH);
    expect(result.amount).toBe(500);
    expect(result.feeSats).toBe(2);
    expect(result.settledAt.toISOString()).toBe(new Date(1_790_000_000 * 1000).toISOString());
  });

  it('SUCCESS without a transaction still pays, with a zero fee (the status is the verdict)', async () => {
    stubNetwork(() => sendResult('SUCCESS'));
    const result = await pay();
    expect(result.paymentRef).toBe(HASH);
    expect(result.feeSats).toBe(0);
  });

  it('SUCCESS whose preimage does not hash to the invoice is NOT trusted: outcome unknown', async () => {
    const wrong = testPreimage('someone-else').preimage;
    stubNetwork(() => sendResult('SUCCESS', [], sendTx({ settlementVia: { preImage: wrong } })));
    const error = await caught(pay());
    expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
    expect((error as PaymentOutcomeUnknownError).paymentRef).toBe(HASH);
  });

  it.each([
    'INSUFFICIENT_BALANCE',
    'ROUTE_FINDING_ERROR',
    'INVALID_INPUT',
    'TRANSACTION_RESTRICTED',
    'NOT_AUTHORIZED',
    'TOO_MANY_REQUEST',
  ])('FAILURE with the definite code %s → PaymentFailedError (nothing was sent)', async (code) => {
    stubNetwork(() => sendResult('FAILURE', [{ message: 'refused', code }]));
    const error = await caught(pay());
    expect(error).toBeInstanceOf(PaymentFailedError);
    expect((error as PaymentFailedError).providerCode).toBe(code);
  });

  it.each([
    'UNKNOWN_CLIENT_ERROR',
    'UNEXPECTED_CLIENT_ERROR',
    'DB_ERROR',
    'LND_OFFLINE',
    'LIGHTNING_PAYMENT_ERROR',
  ])(
    'FAILURE with the ambiguous code %s → outcome unknown (Blink maps internal faults to FAILURE too)',
    async (code) => {
      stubNetwork(() => sendResult('FAILURE', [{ message: 'fault', code }]));
      const error = await caught(pay());
      expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
      expect(error).not.toBeInstanceOf(PaymentFailedError);
      expect((error as PaymentOutcomeUnknownError).paymentRef).toBe(HASH);
    },
  );

  it('FAILURE with no code at all is unknown, not failed', async () => {
    stubNetwork(() => sendResult('FAILURE', [{ message: 'no route' }]));
    expect(await caught(pay())).toBeInstanceOf(PaymentOutcomeUnknownError);
  });

  it('FAILURE mixing a definite and an unlisted code is unknown', async () => {
    stubNetwork(() =>
      sendResult('FAILURE', [
        { message: 'a', code: 'INSUFFICIENT_BALANCE' },
        { message: 'b', code: 'DB_ERROR' },
      ]),
    );
    expect(await caught(pay())).toBeInstanceOf(PaymentOutcomeUnknownError);
  });

  it.each(['PENDING', 'ALREADY_PAID', 'SOMETHING_NEW', null])(
    'status %s → outcome unknown with the hash kept (it may still settle; it must never be a failure)',
    async (status) => {
      stubNetwork(() => sendResult(status));
      const error = await caught(pay());
      expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
      expect(error).not.toBeInstanceOf(PaymentFailedError);
      expect((error as PaymentOutcomeUnknownError).paymentRef).toBe(HASH);
    },
  );

  it('a payload with errors and no status (input rejected before execution) → failed', async () => {
    stubNetwork(() => sendResult(null, [{ message: 'Memo is too long' }]));
    expect(await caught(pay())).toBeInstanceOf(PaymentFailedError);
  });

  it.each([500, 502, 503, 504, 408, 429])(
    'HTTP %s → outcome unknown, carrying the hash',
    async (status) => {
      stubNetwork(() => json({}, status));
      const error = await caught(pay());
      expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
      expect((error as PaymentOutcomeUnknownError).paymentRef).toBe(HASH);
    },
  );

  it.each([400, 401, 403, 404])(
    'HTTP %s → definitely rejected, nothing attempted',
    async (status) => {
      stubNetwork(() => json({}, status));
      expect(await caught(pay())).toBeInstanceOf(PaymentFailedError);
    },
  );

  it('a lost connection is unknown, never failed and never swallowed', async () => {
    stubNetwork(() => {
      throw new TypeError('fetch failed');
    });
    const error = await caught(pay());
    expect(error).toBeInstanceOf(PaymentOutcomeUnknownError);
    expect((error as PaymentOutcomeUnknownError).paymentRef).toBe(HASH);
  });

  it('a timeout is unknown', async () => {
    stubNetwork(() => {
      throw new DOMException('The operation timed out', 'TimeoutError');
    });
    expect(await caught(pay())).toBeInstanceOf(PaymentOutcomeUnknownError);
  });

  it('an unreadable 200 answer is unknown', async () => {
    stubNetwork(() => new Response('<html>bad gateway</html>', { status: 200 }));
    expect(await caught(pay())).toBeInstanceOf(PaymentOutcomeUnknownError);
  });

  it('a 200 with no data and no errors is unknown', async () => {
    stubNetwork(() => json({}));
    expect(await caught(pay())).toBeInstanceOf(PaymentOutcomeUnknownError);
  });

  it('a top-level GraphQL validation error (rejected before execution) → failed', async () => {
    stubNetwork(() =>
      json({
        errors: [{ message: 'Unknown type', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }],
      }),
    );
    expect(await caught(pay())).toBeInstanceOf(PaymentFailedError);
  });

  it('a top-level internal error during the payment mutation → unknown', async () => {
    stubNetwork(() =>
      json({
        data: null,
        errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } }],
      }),
    );
    expect(await caught(pay())).toBeInstanceOf(PaymentOutcomeUnknownError);
  });

  it('never puts the API key or the invoice in an error message', async () => {
    stubNetwork(() => json({ errors: [{ message: 'nope' }] }, 500));
    const error = (await caught(pay())) as Error;
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).not.toContain(testInvoice(500, HASH));
  });
});

describe('BlinkProvider.getFloatBalance', () => {
  const balanceAnswer = (wallet: unknown) =>
    json({ data: { me: { defaultAccount: { walletById: wallet } } } });

  it('reads the BTC wallet balance in sats with walletById', async () => {
    const calls = stubNetwork(() =>
      balanceAnswer({ id: WALLET, balance: 120_345, walletCurrency: 'BTC' }),
    );
    const balance = await blink.getFloatBalance();
    expect(balance.available).toBe(120_345);
    expect(calls[0]?.body.query).toContain('walletById(walletId: $walletId)');
    expect(calls[0]?.body.variables).toEqual({ walletId: WALLET });
  });

  it('refuses a USD wallet: its balance is in cents and would be misread as sats', async () => {
    stubNetwork(() => balanceAnswer({ id: WALLET, balance: 5000, walletCurrency: 'USD' }));
    await expect(blink.getFloatBalance()).rejects.toThrow(/BTC wallet/);
  });

  it('a wallet that is not on the account is an error, not zero', async () => {
    stubNetwork(() => balanceAnswer(null));
    await expect(blink.getFloatBalance()).rejects.toThrow(/not found/);
  });

  it('an API error is reported, not turned into a number', async () => {
    stubNetwork(() => json({ errors: [{ message: 'denied', extensions: { code: 'FORBIDDEN' } }] }));
    await expect(blink.getFloatBalance()).rejects.toBeInstanceOf(PaymentFailedError);
  });

  it('a negative balance is clamped to zero', async () => {
    stubNetwork(() => balanceAnswer({ id: WALLET, balance: -5, walletCurrency: 'BTC' }));
    expect((await blink.getFloatBalance()).available).toBe(0);
  });
});

describe('BlinkProvider.lookupPayment', () => {
  const byHash = (txs: unknown[]) =>
    json({ data: { me: { defaultAccount: { walletById: { transactionsByPaymentHash: txs } } } } });
  const recent = (txs: unknown[]) =>
    json({
      data: {
        me: {
          defaultAccount: {
            walletById: { transactions: { edges: txs.map((node) => ({ node })) } },
          },
        },
      },
    });

  it('by payment hash: a SUCCESS send is paid and its preimage is verified', async () => {
    const calls = stubNetwork(() => byHash([sendTx()]));
    const found = await blink.lookupPayment({ paymentRef: HASH, idempotencyKey: 'payout-1' });
    expect(found).toMatchObject({
      state: 'paid',
      paymentRef: HASH,
      proofVerified: true,
      matches: 1,
    });
    expect(calls[0]?.body.query).toContain('transactionsByPaymentHash');
  });

  it('a received transaction with the same hash is not a payment we sent', async () => {
    stubNetwork(() => byHash([sendTx({ direction: 'RECEIVE' })]));
    const found = await blink.lookupPayment({ paymentRef: HASH, idempotencyKey: 'payout-1' });
    expect(found.state).toBe('not_found');
  });

  it('PENDING stays pending and FAILURE is failed', async () => {
    stubNetwork(() => byHash([sendTx({ status: 'PENDING', settlementVia: null })]));
    expect((await blink.lookupPayment({ paymentRef: HASH, idempotencyKey: 'p' })).state).toBe(
      'pending',
    );
    stubNetwork(() => byHash([sendTx({ status: 'FAILURE', settlementVia: null })]));
    expect((await blink.lookupPayment({ paymentRef: HASH, idempotencyKey: 'p' })).state).toBe(
      'failed',
    );
  });

  it('SUCCESS with a preimage that does not match is paid but proofVerified is false', async () => {
    const wrong = testPreimage('x').preimage;
    stubNetwork(() => byHash([sendTx({ settlementVia: { preImage: wrong } })]));
    const found = await blink.lookupPayment({ paymentRef: HASH, idempotencyKey: 'p' });
    expect(found.proofVerified).toBe(false);
  });

  it('without a hash it scans recent transactions for our memo (the payout id)', async () => {
    const calls = stubNetwork(() =>
      recent([sendTx({ memo: 'someone-elses' }), sendTx({ id: 'tx-2', memo: 'payout-1' })]),
    );
    const found = await blink.lookupPayment({ idempotencyKey: 'payout-1' });
    expect(found).toMatchObject({ state: 'paid', matches: 1, paymentRef: HASH });
    expect(calls[0]?.body.variables).toMatchObject({ walletId: WALLET, first: 100 });
  });

  it('two matching sends are reported so a person looks at them', async () => {
    stubNetwork(() => recent([sendTx(), sendTx({ id: 'tx-2' })]));
    expect((await blink.lookupPayment({ idempotencyKey: 'payout-1' })).matches).toBe(2);
  });

  it('nothing found is not_found', async () => {
    stubNetwork(() => recent([]));
    expect(await blink.lookupPayment({ idempotencyKey: 'payout-1' })).toEqual({
      state: 'not_found',
      matches: 0,
    });
  });
});
