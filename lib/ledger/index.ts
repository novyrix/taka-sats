// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The one global append-only hash chain (D-13, REQUIREMENTS §11).
 *
 * Every money- or trust-relevant fact becomes a `ledger_entries` row. On
 * append the server takes an advisory lock, reads the head, assigns
 * `seq = head.seq + 1`, links `prev_entry_hash = head.entry_hash`, and
 * computes:
 *
 *   entry_hash = sha256( seq | entry_type | payload_hash | prev_entry_hash )
 *
 * joined with `|` — every field is a fixed enum, a decimal integer, or 64 hex
 * chars, so the delimiter is unambiguous. `prev_entry_hash` is the literal
 * `GENESIS` for `seq = 1`. This form is frozen (a fixed-vector test guards it).
 *
 * `payload_hash` is the SHA-256 of the canonical JSON of the fact — the SAME
 * `canonicalize` the PWA uses for its `content_hash` (`lib/sync/contentHash`),
 * so an offline-origin event's client hash is reused verbatim (M4 risk note:
 * the two serialisations must match byte-for-byte).
 *
 * `UPDATE`/`DELETE` on `ledger_entries` are blocked by a DB trigger
 * (migration 0006). A correction is a new `entry_type = 'correction'` row with
 * `references_id` set. Framework-free apart from Drizzle (D-04); server only.
 */

import { asc, desc, eq, gt, type InferSelectModel, lt, sql } from 'drizzle-orm';
import type { Database, Queryable, Tx } from '@/lib/db/client';
import { ledgerEntries } from '@/lib/db/schema';
import { type Canonicalizable, contentHash } from '@/lib/sync/contentHash';
import { computeEntryHash, verifyEntries, type VerifyResult } from './chain';

export {
  type ChainAnchor,
  type ChainEntry,
  computeEntryHash,
  entryHashInput,
  verifyEntries,
  type VerifyLedgerResult,
  type VerifyMode,
  type VerifyResult,
} from './chain';

export type LedgerEntry = InferSelectModel<typeof ledgerEntries>;

export const LEDGER_ENTRY_TYPES = [
  'collection_event',
  'payout',
  'correction',
  'treasury_topup',
  'rate_change',
  'tag_revocation',
  'collector_authorization',
  'recycler_sale',
] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

/** Postgres advisory-lock key that serialises appends to the one chain. */
const LEDGER_LOCK_KEY = 8_264_071;

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerError';
  }
}

/** The `payload_hash` for a server-originated fact (payout, rate change, …). */
export function payloadHash(payload: Canonicalizable): Promise<string> {
  return contentHash(payload);
}

export type AppendEntryInput = {
  readonly entryType: LedgerEntryType;
  readonly payloadHash: string;
  /** Reuse the detail row's client UUID where there is one (collection events). */
  readonly id?: string;
  /** For `entry_type = 'correction'`: the entry being superseded. */
  readonly referencesId?: string;
  /** Original device-local capture time for an offline-origin fact. */
  readonly deviceRecordedAt?: Date;
};

/**
 * Append one entry **inside a caller's transaction**. Takes the advisory lock
 * (held until that transaction commits), so `seq` and the hash link are
 * race-free — every other append blocks until this transaction ends. Use this
 * when the entry must be atomic with a detail-row insert (M4-3).
 * @throws {LedgerError} `payloadHash` is not 64 hex chars.
 */
export async function appendEntryTx(tx: Tx, input: AppendEntryInput): Promise<LedgerEntry> {
  if (!/^[0-9a-f]{64}$/.test(input.payloadHash)) {
    throw new LedgerError(
      `appendEntry: payloadHash must be 64 hex chars (got "${input.payloadHash}")`,
    );
  }

  await tx.execute(sql`select pg_advisory_xact_lock(${LEDGER_LOCK_KEY})`);

  const [head] = await tx
    .select({ seq: ledgerEntries.seq, entryHash: ledgerEntries.entryHash })
    .from(ledgerEntries)
    .orderBy(desc(ledgerEntries.seq))
    .limit(1);

  const seq = (head?.seq ?? 0) + 1;
  const prevEntryHash = head?.entryHash ?? null;
  const hash = await computeEntryHash(seq, input.entryType, input.payloadHash, prevEntryHash);

  const [row] = await tx
    .insert(ledgerEntries)
    .values({
      ...(input.id ? { id: input.id } : {}),
      seq,
      entryType: input.entryType,
      payloadHash: input.payloadHash,
      prevEntryHash,
      entryHash: hash,
      ...(input.referencesId ? { referencesId: input.referencesId } : {}),
      ...(input.deviceRecordedAt ? { deviceRecordedAt: input.deviceRecordedAt } : {}),
    })
    .returning();
  if (!row) {
    throw new LedgerError('appendEntry: insert returned no row');
  }
  return row;
}

/** {@link appendEntryTx} in its own transaction — for a standalone fact. */
export async function appendEntry(db: Database, input: AppendEntryInput): Promise<LedgerEntry> {
  return db.transaction((tx) => appendEntryTx(tx, input));
}

export async function latestEntry(db: Queryable): Promise<LedgerEntry | null> {
  const [row] = await db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.seq)).limit(1);
  return row ?? null;
}

export async function entryBySeq(db: Database, seq: number): Promise<LedgerEntry | null> {
  const [row] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.seq, seq));
  return row ?? null;
}

/** Entries with `seq > afterSeq`, ascending, capped (the `GET /ledger` stream, M4-8). */
export async function listEntries(
  db: Database,
  { afterSeq = 0, limit = 500 }: { afterSeq?: number; limit?: number } = {},
): Promise<LedgerEntry[]> {
  return db
    .select()
    .from(ledgerEntries)
    .where(gt(ledgerEntries.seq, afterSeq))
    .orderBy(asc(ledgerEntries.seq))
    .limit(Math.min(Math.max(limit, 1), 5000));
}

/** Default and maximum page size of `GET /api/v1/ledger`. */
export const LEDGER_PAGE_DEFAULT = 100;
export const LEDGER_PAGE_MAX = 500;

export type LedgerPage = { readonly entries: LedgerEntry[]; readonly nextCursor: number | null };

/**
 * One page of the chain, keyset-paginated on `seq`: ascending returns
 * `seq > cursor`, descending `seq < cursor` (no cursor = from the start / the
 * head). `nextCursor` is the last returned `seq`, or `null` on the final page.
 */
export async function pageEntries(
  db: Database,
  {
    cursor,
    order = 'asc',
    limit = LEDGER_PAGE_DEFAULT,
  }: { cursor?: number; order?: 'asc' | 'desc'; limit?: number } = {},
): Promise<LedgerPage> {
  const size = Math.min(Math.max(limit, 1), LEDGER_PAGE_MAX);
  const ascending = order === 'asc';
  const rows = await db
    .select()
    .from(ledgerEntries)
    .where(
      cursor === undefined
        ? undefined
        : ascending
          ? gt(ledgerEntries.seq, cursor)
          : lt(ledgerEntries.seq, cursor),
    )
    .orderBy(ascending ? asc(ledgerEntries.seq) : desc(ledgerEntries.seq))
    .limit(size + 1);

  const entries = rows.slice(0, size);
  const last = entries[entries.length - 1];
  return { entries, nextCursor: rows.length > size && last ? last.seq : null };
}

/**
 * Recompute the whole chain and report the first broken link, if any
 * (`GET /ledger/verify`, `scripts/verify-ledger.ts`). Reads every row — fine
 * for a pilot-scale ledger; `verifyLedger` (`./checkpoints`) can start from the
 * last signed checkpoint instead.
 */
export async function verifyChain(db: Database): Promise<VerifyResult> {
  const rows = await db.select().from(ledgerEntries).orderBy(asc(ledgerEntries.seq));
  return verifyEntries(rows);
}
