// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Exchange-rate sources (D-18, ROADMAP M2-9). Each returns `quote` units per
 * 1 `base` (e.g. KES per BTC). `fetchImpl` is injectable so tests never hit
 * the network. Zero framework imports (D-04).
 */

export type FetchLike = typeof fetch;

export interface RateSource {
  readonly name: string;
  fetchRate(base: string, quote: string, fetchImpl?: FetchLike): Promise<number>;
}

async function getJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`${url} returned HTTP ${res.status}`);
  }
  return res.json();
}

const DECIMAL = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function positiveNumber(value: unknown, context: string): number {
  // A strict decimal, not parseFloat() ("5e6abc" would read as 5,000,000) and not Number()
  // ("0x10" would read as 16).
  const n = typeof value === 'string' ? (DECIMAL.test(value) ? Number(value) : Number.NaN) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${context}: expected a positive number, got ${String(value)}`);
  }
  return n;
}

/**
 * yadio.io — BTC↔KES directly. Uses `/convert/1/{base}/{quote}` because its
 * response names the pair (`request.from` / `request.to`), which we check: the sibling
 * `/rate/{a}/{b}` endpoint is *inverted* (`/rate/BTC/KES` is BTC per KES, ~9e-8) and
 * silently wrong if the arguments are swapped. Verified against the live API 2026-10-01.
 */
export const yadioSource: RateSource = {
  name: 'yadio',
  async fetchRate(base, quote, fetchImpl = fetch) {
    const body = (await getJson(
      `https://api.yadio.io/convert/1/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`,
      fetchImpl,
    )) as { request?: { from?: unknown; to?: unknown }; result?: unknown };
    if (
      String(body.request?.from).toUpperCase() !== base.toUpperCase() ||
      String(body.request?.to).toUpperCase() !== quote.toUpperCase()
    ) {
      throw new Error('yadio: the response is not for the requested pair');
    }
    return positiveNumber(body.result, 'yadio.result');
  },
};

/** Coinbase spot price, `GET /v2/prices/{base}-{quote}/spot`. Supports BTC-KES directly. */
export const coinbaseSource: RateSource = {
  name: 'coinbase',
  async fetchRate(base, quote, fetchImpl = fetch) {
    const body = (await getJson(
      `https://api.coinbase.com/v2/prices/${encodeURIComponent(base)}-${encodeURIComponent(quote)}/spot`,
      fetchImpl,
    )) as { data?: { amount?: unknown; base?: unknown; currency?: unknown } };
    if (
      String(body.data?.base).toUpperCase() !== base.toUpperCase() ||
      String(body.data?.currency).toUpperCase() !== quote.toUpperCase()
    ) {
      throw new Error('coinbase: the response is not for the requested pair');
    }
    return positiveNumber(body.data?.amount, 'coinbase.data.amount');
  },
};

/**
 * Kraken BTC/USD × USD→`quote` from open.er-api.com — a *cross rate* built from two
 * independent services, for quotes (e.g. KES) that a direct BTC pair does not cover.
 * The FX leg refreshes daily, which the `money.rate_deviation_tolerance_pct` check absorbs.
 * (open.er-api.com's free tier asks for attribution: https://www.exchangerate-api.com)
 */
export const krakenFxSource: RateSource = {
  name: 'kraken_fx',
  async fetchRate(base, quote, fetchImpl = fetch) {
    if (base.toUpperCase() !== 'BTC') {
      throw new Error(`kraken_fx source only supports base BTC (got ${base})`);
    }
    const ticker = (await getJson(
      'https://api.kraken.com/0/public/Ticker?pair=XBTUSD',
      fetchImpl,
    )) as { result?: Record<string, { c?: unknown[] }> };
    const btcUsd = positiveNumber(
      Object.values(ticker.result ?? {})[0]?.c?.[0],
      'kraken.XBTUSD.last',
    );

    if (quote.toUpperCase() === 'USD') {
      return btcUsd;
    }
    const fx = (await getJson('https://open.er-api.com/v6/latest/USD', fetchImpl)) as {
      result?: unknown;
      rates?: Record<string, unknown>;
    };
    if (fx.result !== 'success') {
      throw new Error('open.er-api.com did not return a successful rate table');
    }
    return btcUsd * positiveNumber(fx.rates?.[quote.toUpperCase()], `er-api.rates.${quote}`);
  },
};

/**
 * CoinGecko simple price. `?ids=bitcoin&vs_currencies={quote}` → `{ bitcoin: { kes: N } }`.
 * NOTE: as of 2026-10-01 the keyless endpoint returns `{"bitcoin":{}}` for KES, so this
 * is not a default source for KES — it works for currencies CoinGecko lists (e.g. USD).
 */
export const coingeckoSource: RateSource = {
  name: 'coingecko',
  async fetchRate(base, quote, fetchImpl = fetch) {
    if (base.toUpperCase() !== 'BTC') {
      throw new Error(`coingecko source only supports base BTC (got ${base})`);
    }
    const q = quote.toLowerCase();
    const body = (await getJson(
      `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${encodeURIComponent(q)}`,
      fetchImpl,
    )) as { bitcoin?: Record<string, unknown> };
    return positiveNumber(body.bitcoin?.[q], `coingecko.bitcoin.${q}`);
  },
};

/** Deterministic source for tests/dev. `fake:<rate>` sets the value; bare `fake` → 5,000,000. */
export function fakeSource(rate = 5_000_000): RateSource {
  return {
    name: 'fake',
    fetchRate: async () => rate,
  };
}

const REGISTRY: Record<string, RateSource> = {
  yadio: yadioSource,
  coinbase: coinbaseSource,
  kraken_fx: krakenFxSource,
  coingecko: coingeckoSource,
  fake: fakeSource(),
};

/** Resolve a configured source name (supports `fake:<n>`). Throws on an unknown name. */
export function resolveSource(name: string): RateSource {
  if (name.startsWith('fake:')) {
    return fakeSource(Number.parseFloat(name.slice(5)) || 5_000_000);
  }
  const source = REGISTRY[name];
  if (!source) {
    throw new Error(
      `Unknown exchange source "${name}" (known: ${Object.keys(REGISTRY).join(', ')})`,
    );
  }
  return source;
}
