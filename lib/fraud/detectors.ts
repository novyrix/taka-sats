// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The per-event anomaly detectors (FR-3.6, ADR-0006). Each looks at one freshly ingested
 * collection event and writes `anomaly_flags` for a human to review. NOTHING here ever blocks:
 * a flag does not fail a sync, hold a payout or change a result. Every detector is idempotent
 * (see `raiseFlag`), so running them twice — a resend, a backfill — adds nothing.
 *
 * Out-of-window and future timestamps are not detected here: ingest rejects those outright.
 */

import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { getSettings } from '@/lib/config';
import type { Queryable } from '@/lib/db/client';
import { collectionEvents, ledgerEntries, sessions } from '@/lib/db/schema';
import { geoBoundsSchema } from '@/lib/sessions';
import { raiseFlag } from './flags';
import { pointInRing } from './geo';
import { identicalRunEnds, weightOutlier } from './stats';

export type EventRow = {
  readonly id: string;
  readonly seq: number;
  readonly collectorId: string;
  readonly supervisorId: string;
  readonly sessionId: string | null;
  readonly material: string;
  readonly weightKg: string;
  readonly photoSha256: string;
  readonly gpsLat: string | null;
  readonly gpsLng: string | null;
  readonly gpsAccuracyM: string | null;
  readonly recordedAt: string;
  readonly geoBounds: unknown;
};

async function loadEvent(db: Queryable, eventId: string): Promise<EventRow | null> {
  const [row] = await db
    .select({
      id: collectionEvents.id,
      seq: ledgerEntries.seq,
      collectorId: collectionEvents.collectorId,
      supervisorId: collectionEvents.supervisorId,
      sessionId: collectionEvents.sessionId,
      material: collectionEvents.material,
      weightKg: collectionEvents.weightKg,
      photoSha256: collectionEvents.photoSha256,
      gpsLat: collectionEvents.gpsLat,
      gpsLng: collectionEvents.gpsLng,
      gpsAccuracyM: collectionEvents.gpsAccuracyM,
      recordedAt: sql<string>`${collectionEvents.recordedAt}::text`,
      geoBounds: sessions.geoBounds,
    })
    .from(collectionEvents)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, collectionEvents.ledgerEntryId))
    .leftJoin(sessions, eq(sessions.id, collectionEvents.sessionId))
    .where(eq(collectionEvents.id, eventId));
  return row ?? null;
}

/** The columns every flag about this event shares. */
const about = (event: EventRow) => ({
  eventId: event.id,
  collectorId: event.collectorId,
  supervisorId: event.supervisorId,
  ...(event.sessionId && { sessionId: event.sessionId }),
});

/** The same photo bytes already filed on an EARLIER event (any collector, any supervisor). */
export async function detectDuplicatePhoto(db: Queryable, event: EventRow): Promise<boolean> {
  const [original] = await db
    .select({ id: collectionEvents.id, collectorId: collectionEvents.collectorId })
    .from(collectionEvents)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, collectionEvents.ledgerEntryId))
    .where(
      and(eq(collectionEvents.photoSha256, event.photoSha256), lt(ledgerEntries.seq, event.seq)),
    )
    .orderBy(asc(ledgerEntries.seq))
    .limit(1);
  if (!original) {
    return false;
  }
  return raiseFlag(db, {
    type: 'duplicate_photo',
    ...about(event),
    context: {
      duplicateOfEventId: original.id,
      sameCollector: original.collectorId === event.collectorId,
    },
  });
}

/**
 * `identical_weight_repeat_count` consecutive weights from one supervisor, same material, all
 * equal. "Consecutive" is capture order (`recorded_at`), so an offline batch that arrives out
 * of order is judged on the order the weighing happened. Looks N−1 events either side of this
 * one — every window of N that contains it — and flags the LAST event of each such window.
 */
export async function detectIdenticalWeightRepeat(
  db: Queryable,
  event: EventRow,
): Promise<boolean> {
  const n = getSettings().anomaly.identical_weight_repeat_count;
  const mine = and(
    eq(collectionEvents.supervisorId, event.supervisorId),
    eq(collectionEvents.material, event.material),
  );
  const position = sql`(${collectionEvents.recordedAt}, ${collectionEvents.id})`;
  const here = sql`(${event.recordedAt}::timestamptz, ${event.id}::uuid)`;
  const columns = { id: collectionEvents.id, weightKg: collectionEvents.weightKg };

  const before = await db
    .select(columns)
    .from(collectionEvents)
    .where(and(mine, sql`${position} < ${here}`))
    .orderBy(desc(collectionEvents.recordedAt), desc(collectionEvents.id))
    .limit(n - 1);
  const after = await db
    .select(columns)
    .from(collectionEvents)
    .where(and(mine, sql`${position} > ${here}`))
    .orderBy(asc(collectionEvents.recordedAt), asc(collectionEvents.id))
    .limit(n - 1);

  const run = [...before.reverse(), { id: event.id, weightKg: event.weightKg }, ...after];
  let raised = false;
  for (const end of identicalRunEnds(
    run.map((e) => e.weightKg),
    n,
  )) {
    const last = run[end];
    if (last) {
      const flagged = await raiseFlag(db, {
        ...about(event),
        type: 'identical_weight_repeat',
        eventId: last.id,
        context: { weightKg: last.weightKg, repeatCount: n },
      });
      raised = raised || flagged;
    }
  }
  return raised;
}

/** A GPS fix outside the session's `geo_bounds`. No fix, or no bounds, is not an outlier. */
export async function detectGpsOutlier(db: Queryable, event: EventRow): Promise<boolean> {
  if (event.gpsLat === null || event.gpsLng === null) {
    return false;
  }
  const bounds = geoBoundsSchema.safeParse(event.geoBounds);
  const ring = bounds.success ? bounds.data.coordinates[0] : undefined;
  if (!ring || pointInRing(Number(event.gpsLat), Number(event.gpsLng), ring)) {
    return false;
  }
  return raiseFlag(db, {
    type: 'gps_outlier',
    ...about(event),
    context: {
      lat: Number(event.gpsLat),
      lng: Number(event.gpsLng),
      accuracyM: event.gpsAccuracyM === null ? null : Number(event.gpsAccuracyM),
    },
  });
}

/**
 * A weight far from what this material usually weighs, judged against EARLIER events of the
 * same material (median ± k scaled-MAD, see `weightOutlier`). Silent until
 * `weight_outlier_min_events` earlier events exist.
 */
export async function detectWeightOutlier(db: Queryable, event: EventRow): Promise<boolean> {
  const { weight_outlier_min_events: minEvents, weight_outlier_mad_k: k } = getSettings().anomaly;
  const history = (
    await db
      .select({ weightKg: collectionEvents.weightKg })
      .from(collectionEvents)
      .innerJoin(ledgerEntries, eq(ledgerEntries.id, collectionEvents.ledgerEntryId))
      .where(and(eq(collectionEvents.material, event.material), lt(ledgerEntries.seq, event.seq)))
  ).map((row) => Number(row.weightKg));
  if (history.length < minEvents) {
    return false;
  }
  const verdict = weightOutlier(history, Number(event.weightKg), k);
  if (!verdict.outlier) {
    return false;
  }
  return raiseFlag(db, {
    type: 'weight_outlier',
    ...about(event),
    context: {
      material: event.material,
      weightKg: event.weightKg,
      median: verdict.median,
      scaledMad: verdict.scaledMad,
      k,
      history: history.length,
    },
  });
}

const DETECTORS = [
  ['duplicate_photo', detectDuplicatePhoto],
  ['identical_weight_repeat', detectIdenticalWeightRepeat],
  ['gps_outlier', detectGpsOutlier],
  ['weight_outlier', detectWeightOutlier],
] as const;

/**
 * Run every per-event detector for a committed event. One detector failing is logged (error
 * type only — never an event payload) and does not stop the others. The caller still wraps
 * this call: a sync must never fail over a flag.
 */
export async function runEventDetectors(db: Queryable, eventId: string): Promise<void> {
  const event = await loadEvent(db, eventId);
  if (!event) {
    return;
  }
  for (const [name, detect] of DETECTORS) {
    try {
      await detect(db, event);
    } catch (error) {
      console.error(
        `[fraud] detector ${name} failed`,
        error instanceof Error ? error.name : typeof error,
      );
    }
  }
}
