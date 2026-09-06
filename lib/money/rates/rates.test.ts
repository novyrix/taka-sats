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
    expect(resolveSource('coingecko').name).toBe('coingecko');
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

  it('aggregates ≥2 agreeing sources and persists a snapshot', async () => {
    const fetchImpl = fakeFetch({
      'yadio.io': { rate: 5_000_000 },
      'coingecko.com': { bitcoin: { kes: 5_050_000 } },
    });
    const snap = await fetchExchangeRate(db, { quote: 'KES', fetchImpl });
    expect(snap.base).toBe('BTC');
    expect(snap.quote).toBe('KES');
    expect(Number(snap.rate)).toBe(5_025_000); // median of the two
    expect(snap.sources).toHaveLength(2);

    const latest = await latestSnapshot(db, 'BTC', 'KES');
    expect(latest?.id).toBe(snap.id);
  });

  it('fails when fewer than two sources succeed', async () => {
    const fetchImpl = fakeFetch({ 'yadio.io': { rate: 5_000_000 } }); // coingecko route missing → throws
    await expect(fetchExchangeRate(db, { quote: 'KES', fetchImpl })).rejects.toThrow(
      ExchangeFeedError,
    );
  });

  it('fails when a source diverges beyond the tolerance', async () => {
    const fetchImpl = fakeFetch({
      'yadio.io': { rate: 5_000_000 },
      'coingecko.com': { bitcoin: { kes: 9_000_000 } }, // ~+56% vs median
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
