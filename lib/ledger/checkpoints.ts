// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Signed ledger checkpoints (REQUIREMENTS §11.2, D-19). A
 * checkpoint is a programme-key signature over `(through_seq, entry_hash)` —
 * a stable anchor an outside party can pin, and what lets verification start
 * from the last signed point instead of genesis. Server only.
 */

import type { KeyObject } from 'node:crypto';
import { asc, desc, eq, gt, type InferSelectModel, lt, sql } from 'drizzle-orm';
import type { Database, Queryable } from '@/lib/db/client';
import { ledgerCheckpoints, ledgerEntries } from '@/lib/db/schema';
import { type VerifyLedgerResult, type VerifyMode, verifyEntries } from './chain';
import { LEDGER_PAGE_DEFAULT, LEDGER_PAGE_MAX, latestEntry } from './index';
import { signCheckpoint, verifyCheckpoints } from './signing';

export type Checkpoint = InferSelectModel<typeof ledgerCheckpoints>;

/** Advisory-lock key serialising checkpoint writers (distinct from the append lock). */
const CHECKPOINT_LOCK_KEY = 8_264_072;

export async function latestCheckpoint(db: Queryable): Promise<Checkpoint | null> {
  const [row] = await db
    .select()
    .from(ledgerCheckpoints)
    .orderBy(desc(ledgerCheckpoints.throughSeq))
    .limit(1);
  return row ?? null;
}

/**
 * Sign a checkpoint over the current head. Returns `null` — and writes nothing
 * — when the ledger is empty, the head is already checkpointed, or fewer than
 * `minNewEntries` entries have landed since the last checkpoint. Idempotent
 * under concurrent runs (an advisory lock serialises the check-and-insert).
 */
export async function createCheckpoint(
  db: Database,
  { signingKey, minNewEntries = 1 }: { signingKey: KeyObject; minNewEntries?: number },
): Promise<Checkpoint | null> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${CHECKPOINT_LOCK_KEY})`);

    const head = await latestEntry(tx);
    if (!head) {
      return null;
    }
    const last = await latestCheckpoint(tx);
    const newEntries = head.seq - (last?.throughSeq ?? 0);
    if (newEntries < Math.max(minNewEntries, 1)) {
      return null;
    }

    const [row] = await tx
      .insert(ledgerCheckpoints)
      .values({
        throughSeq: head.seq,
        entryHash: head.entryHash,
        signature: signCheckpoint(signingKey, head.seq, head.entryHash),
      })
      .returning();
    return row ?? null;
  });
}

export type CheckpointPage = {
  readonly checkpoints: Checkpoint[];
  readonly nextCursor: number | null;
};

/** Newest-first page of checkpoints, keyset-paginated on `through_seq` (`< cursor`). */
export async function pageCheckpoints(
  db: Database,
  { cursor, limit = LEDGER_PAGE_DEFAULT }: { cursor?: number; limit?: number } = {},
): Promise<CheckpointPage> {
  const size = Math.min(Math.max(limit, 1), LEDGER_PAGE_MAX);
  const rows = await db
    .select()
    .from(ledgerCheckpoints)
    .where(cursor === undefined ? undefined : lt(ledgerCheckpoints.throughSeq, cursor))
    .orderBy(desc(ledgerCheckpoints.throughSeq))
    .limit(size + 1);

  const checkpoints = rows.slice(0, size);
  const last = checkpoints[checkpoints.length - 1];
  return { checkpoints, nextCursor: rows.length > size && last ? last.throughSeq : null };
}

/**
 * Verify the ledger and its checkpoints.
 *  - `full` recomputes every link from genesis and checks every checkpoint.
 *  - `windowed` trusts the latest checkpoint as an anchor (signature + its hash
 *    at `through_seq` are checked) and recomputes only the entries after it;
 *    with no checkpoint yet it falls back to `full` (and reports `mode: 'full'`).
 *
 * Signatures are checked when a `publicKey` is given; without one only the
 * hash links and each checkpoint's `entry_hash` are verified. A checkpoint that
 * names a `through_seq` beyond the head fails — it catches a truncated tail.
 */
export async function verifyLedger(
  db: Database,
  { mode = 'full', publicKey = null }: { mode?: VerifyMode; publicKey?: string | null } = {},
): Promise<VerifyLedgerResult> {
  const anchor = mode === 'windowed' ? await latestCheckpoint(db) : null;

  if (anchor) {
    const [anchorEntry] = await db
      .select({ entryHash: ledgerEntries.entryHash })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.seq, anchor.throughSeq));
    const verdict = verifyCheckpoints([anchor], () => anchorEntry?.entryHash, publicKey);
    if (!verdict.ok) {
      return { ok: false, mode: 'windowed', brokenAt: verdict.throughSeq, reason: verdict.reason };
    }
    const rows = await db
      .select()
      .from(ledgerEntries)
      .where(gt(ledgerEntries.seq, anchor.throughSeq))
      .orderBy(asc(ledgerEntries.seq));
    const result = await verifyEntries(rows, {
      seq: anchor.throughSeq,
      entryHash: anchor.entryHash,
    });
    return result.ok
      ? {
          ...result,
          mode: 'windowed',
          checkpoints: { verified: 1, signaturesChecked: verdict.signaturesChecked },
        }
      : { ...result, mode: 'windowed' };
  }

  const rows = await db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.seq));
  const result = await verifyEntries(rows);
  if (!result.ok) {
    return { ...result, mode: 'full' };
  }

  const checkpoints = await db
    .select()
    .from(ledgerCheckpoints)
    .orderBy(asc(ledgerCheckpoints.throughSeq));
  const hashes = new Map(rows.map((row) => [row.seq, row.entryHash]));
  const verdict = verifyCheckpoints(checkpoints, (seq) => hashes.get(seq), publicKey);
  if (!verdict.ok) {
    return { ok: false, mode: 'full', brokenAt: verdict.throughSeq, reason: verdict.reason };
  }
  return {
    ...result,
    mode: 'full',
    checkpoints: { verified: verdict.verified, signaturesChecked: verdict.signaturesChecked },
  };
}
