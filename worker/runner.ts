// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Taka Sats worker process (D-10). Starts pg-boss, registers every job
 * handler (`lib/jobs/register`), and stays alive until SIGINT/SIGTERM.
 * Run via `tsx` (`pnpm worker`) — same as `scripts/*`, so the `@/` alias and
 * TS `lib/` imports resolve.
 */

import { getBoss, registerWorkers, stopBoss } from '@/lib/jobs';

async function main(): Promise<void> {
  const boss = await getBoss();
  boss.on('error', (error: unknown) => console.error('[worker] pg-boss error', error));
  await registerWorkers(boss);
  console.log('[worker] ready — handlers registered');
}

async function shutdown(signal: string): Promise<void> {
  console.log(`[worker] ${signal} — shutting down`);
  await stopBoss();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

main().catch((error: unknown) => {
  console.error('[worker] failed to start', error);
  process.exitCode = 1;
});
