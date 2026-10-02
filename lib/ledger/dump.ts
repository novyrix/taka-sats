// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Offline verification of an exported ledger (D-19): the entries
 * (and optionally the checkpoints + public key) as JSON or NDJSON, checked with
 * no database. Used by `scripts/verify-ledger.ts`. Accepts the `GET /api/v1/ledger`
 * field names (camelCase) and raw table column names (snake_case).
 *
 * Accepted shapes: `{ entries, checkpoints?, publicKey? }`, a bare JSON array
 * of entries/checkpoints, or NDJSON with one entry or checkpoint per line. A
 * checkpoint is recognised by its `through_seq`.
 */

import { type ChainEntry, verifyEntries, type VerifyLedgerResult } from './chain';
import { type SignedCheckpoint, verifyCheckpoints } from './signing';

export type LedgerDump = {
  readonly entries: ChainEntry[];
  readonly checkpoints: SignedCheckpoint[];
  /** A public key shipped inside the file — NOT independently pinned. */
  readonly publicKey: string | null;
};

export class LedgerDumpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerDumpError';
  }
}

type Json = Record<string, unknown>;

function field(item: Json, camel: string, snake: string): unknown {
  return camel in item ? item[camel] : item[snake];
}

function text(item: Json, camel: string, snake: string, where: string): string {
  const value = field(item, camel, snake);
  if (typeof value !== 'string') {
    throw new LedgerDumpError(`${where}: "${camel}" must be a string`);
  }
  return value;
}

function int(item: Json, camel: string, snake: string, where: string): number {
  const value = field(item, camel, snake);
  const n = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isSafeInteger(n)) {
    throw new LedgerDumpError(`${where}: "${camel}" must be an integer`);
  }
  return n;
}

function toEntry(item: Json, where: string): ChainEntry {
  const prev = field(item, 'prevEntryHash', 'prev_entry_hash');
  if (prev !== null && typeof prev !== 'string') {
    throw new LedgerDumpError(`${where}: "prevEntryHash" must be a string or null`);
  }
  return {
    seq: int(item, 'seq', 'seq', where),
    entryType: text(item, 'entryType', 'entry_type', where),
    payloadHash: text(item, 'payloadHash', 'payload_hash', where),
    prevEntryHash: prev,
    entryHash: text(item, 'entryHash', 'entry_hash', where),
  };
}

function toCheckpoint(item: Json, where: string): SignedCheckpoint {
  return {
    throughSeq: int(item, 'throughSeq', 'through_seq', where),
    entryHash: text(item, 'entryHash', 'entry_hash', where),
    signature: text(item, 'signature', 'signature', where),
  };
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonLoose(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    const lines = input.split(/\r?\n/).filter((line) => line.trim() !== '');
    try {
      return lines.map((line) => JSON.parse(line) as unknown);
    } catch {
      throw new LedgerDumpError('input is neither JSON nor NDJSON');
    }
  }
}

/** @throws {LedgerDumpError} the input is not a recognisable ledger export. */
export function parseDump(input: string): LedgerDump {
  const parsed = parseJsonLoose(input);
  let items: unknown[];
  let publicKey: string | null = null;
  let extraCheckpoints: unknown[] = [];

  if (isObject(parsed) && Array.isArray(parsed.entries)) {
    items = parsed.entries;
    extraCheckpoints = Array.isArray(parsed.checkpoints) ? parsed.checkpoints : [];
    publicKey = typeof parsed.publicKey === 'string' ? parsed.publicKey : null;
  } else {
    items = Array.isArray(parsed) ? parsed : [parsed];
  }

  const entries: ChainEntry[] = [];
  const checkpoints: SignedCheckpoint[] = [];
  [...items, ...extraCheckpoints].forEach((item, index) => {
    const where = `item ${index + 1}`;
    if (!isObject(item)) {
      throw new LedgerDumpError(`${where}: not an object`);
    }
    if (field(item, 'throughSeq', 'through_seq') !== undefined) {
      checkpoints.push(toCheckpoint(item, where));
    } else {
      entries.push(toEntry(item, where));
    }
  });
  return { entries, checkpoints, publicKey };
}

/**
 * Verify an exported ledger: recompute the chain from genesis and check every
 * checkpoint (signature when `publicKey` is given, and its `entry_hash`
 * against the chain).
 */
export async function verifyDump(
  dump: LedgerDump,
  publicKey: string | null,
): Promise<VerifyLedgerResult> {
  const entries = [...dump.entries].sort((a, b) => a.seq - b.seq);
  const result = await verifyEntries(entries);
  if (!result.ok) {
    return { ...result, mode: 'full' };
  }

  const hashes = new Map(entries.map((entry) => [entry.seq, entry.entryHash]));
  const verdict = verifyCheckpoints(dump.checkpoints, (seq) => hashes.get(seq), publicKey);
  if (!verdict.ok) {
    return { ok: false, mode: 'full', brokenAt: verdict.throughSeq, reason: verdict.reason };
  }
  return {
    ...result,
    mode: 'full',
    checkpoints: { verified: verdict.verified, signaturesChecked: verdict.signaturesChecked },
  };
}
