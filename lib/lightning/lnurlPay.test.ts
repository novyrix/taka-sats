// SPDX-License-Identifier: AGPL-3.0-only

import { bech32 } from 'bech32';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sats } from '@/lib/money';
import {
  InvalidLightningAddressError,
  InvoiceMismatchError,
  LightningEndpointUnreachableError,
  NotReceiveCapableError,
  SpendCredentialRejectedError,
  UnsafeLnurlTargetError,
} from './errors';
import { requestInvoiceFor, requestLnurlInvoice, resolveLnurlPay } from './lnurlPay';
import type { FetchLike } from './lnurlPay';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => dns);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  dns.lookup.mockReset();
});

/** A well-formed BOLT11 invoice for exactly `n` sats (the data part is irrelevant to the guard). */
const invoiceFor = (n: number): string =>
  bech32.encode(`lnbc${n * 10}n`, new Array(40).fill(7), 4000);

const PAYREQUEST = {
  tag: 'payRequest',
  callback: 'https://example.com/lnurlp/callback/sample-wallet',
  minSendable: 1000,
  maxSendable: 100_000_000,
  metadata: '[["text/plain","pay sample-wallet"]]',
};

/** A fetch stub that must never be reached. */
function neverFetch() {
  return vi.fn(async () => {
    throw new Error('network call made');
  }) as unknown as FetchLike & ReturnType<typeof vi.fn>;
}

async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected the call to reject');
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** A fetch stub that dispatches on a substring of the requested URL. */
function fakeFetch(routes: Record<string, () => Response>): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const match = Object.entries(routes).find(([key]) => url.includes(key));
    if (!match) {
      throw new Error(`no fake route for ${url}`);
    }
    return match[1]();
  }) as FetchLike;
}

describe('resolveLnurlPay', () => {
  it('resolves a payRequest and converts msat to sat (min rounds up, max rounds down)', async () => {
    const fetchImpl = fakeFetch({
      'example.com': () =>
        jsonResponse({
          tag: 'payRequest',
          callback: 'https://example.com/lnurlp/callback/sample-wallet',
          minSendable: 1001,
          maxSendable: 100_000_999,
          metadata: '[["text/plain","pay sample-wallet"]]',
        }),
    });

    const resolved = await resolveLnurlPay('sample-wallet@example.com', fetchImpl);
    expect(resolved.receiveCapable).toBe(true);
    expect(resolved.minSendableSats).toBe(2); // ceil(1001/1000)
    expect(resolved.maxSendableSats).toBe(100_000); // floor(100000999/1000)
  });

  it('rejects a withdrawRequest — the receive-only guarantee (M1-10, ADR-0001)', async () => {
    const fetchImpl = fakeFetch({
      evil: () =>
        jsonResponse({
          tag: 'withdrawRequest',
          callback: 'https://evil.test/withdraw',
          k1: 'abc',
          minWithdrawable: 1000,
          maxWithdrawable: 100_000_000,
        }),
    });

    await expect(resolveLnurlPay('withdraw@evil.test', fetchImpl)).rejects.toThrow(
      NotReceiveCapableError,
    );
  });

  it('rejects any tag other than payRequest', async () => {
    const fetchImpl = fakeFetch({
      chan: () => jsonResponse({ tag: 'channelRequest', callback: 'https://example.com/cb' }),
    });
    await expect(resolveLnurlPay('chan@example.com', fetchImpl)).rejects.toThrow(
      NotReceiveCapableError,
    );
  });

  it('surfaces an LNURL-level error response', async () => {
    const fetchImpl = fakeFetch({
      example: () => jsonResponse({ status: 'ERROR', reason: 'no such user' }),
    });
    await expect(resolveLnurlPay('nobody@example.com', fetchImpl)).rejects.toThrow(
      InvalidLightningAddressError,
    );
  });

  it('surfaces a non-2xx HTTP response', async () => {
    const fetchImpl = fakeFetch({ example: () => jsonResponse({}, 404) });
    await expect(resolveLnurlPay('nobody@example.com', fetchImpl)).rejects.toThrow(
      InvalidLightningAddressError,
    );
  });
});

describe('requestLnurlInvoice / requestInvoiceFor', () => {
  it('requests an invoice for the given amount in millisats', async () => {
    let requestedUrl = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return jsonResponse({ pr: invoiceFor(500) });
    }) as FetchLike;

    const bolt11 = await requestLnurlInvoice('https://example.com/callback', sats(500), fetchImpl);
    expect(bolt11).toBe(invoiceFor(500));
    expect(requestedUrl).toBe('https://example.com/callback?amount=500000');
  });

  it('appends amount with & when the callback already has query params', async () => {
    let requestedUrl = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return jsonResponse({ pr: invoiceFor(10) });
    }) as FetchLike;

    await requestLnurlInvoice('https://lnbits.example/callback?id=abc', sats(10), fetchImpl);
    expect(requestedUrl).toBe('https://lnbits.example/callback?id=abc&amount=10000');
  });

  it('resolves then requests an invoice end to end, and still rejects a withdraw code', async () => {
    const fetchImpl = fakeFetch({
      '.well-known/lnurlp': () =>
        jsonResponse({
          tag: 'payRequest',
          callback: 'https://example.com/lnurlp/callback/sample-wallet',
          minSendable: 1000,
          maxSendable: 100_000_000,
        }),
      '/lnurlp/callback/sample-wallet': () => jsonResponse({ pr: invoiceFor(1000) }),
    });

    const bolt11 = await requestInvoiceFor('sample-wallet@example.com', sats(1000), fetchImpl);
    expect(bolt11).toBe(invoiceFor(1000));

    const withdrawFetch = fakeFetch({
      evil: () => jsonResponse({ tag: 'withdrawRequest', callback: 'https://evil.test/w' }),
    });
    await expect(
      requestInvoiceFor('withdraw@evil.test', sats(1000), withdrawFetch),
    ).rejects.toThrow(NotReceiveCapableError);
  });
});

describe('the invoice must be exactly the amount we asked for', () => {
  const callbackReturning = (pr: unknown): FetchLike =>
    (async () => jsonResponse({ pr })) as unknown as FetchLike;

  it('refuses an invoice for MORE than requested — a hostile destination cannot inflate a payout', async () => {
    for (const inflated of [501, 5_000, 50_000]) {
      await expect(
        requestLnurlInvoice(
          'https://example.com/cb',
          sats(500),
          callbackReturning(invoiceFor(inflated)),
        ),
      ).rejects.toThrow(InvoiceMismatchError);
    }
  });

  it('refuses an invoice for less than requested too (the ledger must match what moved)', async () => {
    await expect(
      requestLnurlInvoice('https://example.com/cb', sats(500), callbackReturning(invoiceFor(499))),
    ).rejects.toThrow(InvoiceMismatchError);
  });

  it('refuses a zero-amount invoice (payer-chooses) and garbage', async () => {
    const zeroAmount = bech32.encode('lnbc', new Array(40).fill(7), 4000);
    for (const pr of [
      zeroAmount,
      'lnbc1...',
      'not-an-invoice',
      'lnurl1dp68gurn8ghj7mrww4exctnrdakj7',
    ]) {
      await expect(
        requestLnurlInvoice('https://example.com/cb', sats(500), callbackReturning(pr)),
      ).rejects.toThrow(InvoiceMismatchError);
    }
  });

  it('never carries the invoice in the error message', async () => {
    const bad = invoiceFor(9_999);
    const error = (await requestLnurlInvoice(
      'https://example.com/cb',
      sats(500),
      callbackReturning(bad),
    ).catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain(bad);
    expect(error.message).not.toContain('lnbc');
  });

  it('refuses an amount outside the wallet’s own sendable range before asking for an invoice', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      input.toString().includes('.well-known')
        ? jsonResponse({ ...PAYREQUEST, minSendable: 10_000_000, maxSendable: 20_000_000 }) // 10k–20k sat
        : jsonResponse({ pr: invoiceFor(500) }),
    ) as unknown as FetchLike;

    await expect(
      requestInvoiceFor('sample-wallet@example.com', sats(500), fetchImpl),
    ).rejects.toThrow(InvoiceMismatchError);
    // Only the pay-request lookup happened — the callback was never called.
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe('spend credentials and unsafe targets never reach the network', () => {
  it.each([
    [
      'the Pay side of a Paybee card',
      'https://card.paybee.buzz/sample-card',
      SpendCredentialRejectedError,
    ],
    ['a subdomain of a spend host', 'https://x.card.paybee.buzz/a', SpendCredentialRejectedError],
    ['an uppercase spend host', 'HTTPS://CARD.PAYBEE.BUZZ/a', SpendCredentialRejectedError],
    [
      'a lightning:-prefixed spend URL',
      'lightning:https://card.paybee.buzz/a',
      SpendCredentialRejectedError,
    ],
    ['http://', 'http://example.com/x', UnsafeLnurlTargetError],
    ['credentials in the URL', 'https://user:pw@example.com/x', UnsafeLnurlTargetError],
    ['localhost', 'https://localhost/', UnsafeLnurlTargetError],
    ['127.0.0.1', 'https://127.0.0.1/', UnsafeLnurlTargetError],
    ['[::1]', 'https://[::1]/', UnsafeLnurlTargetError],
    ['10.0.0.5', 'https://10.0.0.5/', UnsafeLnurlTargetError],
    ['the metadata IP', 'https://169.254.169.254/', UnsafeLnurlTargetError],
    ['192.168.1.1', 'https://192.168.1.1/', UnsafeLnurlTargetError],
    ['CGNAT', 'https://100.64.0.1/', UnsafeLnurlTargetError],
    ['intranet.local', 'https://intranet.local/', UnsafeLnurlTargetError],
  ])('%s is rejected with no fetch and no DNS lookup', async (_label, raw, errorClass) => {
    const fetchImpl = neverFetch();
    vi.stubGlobal('fetch', fetchImpl);

    await expect(resolveLnurlPay(raw, fetchImpl)).rejects.toThrow(errorClass);
    await expect(requestInvoiceFor(raw, sats(10), fetchImpl)).rejects.toThrow(errorClass);
    await expect(resolveLnurlPay(raw)).rejects.toThrow(errorClass);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(dns.lookup).not.toHaveBeenCalled();
  });

  it('never echoes the scanned code in the error message', async () => {
    const raw = 'https://card.paybee.buzz/sample-card?secret=hunter2';
    const message = await messageOf(resolveLnurlPay(raw, neverFetch()));
    expect(message).not.toMatch(/sample-card|hunter2|secret|card\.paybee/);
  });

  it('refuses a callback URL that points at a private address', async () => {
    const fetchImpl = neverFetch();
    for (const callback of [
      'https://10.0.0.5/cb',
      'https://169.254.169.254/latest/meta-data',
      'https://localhost/cb',
      'http://example.com/cb',
    ]) {
      await expect(requestLnurlInvoice(callback, sats(1), fetchImpl)).rejects.toThrow(
        InvalidLightningAddressError,
      );
    }
    await expect(
      requestLnurlInvoice('https://card.paybee.buzz/cb', sats(1), fetchImpl),
    ).rejects.toThrow(SpendCredentialRejectedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a malicious payRequest whose callback is internal, after exactly one fetch', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ ...PAYREQUEST, callback: 'https://10.0.0.5/steal' }),
    ) as unknown as FetchLike & ReturnType<typeof vi.fn>;

    await expect(
      requestInvoiceFor('sample-wallet@example.com', sats(10), fetchImpl),
    ).rejects.toThrow(UnsafeLnurlTargetError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('guarded fetch behaviour', () => {
  it('sends redirect:manual and an abort signal', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PAYREQUEST)) as unknown as FetchLike &
      ReturnType<typeof vi.fn>;
    await resolveLnurlPay('sample-wallet@example.com', fetchImpl);

    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not follow a redirect — it is a definitive failure', async () => {
    const fetchImpl = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/' },
      })) as FetchLike;
    const error = await resolveLnurlPay('sample-wallet@example.com', fetchImpl).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(InvalidLightningAddressError);
    expect(error).not.toBeInstanceOf(LightningEndpointUnreachableError);
    expect((error as Error).message).not.toContain('169.254');
  });

  it('classifies HTTP 503 and 429 as transient, 404 as definitive', async () => {
    for (const status of [500, 503, 429]) {
      const fetchImpl = (async () => jsonResponse({}, status)) as FetchLike;
      await expect(resolveLnurlPay('a@example.com', fetchImpl)).rejects.toThrow(
        LightningEndpointUnreachableError,
      );
    }

    const notFound = (async () => jsonResponse({}, 404)) as FetchLike;
    const error = await resolveLnurlPay('a@example.com', notFound).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidLightningAddressError);
    expect(error).not.toBeInstanceOf(LightningEndpointUnreachableError);
  });

  it('classifies a network error as transient', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed: ECONNREFUSED 1.2.3.4');
    }) as FetchLike;
    const error = await resolveLnurlPay('a@example.com', fetchImpl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LightningEndpointUnreachableError);
    expect((error as Error).message).toBe('Could not reach example.com');
  });

  it('times out a hung endpoint as transient', async () => {
    vi.useFakeTimers();
    const fetchImpl = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as FetchLike;

    const outcome = resolveLnurlPay('a@example.com', fetchImpl).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const error = await outcome;
    expect(error).toBeInstanceOf(LightningEndpointUnreachableError);
    expect((error as Error).message).toBe('Timed out contacting example.com');
  });

  it('treats non-JSON and a non-LNURL JSON body as definitive', async () => {
    const html = (async () => new Response('<html></html>', { status: 200 })) as FetchLike;
    const error = await resolveLnurlPay('a@example.com', html).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidLightningAddressError);
    expect(error).not.toBeInstanceOf(LightningEndpointUnreachableError);

    const wrongShape = (async () => jsonResponse({ hello: 'world' })) as FetchLike;
    await expect(resolveLnurlPay('a@example.com', wrongShape)).rejects.toThrow(
      InvalidLightningAddressError,
    );
  });

  it('rejects an oversize body, by header and by streaming', async () => {
    const big = JSON.stringify({ ...PAYREQUEST, metadata: 'x'.repeat(70 * 1024) });

    const byStream = (async () => new Response(big, { status: 200 })) as FetchLike;
    await expect(resolveLnurlPay('a@example.com', byStream)).rejects.toThrow(/oversize/);

    const byHeader = (async () =>
      new Response('{}', {
        status: 200,
        headers: { 'content-length': String(70 * 1024) },
      })) as FetchLike;
    await expect(resolveLnurlPay('a@example.com', byHeader)).rejects.toThrow(/oversize/);
  });

  it('accepts a body just under the cap', async () => {
    const body = JSON.stringify({ ...PAYREQUEST, metadata: 'x'.repeat(60 * 1024) });
    const fetchImpl = (async () => new Response(body, { status: 200 })) as FetchLike;
    await expect(resolveLnurlPay('a@example.com', fetchImpl)).resolves.toMatchObject({
      receiveCapable: true,
    });
  });

  it('rejects a payRequest with no sendable range', async () => {
    const fetchImpl = (async () =>
      jsonResponse({ tag: 'payRequest', callback: 'https://example.com/cb' })) as FetchLike;
    await expect(resolveLnurlPay('a@example.com', fetchImpl)).rejects.toThrow(
      InvalidLightningAddressError,
    );
  });

  it('error messages carry a hostname, never the raw code or the remote reason', async () => {
    const reason = (async () =>
      jsonResponse({ status: 'ERROR', reason: 'k1=SECRET no such user' })) as FetchLike;
    const message = await messageOf(resolveLnurlPay('hunter2@example.com', reason));
    expect(message).toBe('example.com rejected the request');

    const withdraw = (async () =>
      jsonResponse({ tag: 'withdrawRequest', callback: 'https://example.com/w' })) as FetchLike;
    const withdrawMessage = await messageOf(resolveLnurlPay('hunter2@example.com', withdraw));
    expect(withdrawMessage).not.toContain('hunter2');
    expect(withdrawMessage).toContain('example.com');
  });
});

describe('DNS check (default fetch only)', () => {
  it('rejects a hostname that resolves to a private address, before fetching', async () => {
    const fetchImpl = neverFetch();
    vi.stubGlobal('fetch', fetchImpl);
    dns.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.7', family: 4 },
    ]);

    await expect(resolveLnurlPay('a@rebind.example.com')).rejects.toThrow(UnsafeLnurlTargetError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a hostname that resolves to a private IPv6 address', async () => {
    vi.stubGlobal('fetch', neverFetch());
    dns.lookup.mockResolvedValue([{ address: 'fd00::1', family: 6 }]);
    await expect(resolveLnurlPay('a@example.com')).rejects.toThrow(UnsafeLnurlTargetError);
  });

  it('treats a DNS failure as transient', async () => {
    vi.stubGlobal('fetch', neverFetch());
    dns.lookup.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
    );
    await expect(resolveLnurlPay('a@example.com')).rejects.toThrow(
      LightningEndpointUnreachableError,
    );
  });

  it('fetches via the global fetch once every address is public', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(PAYREQUEST));
    vi.stubGlobal('fetch', fetchImpl);
    dns.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);

    await expect(resolveLnurlPay('sample-wallet@example.com')).resolves.toMatchObject({
      receiveCapable: true,
    });
    expect(dns.lookup).toHaveBeenCalledWith('example.com', expect.objectContaining({ all: true }));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('checks the callback host too', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ pr: 'lnbc1...' }));
    vi.stubGlobal('fetch', fetchImpl);
    dns.lookup.mockResolvedValue([{ address: '192.168.1.5', family: 4 }]);

    await expect(requestLnurlInvoice('https://pay.example.com/cb', sats(1))).rejects.toThrow(
      UnsafeLnurlTargetError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('is skipped when a fetchImpl is injected', async () => {
    const fetchImpl = (async () => jsonResponse(PAYREQUEST)) as FetchLike;
    await resolveLnurlPay('sample-wallet@example.com', fetchImpl);
    expect(dns.lookup).not.toHaveBeenCalled();
  });
});
