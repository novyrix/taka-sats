// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Periodic exchange-rate refresh (D-18, ROADMAP M2-9). The worker schedules
 * this on a cron derived from `settings.money.rate_staleness_ttl_seconds`;
 * on Vercel the Cron bridge enqueues it. Failures are logged and left for
 * the next run — a stale rate is handled at the payout path (`requireFreshRate`).
 */

import type { Database } from '@/lib/db/client';
import { fetchExchangeRate } from '@/lib/money/rates';

export async function refreshExchangeRate(db: Database): Promise<void> {
  const snapshot = await fetchExchangeRate(db);
  console.log(
    `[jobs] exchange rate ${snapshot.base}/${snapshot.quote} = ${snapshot.rate} (snapshot ${snapshot.id})`,
  );
}

/** Cron expression: refresh at roughly half the staleness TTL, clamped to 1–59 min. */
export function refreshCron(ttlSeconds: number): string {
  const minutes = Math.min(59, Math.max(1, Math.floor(ttlSeconds / 120)));
  return `*/${minutes} * * * *`;
}
