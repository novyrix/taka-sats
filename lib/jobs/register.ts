// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Wire the pg-boss handlers + schedules (D-10). The `worker/` process calls
 * `registerWorkers` once after `getBoss()`; nothing else does.
 */

import { eq } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { getSettings } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { collectorPaymentDestinations } from '@/lib/db/schema';
import { completeDestinationValidation } from '@/lib/collectors';
import { getCollectorWalletProvisioner, getLightningProvider } from '@/lib/lightning';
import { createLedgerCheckpoint } from './createLedgerCheckpoint';
import { enqueueProcessPayout } from './queue';
import { enqueuePayoutsAwaitingDestination, processPayoutJob, sweepPayouts } from './processPayout';
import { provisionCollectorWallet } from './provisionCollectorWallet';
import { refreshCron, refreshExchangeRate } from './refreshExchangeRate';
import {
  JOB_CREATE_LEDGER_CHECKPOINT,
  JOB_PROCESS_PAYOUT,
  JOB_PROVISION_COLLECTOR_WALLET,
  JOB_REFRESH_EXCHANGE_RATE,
  JOB_SWEEP_PAYOUTS,
  JOB_VALIDATE_COLLECTOR_DESTINATION,
  type ProcessPayoutPayload,
  type ProvisionCollectorWalletPayload,
  type ValidateCollectorDestinationPayload,
} from './types';

export async function registerWorkers(boss: PgBoss): Promise<void> {
  await boss.work<ProvisionCollectorWalletPayload>(JOB_PROVISION_COLLECTOR_WALLET, async (jobs) => {
    const db = getDb();
    const provisioner = getCollectorWalletProvisioner();
    for (const job of jobs) {
      await provisionCollectorWallet(db, provisioner, job.data);
    }
  });

  await boss.work<ValidateCollectorDestinationPayload>(
    JOB_VALIDATE_COLLECTOR_DESTINATION,
    async (jobs) => {
      const db = getDb();
      const provider = getLightningProvider();
      for (const job of jobs) {
        // Throws while the wallet host is still unreachable, so pg-boss retries with backoff.
        const status = await completeDestinationValidation(db, provider, job.data.destinationId);
        if (status === 'verified') {
          const [destination] = await db
            .select({ collectorId: collectorPaymentDestinations.collectorId })
            .from(collectorPaymentDestinations)
            .where(eq(collectorPaymentDestinations.id, job.data.destinationId));
          if (destination) {
            await enqueuePayoutsAwaitingDestination(
              db,
              destination.collectorId,
              enqueueProcessPayout,
            );
          }
        }
      }
    },
  );

  await boss.work<ProcessPayoutPayload>(JOB_PROCESS_PAYOUT, async (jobs) => {
    const db = getDb();
    // Throws on an unexpected failure, so pg-boss retries (`payouts.max_attempts`, with backoff).
    const provider = getLightningProvider();
    for (const job of jobs) {
      await processPayoutJob(db, provider, job.data);
    }
  });

  await boss.work(JOB_SWEEP_PAYOUTS, async () => {
    await sweepPayouts(getDb(), enqueueProcessPayout);
  });
  await boss.schedule(JOB_SWEEP_PAYOUTS, getSettings().payouts.sweep_cron);

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

  await boss.work(JOB_CREATE_LEDGER_CHECKPOINT, async (jobs) => {
    const db = getDb();
    for (const _job of jobs) {
      await createLedgerCheckpoint(db);
    }
  });

  // pg-boss keeps schedules in the database, so a disabled flag must drop an old one.
  const { checkpoint_enabled, checkpoint_cron } = getSettings().ledger;
  if (checkpoint_enabled) {
    await boss.schedule(JOB_CREATE_LEDGER_CHECKPOINT, checkpoint_cron);
  } else {
    await boss.unschedule(JOB_CREATE_LEDGER_CHECKPOINT);
  }
}
