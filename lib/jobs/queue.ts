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
import {
  JOB_PROVISION_COLLECTOR_WALLET,
  JOB_QUEUES,
  JOB_REFRESH_EXCHANGE_RATE,
  type ProvisionCollectorWalletPayload,
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
