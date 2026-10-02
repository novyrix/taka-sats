// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, query } from './api';
import { formatFiat, formatSats, maskAddress, shortId } from './format';
import { collectorDisplay, payoutDisplay, topupDisplay } from './status-map';

const stub = (impl: () => Promise<Response>) => vi.stubGlobal('fetch', vi.fn(impl));
afterEach(() => vi.unstubAllGlobals());

describe('api()', () => {
  it('returns the data of a successful call and sends JSON bodies', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await api<{ ok: number }>('/x', { method: 'POST', body: { a: 1 } });
    expect(res).toEqual({ ok: true, status: 201, data: { ok: 1 } });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/x',
      expect.objectContaining({ method: 'POST', body: '{"a":1}' }),
    );
  });

  it('resolves to the stable error code instead of throwing', async () => {
    stub(
      async () =>
        new Response(JSON.stringify({ error: { code: 'self_approval', message: 'no' } }), {
          status: 403,
        }),
    );
    expect(await api('/x')).toMatchObject({ ok: false, status: 403, code: 'self_approval' });
  });

  it('maps a dead network, a non-JSON error and an empty success to codes', async () => {
    stub(async () => {
      throw new TypeError('offline');
    });
    expect(await api('/x')).toMatchObject({ ok: false, status: 0, code: 'network' });

    stub(async () => new Response('<html>', { status: 502 }));
    expect(await api('/x')).toMatchObject({ ok: false, code: 'http_502' });

    stub(async () => new Response('', { status: 200 }));
    expect(await api('/x')).toMatchObject({ ok: false, code: 'bad_response' });
  });
});

describe('query()', () => {
  it('skips empty values and encodes the rest', () => {
    expect(query({ a: 'x y', b: '', c: undefined, d: 0, e: null })).toBe('?a=x+y&d=0');
    expect(query({})).toBe('');
  });
});

describe('display helpers', () => {
  it('formats sats and minor-unit fiat, and tolerates null', () => {
    expect(formatSats(1234567)).toBe('1,234,567 sats');
    expect(formatSats(null)).toBe('');
    expect(formatFiat(14400)).toBe('KES 144.00');
    expect(formatFiat(5, 'KES')).toBe('KES 0.05');
  });

  it('masks a wallet address for lists and shortens ids', () => {
    expect(maskAddress('akinyi@flow.example.com')).toBe('ak****@flow.example.com');
    expect(maskAddress(null)).toBe('');
    expect(shortId('b5d91027-84ca-461c-862d-cef53ccf20e3')).toBe('b5d91027');
  });

  it('never shows an unknown state as a success', () => {
    expect(payoutDisplay('paid')).toBe('confirmed');
    expect(payoutDisplay('something_new')).toBe('needs_attention');
    expect(collectorDisplay('revoked')).toBe('failed');
    expect(topupDisplay('transferred')).toBe('syncing');
  });
});
