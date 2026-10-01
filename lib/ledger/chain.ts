// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The pure half of the ledger: the frozen `entry_hash` form and the chain
 * recomputation. No database, no framework — an outside verifier
 * (`scripts/verify-ledger.ts`) runs exactly this over an exported dump.
 *
 *   entry_hash = sha256( seq | entry_type | payload_hash | prev_entry_hash )
 *
 * joined with `|` — every field is a fixed enum, a decimal integer, or 64 hex
 * chars, so the delimiter is unambiguous. `prev_entry_hash` is the literal
 * `GENESIS` for `seq = 1`.
 */

import { sha256Hex } from '@/lib/sync/contentHash';

/** The fields that make up (and link) a chain entry. */
export type ChainEntry = {
  readonly seq: number;
  readonly entryType: string;
  readonly payloadHash: string;
  readonly prevEntryHash: string | null;
  readonly entryHash: string;
};

/** The frozen `entry_hash` pre-image. */
export function entryHashInput(
  seq: number,
  entryType: string,
  payloadHash: string,
  prevEntryHash: string | null,
): string {
  return [String(seq), entryType, payloadHash, prevEntryHash ?? 'GENESIS'].join('|');
}

export function computeEntryHash(
  seq: number,
  entryType: string,
  payloadHash: string,
  prevEntryHash: string | null,
): Promise<string> {
  return sha256Hex(entryHashInput(seq, entryType, payloadHash, prevEntryHash));
}

export type VerifyResult =
  | {
      readonly ok: true;
      readonly count: number;
      readonly throughSeq: number;
      readonly headHash: string | null;
    }
  | { readonly ok: false; readonly brokenAt: number; readonly reason: string };

export type VerifyMode = 'full' | 'windowed';

/** A chain verdict plus what was checked: the mode and the checkpoint tally. */
export type VerifyLedgerResult =
  | (Extract<VerifyResult, { ok: true }> & {
      readonly mode: VerifyMode;
      readonly checkpoints: { readonly verified: number; readonly signaturesChecked: boolean };
    })
  | (Extract<VerifyResult, { ok: false }> & { readonly mode: VerifyMode });

/** A trusted starting point for a windowed check: the entry a checkpoint attests. */
export type ChainAnchor = { readonly seq: number; readonly entryHash: string };

/**
 * Recompute a run of entries (ascending `seq`) and report the first broken
 * link. Without an `anchor` the run must start at `seq = 1` (`GENESIS`); with
 * one it must continue directly from the anchored entry.
 */
export async function verifyEntries(
  rows: readonly ChainEntry[],
  anchor?: ChainAnchor,
): Promise<VerifyResult> {
  let prevHash: string | null = anchor?.entryHash ?? null;
  let expectedSeq = (anchor?.seq ?? 0) + 1;

  for (const row of rows) {
    if (row.seq !== expectedSeq) {
      return {
        ok: false,
        brokenAt: row.seq,
        reason: `seq gap: expected ${expectedSeq}, got ${row.seq}`,
      };
    }
    if (row.prevEntryHash !== prevHash) {
      return {
        ok: false,
        brokenAt: row.seq,
        reason: `prev_entry_hash does not link (expected ${prevHash ?? 'NULL'})`,
      };
    }
    const recomputed = await computeEntryHash(
      row.seq,
      row.entryType,
      row.payloadHash,
      row.prevEntryHash,
    );
    if (recomputed !== row.entryHash) {
      return {
        ok: false,
        brokenAt: row.seq,
        reason: 'entry_hash mismatch (payload or link altered)',
      };
    }
    prevHash = row.entryHash;
    expectedSeq += 1;
  }

  return {
    ok: true,
    count: rows.length,
    throughSeq: expectedSeq - 1,
    headHash: prevHash,
  };
}
