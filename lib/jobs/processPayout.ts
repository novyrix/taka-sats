// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Payout jobs. `process-payout` drives one payout as far as it can go;
 * `sweep-payouts` (cron) re-enqueues payouts parked on something that may have changed
 * and flags any stuck mid-send. Both are safe to run twice — `processPayout` is
 * idempotent and never re-sends (see `lib/payouts`).
 */

import type { Database } from '@/lib/db/client';
import type { LightningProvider } from '@/lib/lightning/LightningProvider';
import {
  flagStaleSendingPayouts,
  payoutIdsAwaitingDestination,
  processPayout,
  sweepablePayoutIds,
} from '@/lib/payouts';
import type { ProcessPayoutPayload } from './types';

export async function processPayoutJob(
  db: Database,
  provider: Pick<LightningProvider, 'kind' | 'pay' | 'getFloatBalance'>,
  payload: ProcessPayoutPayload,
): Promise<void> {
  await processPayout(db, provider, payload.payoutId);
}

type Enqueue = (payload: ProcessPayoutPayload) => Promise<void>;

/** The cron tick. Returns how many payouts were re-enqueued and how many newly flagged uncertain. */
export async function sweepPayouts(
  db: Database,
  enqueue: Enqueue,
  now: Date = new Date(),
): Promise<{ enqueued: number; flagged: number }> {
  const flagged = await flagStaleSendingPayouts(db, now);
  const ids = await sweepablePayoutIds(db);
  for (const payoutId of ids) {
    await enqueue({ payoutId });
  }
  return { enqueued: ids.length, flagged };
}

/**
 * A collector's destination just became verified: wake its payouts that were waiting on
 * one. Best-effort — the sweeper would pick them up anyway, so a queue outage must never
 * fail the request or job that verified the destination.
 */
export async function enqueuePayoutsAwaitingDestination(
  db: Database,
  collectorId: string,
  enqueue: Enqueue,
): Promise<void> {
  try {
    for (const payoutId of await payoutIdsAwaitingDestination(db, collectorId)) {
      await enqueue({ payoutId });
    }
  } catch (error) {
    console.error(
      '[jobs] could not enqueue payouts for a verified destination',
      error instanceof Error ? error.name : typeof error,
    );
  }
}
