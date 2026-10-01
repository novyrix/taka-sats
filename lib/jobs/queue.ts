// SPDX-License-Identifier: AGPL-3.0-only

/**
 * pg-boss lifecycle + typed enqueue helpers (D-10). Postgres-backed, no
 * Redis. The `worker/` process runs the handlers (`./register`); the web
 * app only ever `send`s. On Vercel, a Cron-triggered internal route enqueues
 * the same jobs (M4).
 *
 * `DATABASE_URL` is env-only (D-21 §13.1). Node-only.
 */

import { PgBoss } from 'pg-boss';
import { getSettings } from '@/lib/config';
import {
  JOB_CREATE_LEDGER_CHECKPOINT,
  JOB_PROCESS_PAYOUT,
  JOB_PROVISION_COLLECTOR_WALLET,
  JOB_QUEUES,
  JOB_REFRESH_EXCHANGE_RATE,
  JOB_SWEEP_PAYOUTS,
  JOB_VALIDATE_COLLECTOR_DESTINATION,
  type ProcessPayoutPayload,
  type ProvisionCollectorWalletPayload,
  type ValidateCollectorDestinationPayload,
} from './types';

let instance: PgBoss | undefined;
let starting: Promise<PgBoss> | undefined;

async function create(): Promise<PgBoss> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set');
  }
  // `supervise: false` — no maintenance/archive cron here; a dedicated
  // housekeeping job is a later concern, not needed for M1.
  const boss = new PgBoss({ connectionString: url, supervise: false });
  await boss.start();
  for (const queue of JOB_QUEUES) {
    await boss.createQueue(queue);
  }
  return boss;
}

/** The process-wide pg-boss instance, started + with all queues created. */
export async function getBoss(): Promise<PgBoss> {
  if (instance) {
    return instance;
  }
  starting ??= create();
  instance = await starting;
  return instance;
}

/** Test/shutdown helper: stop the queue and drop the singleton. */
export async function stopBoss(): Promise<void> {
  if (instance) {
    await instance.stop({ graceful: true });
    instance = undefined;
    starting = undefined;
  }
}

export async function enqueueProvisionCollectorWallet(
  payload: ProvisionCollectorWalletPayload,
): Promise<void> {
  const boss = await getBoss();
  await boss.send(JOB_PROVISION_COLLECTOR_WALLET, payload, {
    retryLimit: 5,
    retryBackoff: true,
    // One outstanding provisioning job per collector at a time.
    singletonKey: payload.collectorId,
  });
}

/** Enqueue an exchange-rate refresh (the Vercel Cron bridge; the worker also self-schedules). */
export async function enqueueRefreshExchangeRate(): Promise<void> {
  const boss = await getBoss();
  await boss.send(JOB_REFRESH_EXCHANGE_RATE, {}, { retryLimit: 2, singletonKey: 'refresh' });
}

/** Enqueue a ledger checkpoint run (the Vercel Cron bridge; the worker also self-schedules). */
export async function enqueueCreateLedgerCheckpoint(): Promise<void> {
  const boss = await getBoss();
  await boss.send(JOB_CREATE_LEDGER_CHECKPOINT, {}, { retryLimit: 2, singletonKey: 'checkpoint' });
}

/**
 * Re-check a `pending_validation` payout destination later (D-26): its wallet host was
 * unreachable at attach time. Retries with backoff; one outstanding job per destination.
 */
export async function enqueueValidateCollectorDestination(
  payload: ValidateCollectorDestinationPayload,
): Promise<void> {
  const boss = await getBoss();
  await boss.send(JOB_VALIDATE_COLLECTOR_DESTINATION, payload, {
    retryLimit: 8,
    retryBackoff: true,
    singletonKey: payload.destinationId,
  });
}

/**
 * Drive one payout forward (after a sync confirms its event, an approval, a verified
 * destination). Retries with backoff up to `payouts.max_attempts`; one outstanding job
 * per payout. If an enqueue is dropped because one is already running, the sweeper
 * re-enqueues the payout on its next tick.
 */
export async function enqueueProcessPayout(payload: ProcessPayoutPayload): Promise<void> {
  const boss = await getBoss();
  await boss.send(JOB_PROCESS_PAYOUT, payload, {
    retryLimit: getSettings().payouts.max_attempts,
    retryBackoff: true,
    singletonKey: payload.payoutId,
  });
}

/** Enqueue a payout sweep (the Vercel Cron bridge; the worker also self-schedules). */
export async function enqueueSweepPayouts(): Promise<void> {
  const boss = await getBoss();
  await boss.send(JOB_SWEEP_PAYOUTS, {}, { retryLimit: 2, singletonKey: 'sweep' });
}

/** {@link enqueueProcessPayout} for a request that must not fail on a queue outage — the sweeper is the backstop. */
export async function enqueueProcessPayoutSafely(payload: ProcessPayoutPayload): Promise<void> {
  try {
    await enqueueProcessPayout(payload);
  } catch (error) {
    console.error(
      '[jobs] could not enqueue process-payout',
      error instanceof Error ? error.name : typeof error,
    );
  }
}
