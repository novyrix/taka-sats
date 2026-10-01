// SPDX-License-Identifier: AGPL-3.0-only

import type { Queryable } from '@/lib/db/client';
import { type AnomalyType, anomalyFlags } from '@/lib/db/schema';

export type NewFlag = {
  readonly type: AnomalyType;
  readonly eventId?: string;
  readonly collectorId?: string;
  readonly supervisorId?: string;
  readonly sessionId?: string;
  readonly context?: Record<string, unknown>;
};

/**
 * Write one flag for review. Returns `false` when it already exists — for an event-bound flag
 * the partial unique index on `(flag_type, collection_event_id)` makes a re-run a no-op.
 * A flag is only ever a note for a human: nothing reads it to block a sync or a payout.
 */
export async function raiseFlag(db: Queryable, flag: NewFlag): Promise<boolean> {
  const rows = await db
    .insert(anomalyFlags)
    .values({
      flagType: flag.type,
      collectionEventId: flag.eventId ?? null,
      collectorId: flag.collectorId ?? null,
      supervisorId: flag.supervisorId ?? null,
      sessionId: flag.sessionId ?? null,
      context: flag.context ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: anomalyFlags.id });
  return rows.length > 0;
}
