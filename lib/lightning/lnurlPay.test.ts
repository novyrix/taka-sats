// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { sats } from '@/lib/money';
import { InvalidLightningAddressError, NotReceiveCapableError } from './errors';
import { requestInvoiceFor, requestLnurlInvoice, resolveLnurlPay } from './lnurlPay';
import type { FetchLike } from './lnurlPay';

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
      'blink.sv': () =>
        jsonResponse({
          tag: 'payRequest',
          callback: 'https://blink.sv/lnurlp/callback/afribit',
          minSendable: 1001,
          maxSendable: 100_000_999,
          metadata: '[["text/plain","pay afribit"]]',
        }),
    });

    const resolved = await resolveLnurlPay('afribit@blink.sv', fetchImpl);
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
      return jsonResponse({ pr: 'lnbc1...' });
    }) as FetchLike;

    const bolt11 = await requestLnurlInvoice('https://blink.sv/callback', sats(500), fetchImpl);
    expect(bolt11).toBe('lnbc1...');
    expect(requestedUrl).toBe('https://blink.sv/callback?amount=500000');
  });

  it('appends amount with & when the callback already has query params', async () => {
    let requestedUrl = '';
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requestedUrl = input.toString();
      return jsonResponse({ pr: 'lnbc1...' });
    }) as FetchLike;

    await requestLnurlInvoice('https://lnbits.example/callback?id=abc', sats(10), fetchImpl);
    expect(requestedUrl).toBe('https://lnbits.example/callback?id=abc&amount=10000');
  });

  it('resolves then requests an invoice end to end, and still rejects a withdraw code', async () => {
    const fetchImpl = fakeFetch({
      '.well-known/lnurlp': () =>
        jsonResponse({
          tag: 'payRequest',
          callback: 'https://blink.sv/lnurlp/callback/afribit',
          minSendable: 1000,
          maxSendable: 100_000_000,
        }),
      '/lnurlp/callback/afribit': () => jsonResponse({ pr: 'lnbc1...' }),
    });

    const bolt11 = await requestInvoiceFor('afribit@blink.sv', sats(1000), fetchImpl);
    expect(bolt11).toBe('lnbc1...');

    const withdrawFetch = fakeFetch({
      evil: () => jsonResponse({ tag: 'withdrawRequest', callback: 'https://evil.test/w' }),
    });
    await expect(
      requestInvoiceFor('withdraw@evil.test', sats(1000), withdrawFetch),
    ).rejects.toThrow(NotReceiveCapableError);
  });
});
