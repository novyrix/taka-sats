// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The BTC↔fiat exchange feed (US-7.3, D-18).
 *
 * Fetches every configured source, requires at least two to succeed, rejects
 * the batch if any reading diverges too far from the median, then persists
 * one `exchange_rate_snapshots` row. A payout will not run against a
 * snapshot older than `settings.money.rate_staleness_ttl_seconds` — see
 * {@link requireFreshRate}, which M5's payout path calls.
 *
 * Framework-free (D-04) apart from Drizzle.
 */

import { and, desc, eq, type InferSelectModel } from 'drizzle-orm';
import { getSettings } from '@/lib/config';
import type { Database } from '@/lib/db/client';
import { exchangeRateSnapshots } from '@/lib/db/schema';
import { type FetchLike, resolveSource } from './sources';

export type ExchangeSnapshot = InferSelectModel<typeof exchangeRateSnapshots>;
export type RateReading = { source: string; rate: number };

export class ExchangeFeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExchangeFeedError';
  }
}

/** No usable rate exists, or the latest one is older than the configured TTL. */
export class StaleRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleRateError';
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
    : (sorted[mid] ?? 0);
}

export type FetchExchangeRateOptions = {
  readonly base?: string;
  readonly quote?: string;
  readonly fetchImpl?: FetchLike;
  readonly now?: Date;
};

/**
 * Fetch, aggregate, and persist a fresh snapshot.
 * @throws {ExchangeFeedError} fewer than two sources succeeded, or the
 *   readings diverge beyond `money.rate_deviation_tolerance_pct`.
 */
export async function fetchExchangeRate(
  db: Database,
  options: FetchExchangeRateOptions = {},
): Promise<ExchangeSnapshot> {
  const settings = getSettings();
  const base = options.base ?? 'BTC';
  const quote = options.quote ?? settings.programme.fiat_currency;

  const results = await Promise.allSettled(
    settings.money.exchange_sources.map(async (name): Promise<RateReading> => {
      const rate = await resolveSource(name).fetchRate(base, quote, options.fetchImpl);
      return { source: name, rate };
    }),
  );

  const readings = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (readings.length < 2) {
    const errors = results
      .flatMap((r) => (r.status === 'rejected' ? [String(r.reason)] : []))
      .join('; ');
    throw new ExchangeFeedError(
      `need ≥2 successful exchange sources for ${base}/${quote}, got ${readings.length} (${errors})`,
    );
  }

  // Which readings can be trusted together? Anything within the tolerance of the median of ALL
  // readings agrees; an outlier is set aside (it stays in `sources` for the record). At least two
  // must agree — and agree *with each other* within the tolerance, so with only two sources a
  // spread wider than the tolerance fails (measured from the median, two sources would otherwise
  // be allowed twice the configured spread).
  const mid = median(readings.map((r) => r.rate));
  const tolerance = settings.money.rate_deviation_tolerance_pct / 100;
  const agreeing = readings.filter((r) => Math.abs(r.rate - mid) / mid <= tolerance);
  const spread =
    (Math.max(...agreeing.map((r) => r.rate)) - Math.min(...agreeing.map((r) => r.rate))) / mid;
  if (agreeing.length < 2 || spread > tolerance) {
    throw new ExchangeFeedError(
      `exchange sources for ${base}/${quote} disagree by more than ${settings.money.rate_deviation_tolerance_pct}%: ${readings
        .map((r) => `${r.source}=${r.rate}`)
        .join(', ')}`,
    );
  }
  const agreed = median(agreeing.map((r) => r.rate));

  const [row] = await db
    .insert(exchangeRateSnapshots)
    .values({
      base,
      quote,
      rate: String(agreed),
      sources: readings,
      fetchedAt: options.now ?? new Date(),
    })
    .returning();
  if (!row) {
    throw new ExchangeFeedError('failed to persist the exchange snapshot');
  }
  return row;
}

/** The most recent snapshot for a pair, or null. */
export async function latestSnapshot(
  db: Database,
  base = 'BTC',
  quote?: string,
): Promise<ExchangeSnapshot | null> {
  const q = quote ?? getSettings().programme.fiat_currency;
  const [row] = await db
    .select()
    .from(exchangeRateSnapshots)
    .where(and(eq(exchangeRateSnapshots.base, base), eq(exchangeRateSnapshots.quote, q)))
    .orderBy(desc(exchangeRateSnapshots.fetchedAt))
    .limit(1);
  return row ?? null;
}

export function snapshotAgeSeconds(snapshot: ExchangeSnapshot, now: Date = new Date()): number {
  return (now.getTime() - snapshot.fetchedAt.getTime()) / 1000;
}

export function isRateStale(
  snapshot: ExchangeSnapshot,
  ttlSeconds: number,
  now: Date = new Date(),
): boolean {
  return snapshotAgeSeconds(snapshot, now) > ttlSeconds;
}

/**
 * The rate M5's payout path must use.
 * @throws {StaleRateError} no snapshot, or the latest is older than the TTL.
 */
export async function requireFreshRate(
  db: Database,
  base = 'BTC',
  quote?: string,
  now: Date = new Date(),
): Promise<ExchangeSnapshot> {
  const snapshot = await latestSnapshot(db, base, quote);
  if (!snapshot) {
    throw new StaleRateError(`no exchange snapshot for ${base}/${quote ?? '(default)'}`);
  }
  const ttl = getSettings().money.rate_staleness_ttl_seconds;
  if (isRateStale(snapshot, ttl, now)) {
    throw new StaleRateError(
      `latest ${base}/${snapshot.quote} snapshot is ${Math.round(snapshotAgeSeconds(snapshot, now))}s old (TTL ${ttl}s)`,
    );
  }
  return snapshot;
}

export { resolveSource, fakeSource } from './sources';
export type { RateSource, FetchLike } from './sources';
