// SPDX-License-Identifier: AGPL-3.0-only

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { ledgerEntries } from '@/lib/db/schema';
import { sha256Hex } from '@/lib/sync/contentHash';
import {
  appendEntry,
  computeEntryHash,
  entryBySeq,
  entryHashInput,
  latestEntry,
  LedgerError,
  listEntries,
  payloadHash,
  verifyChain,
} from './index';

const H = (c: string) => c.repeat(64);

describe('entry-hash form (no DB)', () => {
  it('is `seq | entry_type | payload_hash | prev_entry_hash`, GENESIS at the head', () => {
    expect(entryHashInput(1, 'collection_event', H('a'), null)).toBe(
      `1|collection_event|${H('a')}|GENESIS`,
    );
    expect(entryHashInput(2, 'payout', H('b'), H('a'))).toBe(`2|payout|${H('b')}|${H('a')}`);
  });

  it('computeEntryHash is the sha256 of that form (fixed vector)', async () => {
    expect(await computeEntryHash(1, 'collection_event', H('a'), null)).toBe(
      await sha256Hex(`1|collection_event|${H('a')}|GENESIS`),
    );
  });

  it('payloadHash matches the shared canonical content hash', async () => {
    expect(await payloadHash({ b: 2, a: 1 })).toBe(await sha256Hex('{"a":1,"b":2}'));
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('lib/ledger (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    await db.execute(sql`truncate ledger_entries, ledger_checkpoints restart identity cascade`);
  });
  afterAll(async () => {
    await db.execute(sql`truncate ledger_entries, ledger_checkpoints restart identity cascade`);
  });

  it('appends a linked chain: seq 1..n, prev links, verifyChain ok', async () => {
    const a = await appendEntry(db, { entryType: 'collection_event', payloadHash: H('1') });
    const b = await appendEntry(db, { entryType: 'payout', payloadHash: H('2') });
    const c = await appendEntry(db, { entryType: 'rate_change', payloadHash: H('3') });

    expect([a.seq, b.seq, c.seq]).toEqual([1, 2, 3]);
    expect(a.prevEntryHash).toBeNull();
    expect(b.prevEntryHash).toBe(a.entryHash);
    expect(c.prevEntryHash).toBe(b.entryHash);
    expect(a.entryHash).toBe(await computeEntryHash(1, 'collection_event', H('1'), null));

    const result = await verifyChain(db);
    expect(result).toEqual({ ok: true, count: 3, throughSeq: 3, headHash: c.entryHash });

    expect((await latestEntry(db))?.seq).toBe(3);
    expect((await entryBySeq(db, 2))?.entryHash).toBe(b.entryHash);
    expect((await listEntries(db, { afterSeq: 1 })).map((e) => e.seq)).toEqual([2, 3]);
  });

  it('reuses the client UUID as the entry id when given', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const entry = await appendEntry(db, { entryType: 'collection_event', payloadHash: H('a'), id });
    expect(entry.id).toBe(id);
  });

  it('rejects a non-hex payloadHash', async () => {
    await expect(
      appendEntry(db, { entryType: 'payout', payloadHash: 'nope' }),
    ).rejects.toBeInstanceOf(LedgerError);
  });

  it('UPDATE and DELETE on ledger_entries are blocked at the DB level', async () => {
    await appendEntry(db, { entryType: 'collection_event', payloadHash: H('1') });

    // Drizzle wraps the pg error; the trigger's message is on `.cause`.
    const errText = (e: unknown): string => {
      const err = e as { message?: string; cause?: { message?: string } };
      return `${err.message ?? ''} ${err.cause?.message ?? ''}`;
    };

    const upd = await db
      .update(ledgerEntries)
      .set({ payloadHash: H('9') })
      .where(eq(ledgerEntries.seq, 1))
      .catch((e: unknown) => e);
    expect(errText(upd)).toMatch(/append-only/i);

    const del = await db
      .delete(ledgerEntries)
      .where(eq(ledgerEntries.seq, 1))
      .catch((e: unknown) => e);
    expect(errText(del)).toMatch(/append-only/i);

    expect((await entryBySeq(db, 1))?.payloadHash).toBe(H('1'));
  });

  it('verifyChain catches a tampered entry_hash', async () => {
    const a = await appendEntry(db, { entryType: 'collection_event', payloadHash: H('1') });
    // insert a structurally-linked row whose entry_hash is wrong
    await db.insert(ledgerEntries).values({
      seq: 2,
      entryType: 'payout',
      payloadHash: H('2'),
      prevEntryHash: a.entryHash,
      entryHash: H('0'),
    });
    const result = await verifyChain(db);
    expect(result).toMatchObject({ ok: false, brokenAt: 2 });
    expect((result as { reason: string }).reason).toMatch(/entry_hash mismatch/);
  });

  it('verifyChain catches a seq gap', async () => {
    await appendEntry(db, { entryType: 'collection_event', payloadHash: H('1') });
    await db.insert(ledgerEntries).values({
      seq: 5,
      entryType: 'payout',
      payloadHash: H('2'),
      prevEntryHash: H('1'),
      entryHash: H('2'),
    });
    const result = await verifyChain(db);
    expect(result).toMatchObject({ ok: false, brokenAt: 5 });
    expect((result as { reason: string }).reason).toMatch(/seq gap/);
  });

  it('verifyChain is ok for an empty chain', async () => {
    expect(await verifyChain(db)).toEqual({ ok: true, count: 0, throughSeq: 0, headHash: null });
  });
});
