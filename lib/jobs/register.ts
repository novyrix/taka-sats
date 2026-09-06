// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wire the pg-boss handlers + schedules (D-10). The `worker/` process calls
 * `registerWorkers` once after `getBoss()`; nothing else does.
 */

import type { PgBoss } from 'pg-boss';
import { getSettings } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { getCollectorWalletProvisioner } from '@/lib/lightning';
import { provisionCollectorWallet } from './provisionCollectorWallet';
import { refreshCron, refreshExchangeRate } from './refreshExchangeRate';
import {
  JOB_PROVISION_COLLECTOR_WALLET,
  JOB_REFRESH_EXCHANGE_RATE,
  type ProvisionCollectorWalletPayload,
} from './types';

export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work<ProvisionCollectorWalletPayload>(JOB_PROVISION_COLLECTOR_WALLET, async (jobs) => {
    const db = getDb();
    const provisioner = getCollectorWalletProvisioner();
    for (const job of jobs) {
      await provisionCollectorWallet(db, provisioner, job.data);
    }
  });

  await boss.work(JOB_REFRESH_EXCHANGE_RATE, async (jobs) => {
    const db = getDb();
    for (const _job of jobs) {
      await refreshExchangeRate(db);
    }
  });

  // Keep a snapshot fresh without a Vercel Cron round-trip (self-hosted path).
  await boss.schedule(
    JOB_REFRESH_EXCHANGE_RATE,
    refreshCron(getSettings().money.rate_staleness_ttl_seconds),
  );
}
