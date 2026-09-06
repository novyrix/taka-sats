// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Prime the offline caches (ROADMAP M3-3/M3-4). Call this on weigh-page entry
 * while online: it pulls `GET /api/v1/weigh/bootstrap` and writes the session
 * config + collector list into IndexedDB. Offline, or on any failure, it falls
 * back to whatever is already cached — the weigh flow stays usable.
 *
 * Browser only (imports `./store`).
 */

import type { CachedSessionConfig, Iso8601 } from '@/types/domain';
import { cacheCollectors, getAnySessionConfig, putSessionConfig } from './store';

type BootstrapResponse = {
  session: {
    sessionId: string;
    location: string;
    scheduledStart: string;
    scheduledEnd: string;
  };
  rates: { rateId: string; material: string; rateFiatMinor: number; fiatCurrency: string }[];
  exchangeRate: number | null;
  collectors: { id: string; alias: string; nfcTagId: string | null; status: string }[];
};

export type PrimeResult =
  | { readonly source: 'network'; readonly config: CachedSessionConfig }
  | { readonly source: 'cache'; readonly config: CachedSessionConfig }
  | { readonly source: 'none'; readonly config: null; readonly reason: string };

/**
 * @param fetchImpl injectable for tests.
 */
export async function primeWeighCache(fetchImpl: typeof fetch = fetch): Promise<PrimeResult> {
  try {
    const res = await fetchImpl('/api/v1/weigh/bootstrap', {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) {
      return fallback(`bootstrap returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as BootstrapResponse;
    if (body.exchangeRate === null) {
      return fallback('no exchange rate is available yet — connect once to sync rates');
    }

    const config: CachedSessionConfig = {
      sessionId: body.session.sessionId,
      location: body.session.location,
      scheduledStart: body.session.scheduledStart as Iso8601,
      scheduledEnd: body.session.scheduledEnd as Iso8601,
      rates: body.rates,
      exchangeRate: body.exchangeRate,
      cachedAt: new Date().toISOString() as Iso8601,
    };
    await putSessionConfig(config);
    await cacheCollectors(body.collectors);
    return { source: 'network', config };
  } catch (error) {
    return fallback(error instanceof Error ? error.message : 'network unavailable');
  }
}

async function fallback(reason: string): Promise<PrimeResult> {
  const config = await getAnySessionConfig();
  return config ? { source: 'cache', config } : { source: 'none', config: null, reason };
}
