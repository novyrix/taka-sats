// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lower the per-checkpoint minimum for this file before settings are first read.
vi.hoisted(() => {
  process.env.TAKASATS__LEDGER__CHECKPOINT_INTERVAL_ENTRIES = '2';
});

import { getDb } from '@/lib/db/client';
import { ledgerCheckpoints } from '@/lib/db/schema';
import { verifyLedger } from '@/lib/ledger/checkpoints';
import { appendEntry } from '@/lib/ledger';
import { configuredPublicKey } from '@/lib/ledger/signing';
import { createLedgerCheckpoint } from './createLedgerCheckpoint';

const SEED = Buffer.alloc(32, 3).toString('base64');
const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('createLedgerCheckpoint job (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  const reset = () =>
    db.execute(sql`truncate ledger_entries, ledger_checkpoints restart identity cascade`);
  const append = (hash: string) =>
    appendEntry(db, { entryType: 'payout', payloadHash: hash.repeat(64) });

  beforeEach(reset);
  afterEach(() => {
    delete process.env.LEDGER_SIGNING_KEY;
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    delete process.env.TAKASATS__LEDGER__CHECKPOINT_INTERVAL_ENTRIES;
    await reset();
  });

  it('skips with a warning when LEDGER_SIGNING_KEY is not set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await append('1');
    await append('2');
    await createLedgerCheckpoint(db);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('LEDGER_SIGNING_KEY'));
    expect(await db.select().from(ledgerCheckpoints)).toHaveLength(0);
  });

  it('waits for the configured minimum, then signs once and verifies', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    process.env.LEDGER_SIGNING_KEY = SEED;

    await append('1');
    await createLedgerCheckpoint(db); // 1 new entry < interval 2
    expect(await db.select().from(ledgerCheckpoints)).toHaveLength(0);

    await append('2');
    await createLedgerCheckpoint(db);
    await createLedgerCheckpoint(db); // already checkpointed
    expect(await db.select().from(ledgerCheckpoints)).toHaveLength(1);

    expect(await verifyLedger(db, { publicKey: configuredPublicKey() })).toMatchObject({
      ok: true,
      checkpoints: { verified: 1, signaturesChecked: true },
    });
  });

  it('rejects an invalid key instead of silently skipping', async () => {
    process.env.LEDGER_SIGNING_KEY = 'nope';
    await append('1');
    await append('2');
    await expect(createLedgerCheckpoint(db)).rejects.toThrow(/32-byte/);
  });
});
