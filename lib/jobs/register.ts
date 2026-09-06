// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wire the pg-boss handlers (D-10). The `worker/` process calls
 * `registerWorkers` once after `getBoss()`; nothing else does.
 */

import type { PgBoss } from 'pg-boss';
import { getDb } from '@/lib/db/client';
import { getCollectorWalletProvisioner } from '@/lib/lightning';
import { provisionCollectorWallet } from './provisionCollectorWallet';
import { JOB_PROVISION_COLLECTOR_WALLET, type ProvisionCollectorWalletPayload } from './types';

export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work<ProvisionCollectorWalletPayload>(JOB_PROVISION_COLLECTOR_WALLET, async (jobs) => {
    const db = getDb();
    const provisioner = getCollectorWalletProvisioner();
    for (const job of jobs) {
      await provisionCollectorWallet(db, provisioner, job.data);
    }
  });
}
