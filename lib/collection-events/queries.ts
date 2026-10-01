// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Read side of collection events, for review screens and session logs. The view type is the
 * allow-list of what leaves the server: it carries the collector's alias and public code,
 * NEVER `photo_url` (an internal storage address — render `photoPath` instead) and never a
 * wallet. GPS coordinates are only included when the caller asks for them (`includeGeo`);
 * everyone else gets just whether a fix exists.
 */

import { and, desc, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  anomalyFlags,
  collectionEvents,
  collectors,
  ledgerEntries,
  payouts,
} from '@/lib/db/schema';
import { decodeCursor, encodeCursor, PAGE_DEFAULT, PAGE_MAX } from '@/lib/pagination';

export type EventView = {
  readonly id: string;
  readonly seq: number;
  readonly collector: { readonly id: string; readonly alias: string; readonly publicCode: string };
  readonly supervisorId: string;
  readonly sessionId: string | null;
  readonly material: string;
  readonly weightKg: number;
  readonly weightSource: string;
  readonly scaleId: string | null;
  readonly indicativeSats: number;
  readonly photoSha256: string;
  readonly photoPath: string;
  readonly recordedAt: Date;
  readonly syncedAt: Date;
  readonly verificationLevel: string;
  readonly verificationStatus: string;
  readonly geo:
    | {
        readonly kind: 'fix';
        readonly lat?: number;
        readonly lng?: number;
        readonly accuracyM?: number;
      }
    | { readonly kind: 'unavailable'; readonly reason?: string };
  readonly payout: {
    readonly id: string;
    readonly status: string;
    readonly amountSats: number | null;
  } | null;
  /** Unreviewed anomaly flags on this event. */
  readonly openFlags: number;
};

export type EventFilter = {
  readonly sessionId?: string | undefined;
  readonly collectorId?: string | undefined;
  readonly material?: string | undefined;
  /** Inclusive start / exclusive end of `recorded_at`. */
  readonly from?: Date | undefined;
  readonly to?: Date | undefined;
  /** Only events this supervisor recorded — a plain supervisor's whole view. */
  readonly recordedBy?: string | undefined;
};

export type EventPage = { readonly events: EventView[]; readonly nextCursor: string | null };

/** Newest `recorded_at` first, keyset-paginated; `limit` is clamped to the page maximum. */
export async function listEvents(
  db: Database,
  filter: EventFilter = {},
  {
    cursor,
    limit = PAGE_DEFAULT,
    includeGeo = false,
  }: { cursor?: string | undefined; limit?: number; includeGeo?: boolean } = {},
): Promise<EventPage> {
  const size = Math.min(Math.max(limit, 1), PAGE_MAX);
  const conditions: (SQL | undefined)[] = [
    filter.sessionId ? eq(collectionEvents.sessionId, filter.sessionId) : undefined,
    filter.collectorId ? eq(collectionEvents.collectorId, filter.collectorId) : undefined,
    filter.material ? eq(collectionEvents.material, filter.material) : undefined,
    filter.from ? gte(collectionEvents.recordedAt, filter.from) : undefined,
    filter.to ? lt(collectionEvents.recordedAt, filter.to) : undefined,
    filter.recordedBy ? eq(collectionEvents.supervisorId, filter.recordedBy) : undefined,
  ];
  if (cursor) {
    const after = decodeCursor(cursor);
    conditions.push(
      sql`(${collectionEvents.recordedAt}, ${collectionEvents.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`,
    );
  }

  const rows = await db
    .select({
      event: collectionEvents,
      seq: ledgerEntries.seq,
      collectorAlias: collectors.alias,
      collectorPublicCode: collectors.publicCode,
      payoutId: payouts.id,
      payoutStatus: payouts.status,
      payoutAmountSats: payouts.amountSats,
      openFlags: sql<number>`(select count(*)::int from ${anomalyFlags} where ${anomalyFlags.collectionEventId} = ${collectionEvents.id} and ${anomalyFlags.reviewOutcome} is null)`,
      recordedAtExact: sql<string>`${collectionEvents.recordedAt}::text`,
    })
    .from(collectionEvents)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, collectionEvents.ledgerEntryId))
    .innerJoin(collectors, eq(collectors.id, collectionEvents.collectorId))
    .leftJoin(payouts, eq(payouts.collectionEventId, collectionEvents.id))
    .where(and(...conditions))
    .orderBy(desc(collectionEvents.recordedAt), desc(collectionEvents.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    events: page.map((row) => toView(row, includeGeo)),
    nextCursor:
      rows.length > size && last ? encodeCursor(last.recordedAtExact, last.event.id) : null,
  };
}

function toView(
  row: {
    event: typeof collectionEvents.$inferSelect;
    seq: number;
    collectorAlias: string;
    collectorPublicCode: string;
    payoutId: string | null;
    payoutStatus: string | null;
    payoutAmountSats: number | null;
    openFlags: number;
  },
  includeGeo: boolean,
): EventView {
  const e = row.event;
  const fixed = e.gpsLat !== null && e.gpsLng !== null;
  return {
    id: e.id,
    seq: row.seq,
    collector: {
      id: e.collectorId,
      alias: row.collectorAlias,
      publicCode: row.collectorPublicCode,
    },
    supervisorId: e.supervisorId,
    sessionId: e.sessionId,
    material: e.material,
    weightKg: Number(e.weightKg),
    weightSource: e.weightSource,
    scaleId: e.scaleId,
    indicativeSats: e.indicativeSats,
    photoSha256: e.photoSha256,
    photoPath: `/api/v1/photos/${e.photoSha256}`,
    recordedAt: e.recordedAt,
    syncedAt: e.syncedAt,
    verificationLevel: e.verificationLevel,
    verificationStatus: e.verificationStatus,
    geo: fixed
      ? {
          kind: 'fix',
          ...(includeGeo && {
            lat: Number(e.gpsLat),
            lng: Number(e.gpsLng),
            accuracyM: e.gpsAccuracyM === null ? 0 : Number(e.gpsAccuracyM),
          }),
        }
      : { kind: 'unavailable', ...(includeGeo && { reason: e.gpsUnavailableReason ?? '' }) },
    payout: row.payoutId
      ? { id: row.payoutId, status: row.payoutStatus ?? '', amountSats: row.payoutAmountSats }
      : null,
    openFlags: row.openFlags,
  };
}
