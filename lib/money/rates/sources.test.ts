// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The rate-source adapters against response bodies captured from the REAL services
 * (2026-10-01). The first version of these adapters was tested against invented shapes that
 * matched the adapters, so two real defects — Yadio's inverted `/rate` endpoint and CoinGecko's
 * empty KES answer — went unnoticed until a live call. Keep these fixtures real.
 */

import { describe, expect, it } from 'vitest';
import {
  coinbaseSource,
  coingeckoSource,
  type FetchLike,
  krakenFxSource,
  resolveSource,
  yadioSource,
} from './sources';

/** A fetch stub keyed by a URL substring → JSON body (or a Response for a failure). */
function routes(table: Record<string, unknown>): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const url = input.toString();
    const hit = Object.entries(table).find(([key]) => url.includes(key));
    if (!hit) {
      throw new Error(`unexpected request: ${url}`);
    }
    return hit[1] instanceof Response
      ? hit[1]
      : new Response(JSON.stringify(hit[1]), { status: 200 });
  }) as FetchLike;
}

const YADIO_BTC_KES = {
  request: { amount: 1, from: 'BTC', to: 'KES' },
  result: 10839680.62,
  rate: 10839680.622109,
  timestamp: 1790845511892,
};
const COINBASE_BTC_KES = {
  data: { amount: '10844580.903750155443171983', base: 'BTC', currency: 'KES' },
};
const KRAKEN_XBTUSD = {
  error: [],
  result: { XXBTZUSD: { a: ['83578.70000', '1', '1.000'], c: ['83582.10000', '0.00085213'] } },
};
const ER_API_USD = { result: 'success', base_code: 'USD', rates: { USD: 1, KES: 129.5 } };

describe('yadio', () => {
  it('reads KES per BTC from the convert endpoint', async () => {
    const fetchImpl = routes({ 'api.yadio.io/convert/1/BTC/KES': YADIO_BTC_KES });
    expect(await yadioSource.fetchRate('BTC', 'KES', fetchImpl)).toBe(10839680.62);
  });

  it('asks for the pair the right way round (the /rate endpoint is inverted)', async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      seen.push(input.toString());
      return new Response(JSON.stringify(YADIO_BTC_KES), { status: 200 });
    }) as FetchLike;
    await yadioSource.fetchRate('BTC', 'KES', fetchImpl);
    expect(seen).toEqual(['https://api.yadio.io/convert/1/BTC/KES']);
    expect(seen[0]).not.toContain('/rate/');
  });

  it('refuses a response that is for a different pair — never trusts a swapped answer', async () => {
    const swapped = { ...YADIO_BTC_KES, request: { amount: 1, from: 'KES', to: 'BTC' } };
    await expect(
      yadioSource.fetchRate('BTC', 'KES', routes({ 'api.yadio.io': swapped })),
    ).rejects.toThrow(/not for the requested pair/);
  });

  it('refuses a number with trailing junk instead of reading its prefix', async () => {
    for (const result of ['5e6abc', '10839680.62 KES', '', '  ', '0x10']) {
      await expect(
        yadioSource.fetchRate(
          'BTC',
          'KES',
          routes({ 'api.yadio.io': { request: { from: 'BTC', to: 'KES' }, result } }),
        ),
      ).rejects.toThrow();
    }
  });

  it('refuses a non-positive or missing result', async () => {
    for (const result of [0, -1, 'NaN', undefined]) {
      await expect(
        yadioSource.fetchRate(
          'BTC',
          'KES',
          routes({ 'api.yadio.io': { request: { from: 'BTC', to: 'KES' }, result } }),
        ),
      ).rejects.toThrow();
    }
  });
});

describe('coinbase', () => {
  it('reads the BTC-KES spot price', async () => {
    const fetchImpl = routes({ 'api.coinbase.com/v2/prices/BTC-KES/spot': COINBASE_BTC_KES });
    expect(await coinbaseSource.fetchRate('BTC', 'KES', fetchImpl)).toBeCloseTo(10844580.9, 0);
  });

  it('refuses a response for a different pair', async () => {
    const wrong = { data: { amount: '83580.5', base: 'BTC', currency: 'USD' } };
    await expect(
      coinbaseSource.fetchRate('BTC', 'KES', routes({ 'api.coinbase.com': wrong })),
    ).rejects.toThrow(/not for the requested pair/);
  });

  it('surfaces an HTTP error', async () => {
    const fetchImpl = routes({ 'api.coinbase.com': new Response('', { status: 429 }) });
    await expect(coinbaseSource.fetchRate('BTC', 'KES', fetchImpl)).rejects.toThrow(/HTTP 429/);
  });
});

describe('kraken_fx (BTC/USD × USD/quote cross)', () => {
  const both = { 'api.kraken.com': KRAKEN_XBTUSD, 'open.er-api.com': ER_API_USD };

  it('multiplies the two independent legs', async () => {
    expect(await krakenFxSource.fetchRate('BTC', 'KES', routes(both))).toBeCloseTo(
      83582.1 * 129.5,
      2,
    );
  });

  it('needs no FX leg for USD', async () => {
    const fetchImpl = routes({ 'api.kraken.com': KRAKEN_XBTUSD }); // an FX request would throw
    expect(await krakenFxSource.fetchRate('BTC', 'USD', fetchImpl)).toBe(83582.1);
  });

  it('fails if the FX table has no such currency or is not a success', async () => {
    await expect(krakenFxSource.fetchRate('BTC', 'ZZZ', routes(both))).rejects.toThrow(
      /er-api.rates.ZZZ/,
    );
    await expect(
      krakenFxSource.fetchRate(
        'BTC',
        'KES',
        routes({ ...both, 'open.er-api.com': { result: 'error' } }),
      ),
    ).rejects.toThrow(/successful rate table/);
  });

  it('only supports BTC as the base', async () => {
    await expect(krakenFxSource.fetchRate('ETH', 'KES', routes(both))).rejects.toThrow(
      /only supports base BTC/,
    );
  });
});

describe('coingecko', () => {
  it('reads a currency it lists', async () => {
    const fetchImpl = routes({ 'api.coingecko.com': { bitcoin: { usd: 83563 } } });
    expect(await coingeckoSource.fetchRate('BTC', 'USD', fetchImpl)).toBe(83563);
  });

  it('fails loudly on the empty body the keyless API returns for KES', async () => {
    const fetchImpl = routes({ 'api.coingecko.com': { bitcoin: {} } });
    await expect(coingeckoSource.fetchRate('BTC', 'KES', fetchImpl)).rejects.toThrow(
      /coingecko.bitcoin.kes/,
    );
  });
});

describe('resolveSource', () => {
  it('knows every default source, and rejects an unknown name', () => {
    for (const name of ['yadio', 'coinbase', 'kraken_fx', 'coingecko', 'fake']) {
      expect(resolveSource(name).name).toBe(name);
    }
    expect(() => resolveSource('nope')).toThrow(/Unknown exchange source/);
  });
});
