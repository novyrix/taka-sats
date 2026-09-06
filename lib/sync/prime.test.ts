// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { primeWeighCache } from './prime';
import { closeSyncDb, getAnySessionConfig, searchCachedCollectors } from './store';

const BOOTSTRAP = {
  session: {
    sessionId: 's1',
    location: 'Kibera Hub',
    scheduledStart: '2026-06-10T08:00:00.000Z',
    scheduledEnd: '2026-06-10T14:00:00.000Z',
  },
  rates: [{ rateId: 'r1', material: 'PET', rateFiatMinor: 2200, fiatCurrency: 'KES' }],
  exchangeRate: 5_000_000,
  collectors: [
    { id: 'c1', alias: 'Amina', nfcTagId: 'TAG-1', status: 'active' },
    { id: 'c2', alias: 'Brian', nfcTagId: null, status: 'active' },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  await closeSyncDb();
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await closeSyncDb();
});

describe('primeWeighCache', () => {
  it('on a good response, writes the session config + collectors and reports "network"', async () => {
    const result = await primeWeighCache(async () => jsonResponse(BOOTSTRAP));
    expect(result.source).toBe('network');
    expect(result.config?.sessionId).toBe('s1');
    expect(result.config?.exchangeRate).toBe(5_000_000);

    expect((await getAnySessionConfig())?.location).toBe('Kibera Hub');
    expect((await searchCachedCollectors('ami')).map((c) => c.id)).toEqual(['c1']);
  });

  it('falls back to the cache on an HTTP error', async () => {
    await primeWeighCache(async () => jsonResponse(BOOTSTRAP)); // seed the cache
    const result = await primeWeighCache(async () => jsonResponse({}, 503));
    expect(result.source).toBe('cache');
    expect(result.config?.sessionId).toBe('s1');
  });

  it('falls back to the cache when the fetch throws (offline)', async () => {
    await primeWeighCache(async () => jsonResponse(BOOTSTRAP));
    const result = await primeWeighCache(async () => {
      throw new TypeError('Failed to fetch');
    });
    expect(result.source).toBe('cache');
  });

  it('reports "none" with a reason when there is nothing cached and no exchange rate', async () => {
    const result = await primeWeighCache(async () =>
      jsonResponse({ ...BOOTSTRAP, exchangeRate: null }),
    );
    expect(result).toMatchObject({ source: 'none', config: null });
    expect((result as { reason: string }).reason).toMatch(/exchange rate/i);
  });
});
