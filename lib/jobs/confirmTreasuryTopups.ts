// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The treasury arrival check (M5-7). A recorded pool transfer is confirmed only when the hot
 * wallet's own balance shows the funds (never on anyone's say-so). Once something is confirmed,
 * the payouts that were parked in `pending_float` are woken by the existing payout sweep, which
 * is reused rather than duplicated. Safe to run twice: confirmation is idempotent.
 */

import type { Database } from '@/lib/db/client';
import { confirmArrivedTopups, type FloatReader } from '@/lib/treasury';
import { sweepPayouts } from './processPayout';
import type { ProcessPayoutPayload } from './types';

type Enqueue = (payload: ProcessPayoutPayload) => Promise<void>;

/** Returns how many proposals were confirmed on this pass and how many payouts were woken. */
export async function confirmTreasuryTopups(
  db: Database,
  provider: FloatReader,
  enqueue: Enqueue,
): Promise<{ confirmed: number; payoutsWoken: number }> {
  const confirmed = await confirmArrivedTopups(db, provider);
  if (confirmed === 0) {
    return { confirmed, payoutsWoken: 0 };
  }
  const { enqueued } = await sweepPayouts(db, enqueue);
  return { confirmed, payoutsWoken: enqueued };
}
