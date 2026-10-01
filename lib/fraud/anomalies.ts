// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The anomaly review queue (FR-3.6, US-3.6): list flags and record a human's verdict. A flag
 * never blocks anything; this is where a person decides what it means. The verdict is
 * auditable — who, when, why — and changing it keeps the previous one in `context.history`.
 */

import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/lib/db/client';
import {
  anomalyFlags,
  ANOMALY_TYPES,
  collectionEvents,
  collectors,
  supervisors,
} from '@/lib/db/schema';
import { decodeCursor, encodeCursor, PAGE_DEFAULT, PAGE_MAX } from '@/lib/pagination';
import { AnomalyNotFoundError, AnomalyReviewError } from './errors';

export const ANOMALY_STATUSES = ['open', 'confirmed', 'dismissed', 'all'] as const;
export type AnomalyStatusFilter = (typeof ANOMALY_STATUSES)[number];

export const reviewInputSchema = z.object({
  outcome: z.enum(['confirmed', 'dismissed']),
  note: z.string().trim().min(1).max(1000).optional(),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

export type AnomalyView = {
  readonly id: string;
  readonly type: string;
  /** `open` until a reviewer decides, then the outcome. */
  readonly status: 'open' | 'confirmed' | 'dismissed';
  readonly eventId: string | null;
  readonly sessionId: string | null;
  readonly detectedAt: Date;
  readonly context: unknown;
  readonly collector: { id: string; alias: string; publicCode: string } | null;
  readonly supervisor: { id: string; name: string } | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
};

export type AnomalyFilter = {
  readonly status?: AnomalyStatusFilter | undefined;
  readonly type?: (typeof ANOMALY_TYPES)[number] | undefined;
  readonly eventId?: string | undefined;
};

/** A flag is about the collector/supervisor/session it names, else those of its event. */
const collectorId = sql`coalesce(${anomalyFlags.collectorId}, ${collectionEvents.collectorId})`;
const supervisorId = sql`coalesce(${anomalyFlags.supervisorId}, ${collectionEvents.supervisorId})`;

const selection = {
  flag: anomalyFlags,
  sessionId: sql<string | null>`coalesce(${anomalyFlags.sessionId}, ${collectionEvents.sessionId})`,
  collector: { id: collectors.id, alias: collectors.alias, publicCode: collectors.publicCode },
  supervisor: { id: supervisors.id, name: supervisors.name },
  detectedAtExact: sql<string>`${anomalyFlags.detectedAt}::text`,
} as const;

function toView(row: {
  flag: typeof anomalyFlags.$inferSelect;
  sessionId: string | null;
  collector: { id: string; alias: string; publicCode: string } | null;
  supervisor: { id: string; name: string } | null;
}): AnomalyView {
  const { flag } = row;
  return {
    id: flag.id,
    type: flag.flagType,
    status:
      flag.reviewOutcome === 'confirmed' || flag.reviewOutcome === 'dismissed'
        ? flag.reviewOutcome
        : 'open',
    eventId: flag.collectionEventId,
    sessionId: row.sessionId,
    detectedAt: flag.detectedAt,
    context: flag.context,
    collector: row.collector,
    supervisor: row.supervisor,
    reviewedBy: flag.reviewedBy,
    reviewedAt: flag.reviewedAt,
    reviewNote: flag.reviewNote,
  };
}

function select(db: Database) {
  return db
    .select(selection)
    .from(anomalyFlags)
    .leftJoin(collectionEvents, eq(collectionEvents.id, anomalyFlags.collectionEventId))
    .leftJoin(collectors, eq(collectors.id, collectorId))
    .leftJoin(supervisors, eq(supervisors.id, supervisorId));
}

export type AnomalyPage = { readonly anomalies: AnomalyView[]; readonly nextCursor: string | null };

/** Newest first, keyset-paginated. `status` defaults to `open`. */
export async function listAnomalies(
  db: Database,
  filter: AnomalyFilter = {},
  { cursor, limit = PAGE_DEFAULT }: { cursor?: string | undefined; limit?: number } = {},
): Promise<AnomalyPage> {
  const size = Math.min(Math.max(limit, 1), PAGE_MAX);
  const status = filter.status ?? 'open';
  const conditions: SQL[] = [];
  if (status === 'open') {
    conditions.push(isNull(anomalyFlags.reviewOutcome));
  } else if (status !== 'all') {
    conditions.push(eq(anomalyFlags.reviewOutcome, status));
  }
  if (filter.type) {
    conditions.push(eq(anomalyFlags.flagType, filter.type));
  }
  if (filter.eventId) {
    conditions.push(eq(anomalyFlags.collectionEventId, filter.eventId));
  }
  if (cursor) {
    const after = decodeCursor(cursor);
    conditions.push(
      sql`(${anomalyFlags.detectedAt}, ${anomalyFlags.id}) < (${after.ts}::timestamptz, ${after.id}::uuid)`,
    );
  }
  const rows = await select(db)
    .where(and(...conditions))
    .orderBy(desc(anomalyFlags.detectedAt), desc(anomalyFlags.id))
    .limit(size + 1);

  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  return {
    anomalies: page.map(toView),
    nextCursor:
      rows.length > size && last ? encodeCursor(last.detectedAtExact, last.flag.id) : null,
  };
}

export async function getAnomaly(db: Database, id: string): Promise<AnomalyView> {
  const [row] = await select(db).where(eq(anomalyFlags.id, id));
  if (!row) {
    throw new AnomalyNotFoundError();
  }
  return toView(row);
}

/**
 * Record a verdict. First review: sets it. The SAME outcome again (by anyone): nothing changes
 * — a resent request is harmless. A DIFFERENT outcome: only a different admin may overturn
 * it, and the superseded verdict is appended to `context.history` so nothing is lost.
 */
export async function reviewAnomaly(
  db: Database,
  id: string,
  { outcome, note }: ReviewInput,
  reviewerId: string,
): Promise<{ readonly anomaly: AnomalyView; readonly changed: boolean }> {
  const changed = await db.transaction(async (tx) => {
    const [flag] = await tx
      .select()
      .from(anomalyFlags)
      .where(eq(anomalyFlags.id, id))
      .for('update');
    if (!flag) {
      throw new AnomalyNotFoundError();
    }
    if (flag.reviewOutcome === outcome) {
      return false;
    }

    let context: unknown = flag.context;
    if (flag.reviewOutcome !== null) {
      if (flag.reviewedBy === reviewerId) {
        throw new AnomalyReviewError();
      }
      const base =
        typeof context === 'object' && context !== null && !Array.isArray(context)
          ? (context as Record<string, unknown>)
          : {};
      const history = Array.isArray(base.history) ? base.history : [];
      context = {
        ...base,
        history: [
          ...history,
          {
            outcome: flag.reviewOutcome,
            reviewedBy: flag.reviewedBy,
            reviewedAt: flag.reviewedAt,
            note: flag.reviewNote,
          },
        ],
      };
    }
    await tx
      .update(anomalyFlags)
      .set({
        reviewOutcome: outcome,
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
        reviewNote: note ?? null,
        context,
      })
      .where(eq(anomalyFlags.id, id));
    return true;
  });
  return { anomaly: await getAnomaly(db, id), changed };
}
