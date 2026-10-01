// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { exchangeRateSnapshots } from '@/lib/db/schema';
import {
  ExchangeFeedError,
  fetchExchangeRate,
  isRateStale,
  latestSnapshot,
  requireFreshRate,
  resolveSource,
  StaleRateError,
} from './index';
import type { FetchLike } from './sources';

/** A fetch stub keyed by a substring of the URL → the JSON body to return. */
function fakeFetch(routes: Record<string, unknown>): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const url = input.toString();
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) {
      throw new Error(`no route for ${url}`);
    }
    return new Response(JSON.stringify(hit[1]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as FetchLike;
}

describe('resolveSource', () => {
  it('resolves known names and a fake:<n> literal', () => {
    expect(resolveSource('yadio').name).toBe('yadio');
    expect(resolveSource('coinbase').name).toBe('coinbase');
    expect(resolveSource('fake:123').name).toBe('fake');
    expect(() => resolveSource('nope')).toThrow();
  });
});

describe('isRateStale', () => {
  it('is true past the TTL', () => {
    const snap = { fetchedAt: new Date('2026-01-01T00:00:00Z') } as never;
    expect(isRateStale(snap, 900, new Date('2026-01-01T00:20:00Z'))).toBe(true);
    expect(isRateStale(snap, 900, new Date('2026-01-01T00:10:00Z'))).toBe(false);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('fetchExchangeRate (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    await db.execute(sql`truncate table exchange_rate_snapshots restart identity cascade`);
  });
  afterAll(async () => {
    await db.execute(sql`truncate table exchange_rate_snapshots restart identity cascade`);
  });

  // Bodies are shaped like the real services' responses (see sources.test.ts).
  const yadio = (kes: number) => ({
    request: { amount: 1, from: 'BTC', to: 'KES' },
    result: kes,
  });
  const coinbase = (kes: number) => ({
    data: { amount: String(kes), base: 'BTC', currency: 'KES' },
  });
  const kraken = (usd: number) => ({ result: { XXBTZUSD: { c: [String(usd), '1'] } } });
  const fx = { result: 'success', rates: { KES: 100 } };

  it('aggregates the agreeing sources (median) and persists a snapshot', async () => {
    const fetchImpl = fakeFetch({
      'api.yadio.io': yadio(5_000_000),
      'api.coinbase.com': coinbase(5_050_000),
      'api.kraken.com': kraken(50_300), // × 100 = 5_030_000
      'open.er-api.com': fx,
    });
    const snap = await fetchExchangeRate(db, { quote: 'KES', fetchImpl });
    expect(snap.base).toBe('BTC');
    expect(snap.quote).toBe('KES');
    expect(Number(snap.rate)).toBe(5_030_000); // median of the three
    expect(snap.sources).toHaveLength(3);

    const latest = await latestSnapshot(db, 'BTC', 'KES');
    expect(latest?.id).toBe(snap.id);
  });

  it('survives one source being down — two is enough', async () => {
    const fetchImpl = fakeFetch({
      'api.yadio.io': yadio(5_000_000),
      'api.coinbase.com': coinbase(5_050_000),
      // kraken/er-api routes missing → that source throws
    });
    const snap = await fetchExchangeRate(db, { quote: 'KES', fetchImpl });
    expect(Number(snap.rate)).toBe(5_025_000);
    expect(snap.sources).toHaveLength(2);
  });

  it('fails when fewer than two sources succeed', async () => {
    const fetchImpl = fakeFetch({ 'api.yadio.io': yadio(5_000_000) });
    await expect(fetchExchangeRate(db, { quote: 'KES', fetchImpl })).rejects.toThrow(
      ExchangeFeedError,
    );
  });

  it('sets a lone outlier aside when two others agree, and records all three', async () => {
    const fetchImpl = fakeFetch({
      'api.yadio.io': yadio(5_000_000),
      'api.coinbase.com': coinbase(5_100_000),
      'api.kraken.com': kraken(70_000), // × 100 = 7_000_000 — an unreasonable outlier
      'open.er-api.com': fx,
    });
    const snap = await fetchExchangeRate(db, { quote: 'KES', fetchImpl });
    expect(Number(snap.rate)).toBe(5_050_000); // median of the two that agree
    expect(snap.sources).toHaveLength(3);
  });

  it('two sources may not be further apart than the tolerance (not twice it)', async () => {
    // 5.0M vs 5.8M: each is only ~7.4% from their mean (inside 10%), but 15% apart.
    const fetchImpl = fakeFetch({
      'api.yadio.io': yadio(5_000_000),
      'api.coinbase.com': coinbase(5_800_000),
    });
    await expect(fetchExchangeRate(db, { quote: 'KES', fetchImpl })).rejects.toThrow(
      ExchangeFeedError,
    );
  });

  it('fails when a source diverges beyond the tolerance — e.g. an inverted or unit-confused feed', async () => {
    const fetchImpl = fakeFetch({
      'api.yadio.io': yadio(5_000_000),
      'api.coinbase.com': coinbase(9_000_000), // ~+56% vs median
    });
    await expect(fetchExchangeRate(db, { quote: 'KES', fetchImpl })).rejects.toThrow(
      ExchangeFeedError,
    );
  });

  it('requireFreshRate throws with no snapshot, then passes once one is fresh', async () => {
    await expect(requireFreshRate(db, 'BTC', 'KES')).rejects.toThrow(StaleRateError);

    await db.insert(exchangeRateSnapshots).values({
      base: 'BTC',
      quote: 'KES',
      rate: '5000000',
      sources: [{ source: 'fake', rate: 5_000_000 }],
      fetchedAt: new Date(),
    });
    const fresh = await requireFreshRate(db, 'BTC', 'KES');
    expect(fresh.quote).toBe('KES');
  });

  it('requireFreshRate throws when the latest snapshot is older than the TTL', async () => {
    await db.insert(exchangeRateSnapshots).values({
      base: 'BTC',
      quote: 'KES',
      rate: '5000000',
      sources: [{ source: 'fake', rate: 5_000_000 }],
      fetchedAt: new Date('2020-01-01T00:00:00Z'),
    });
    await expect(requireFreshRate(db, 'BTC', 'KES')).rejects.toThrow(StaleRateError);
  });
});
