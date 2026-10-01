// SPDX-License-Identifier: AGPL-3.0-only

import { and, desc, eq, ilike, inArray, or, type SQL } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import { collectorPaymentDestinations, collectors } from '@/lib/db/schema';
import type { CollectorRecord, CollectorStatus, DestinationRecord } from './types';

const SUMMARY = {
  id: collectors.id,
  alias: collectors.alias,
  publicCode: collectors.publicCode,
  nfcTagId: collectors.nfcTagId,
  status: collectors.status,
} as const;

export async function findCollectorById(db: Database, id: string): Promise<CollectorRecord | null> {
  const [row] = await db.select().from(collectors).where(eq(collectors.id, id));
  return row ?? null;
}

export async function findCollectorByCode(
  db: Database,
  publicCode: string,
): Promise<CollectorRecord | null> {
  const [row] = await db.select().from(collectors).where(eq(collectors.publicCode, publicCode));
  return row ?? null;
}

/** A compact projection for lookup, search and the offline cache (§7.1, G2, M1-8). */
export type CollectorSummary = Pick<
  CollectorRecord,
  'id' | 'alias' | 'publicCode' | 'nfcTagId' | 'status'
>;

export type CollectorSearch = {
  /** Matches an alias or a public code (so `0042` finds `TS-KBR-0042`). Case-insensitive substring. */
  readonly q?: string | undefined;
  /** Defaults to `active`; `all` skips the filter. */
  readonly status?: CollectorStatus | 'all' | undefined;
  /** Only collectors registered by this staff member. */
  readonly registeredBy?: string | undefined;
  readonly limit?: number | undefined;
};

/** Escape `%`, `_` and `\` so user input is matched literally by ILIKE. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Search collectors by alias or public code, newest first, capped. The fully
 * offline version searches the PWA's cached list (M3-2/M3-3); this is the online
 * path, and the staff queue (`status: 'pending'`).
 */
export async function searchCollectors(
  db: Database,
  { q, status = 'active', registeredBy, limit = 20 }: CollectorSearch,
): Promise<CollectorSummary[]> {
  const conditions: (SQL | undefined)[] = [
    status === 'all' ? undefined : eq(collectors.status, status),
    registeredBy ? eq(collectors.registeredBy, registeredBy) : undefined,
    q
      ? or(ilike(collectors.alias, likePattern(q)), ilike(collectors.publicCode, likePattern(q)))
      : undefined,
  ];
  return db
    .select(SUMMARY)
    .from(collectors)
    .where(and(...conditions))
    .orderBy(desc(collectors.enrolledAt))
    .limit(Math.min(Math.max(limit, 1), 100));
}

/**
 * Every authorized (`active`) collector, capped, for the PWA to cache before going
 * offline (M3-2/M3-3). Pending and revoked collectors are never cached, so the
 * authorization gate holds offline too. Newest first so a truncated cache still
 * holds the collectors a supervisor most likely just registered.
 */
export async function listActiveCollectors(
  db: Database,
  limit = 5000,
): Promise<CollectorSummary[]> {
  return db
    .select(SUMMARY)
    .from(collectors)
    .where(eq(collectors.status, 'active'))
    .orderBy(desc(collectors.enrolledAt))
    .limit(Math.min(Math.max(limit, 1), 20_000));
}

/** The live (pending or verified) destination of each given collector, keyed by collector id. */
export async function liveDestinationsFor(
  db: Database,
  collectorIds: readonly string[],
): Promise<Map<string, DestinationRecord>> {
  if (collectorIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .select()
    .from(collectorPaymentDestinations)
    .where(
      and(
        inArray(collectorPaymentDestinations.collectorId, [...collectorIds]),
        inArray(collectorPaymentDestinations.status, ['pending_validation', 'verified']),
      ),
    );
  return new Map(rows.map((row) => [row.collectorId, row]));
}
