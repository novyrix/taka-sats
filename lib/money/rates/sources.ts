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

function positiveNumber(value: unknown, context: string): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${context}: expected a positive number, got ${String(value)}`);
  }
  return n;
}

/** yadio.io — supports BTC↔KES directly. `GET /rate/BTC/{quote}` → `{ rate }`. */
export const yadioSource: RateSource = {
  name: 'yadio',
  async fetchRate(base, quote, fetchImpl = fetch) {
    const body = (await getJson(
      `https://api.yadio.io/rate/${encodeURIComponent(base)}/${encodeURIComponent(quote)}`,
      fetchImpl,
    )) as { rate?: unknown };
    return positiveNumber(body.rate, 'yadio.rate');
  },
};

/** CoinGecko simple price. `?ids=bitcoin&vs_currencies={quote}` → `{ bitcoin: { kes: N } }`. */
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
