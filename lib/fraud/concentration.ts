// SPDX-License-Identifier: AGPL-3.0-only

import { and, eq, isNull, sql } from 'drizzle-orm';
import { getSettings } from '@/lib/config';
import type { Queryable } from '@/lib/db/client';
import { anomalyFlags, collectionEvents, payouts } from '@/lib/db/schema';
import { raiseFlag } from './flags';
import { gini } from './stats';

/**
 * Fewer collectors than this and a Gini coefficient says nothing (two people always look
 * "concentrated"). A statistical-validity floor, not an operational tunable.
 */
export const MIN_COLLECTORS_FOR_CONCENTRATION = 5;

export type ConcentrationResult = {
  readonly collectors: number;
  readonly gini: number;
  readonly flagged: boolean;
};

/**
 * Is the sats PAID in one session concentrated in a few collectors' hands? Computes the Gini
 * of per-collector paid sats and, at or above `anomaly.payout_concentration_gini`, flags the
 * session — unless an unreviewed flag for it already exists, so re-running a reconciliation
 * does not pile up duplicates. Never blocks a payout.
 */
export async function detectPayoutConcentration(
  db: Queryable,
  sessionId: string,
): Promise<ConcentrationResult> {
  const rows = await db
    .select({ paid: sql<string>`sum(${payouts.amountSats})::text` })
    .from(payouts)
    .innerJoin(collectionEvents, eq(collectionEvents.id, payouts.collectionEventId))
    .where(and(eq(collectionEvents.sessionId, sessionId), eq(payouts.status, 'paid')))
    .groupBy(payouts.collectorId);

  const shares = rows.map((row) => Number(row.paid));
  const coefficient = gini(shares);
  const threshold = getSettings().anomaly.payout_concentration_gini;
  if (shares.length < MIN_COLLECTORS_FOR_CONCENTRATION || coefficient < threshold) {
    return { collectors: shares.length, gini: coefficient, flagged: false };
  }

  const [open] = await db
    .select({ id: anomalyFlags.id })
    .from(anomalyFlags)
    .where(
      and(
        eq(anomalyFlags.flagType, 'payout_concentration'),
        eq(anomalyFlags.sessionId, sessionId),
        isNull(anomalyFlags.reviewOutcome),
      ),
    )
    .limit(1);
  const flagged =
    !open &&
    (await raiseFlag(db, {
      type: 'payout_concentration',
      sessionId,
      context: { gini: coefficient, collectors: shares.length, threshold },
    }));
  return { collectors: shares.length, gini: coefficient, flagged };
}
