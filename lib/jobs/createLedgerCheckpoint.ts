// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sign a ledger checkpoint (D-19). The worker schedules this on
 * `ledger.checkpoint_cron`; on Vercel the Cron bridge enqueues it. A no-op
 * when disabled, when too few entries have landed, or when the head is already
 * checkpointed — so a repeated or concurrent run never writes a duplicate.
 */

import { getSettings } from '@/lib/config';
import type { Database } from '@/lib/db/client';
import { createCheckpoint } from '@/lib/ledger/checkpoints';
import { loadSigningKey } from '@/lib/ledger/signing';

export async function createLedgerCheckpoint(db: Database): Promise<void> {
  const ledger = getSettings().ledger;
  if (!ledger.checkpoint_enabled) {
    return;
  }
  if (!process.env.LEDGER_SIGNING_KEY?.trim()) {
    console.warn('[jobs] ledger checkpoint skipped: LEDGER_SIGNING_KEY is not set');
    return;
  }

  const checkpoint = await createCheckpoint(db, {
    signingKey: loadSigningKey(),
    minNewEntries: ledger.checkpoint_interval_entries,
  });
  if (checkpoint) {
    console.log(`[jobs] ledger checkpoint through seq ${checkpoint.throughSeq}`);
  }
}
