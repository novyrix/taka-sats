// SPDX-License-Identifier: AGPL-3.0-only

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { ledgerCheckpoints, ledgerEntries } from '@/lib/db/schema';
import { createCheckpoint, latestCheckpoint, pageCheckpoints, verifyLedger } from './checkpoints';
import { appendEntry, LEDGER_PAGE_MAX, pageEntries } from './index';
import { loadSigningKey, publicKeyOf, signCheckpoint } from './signing';

const H = (c: string) => c.repeat(64);
const signingKey = loadSigningKey(Buffer.alloc(32, 5).toString('base64'));
const publicKey = publicKeyOf(signingKey);

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('lib/ledger checkpoints (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  const reset = () =>
    db.execute(sql`truncate ledger_entries, ledger_checkpoints restart identity cascade`);
  async function append(count: number): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await appendEntry(db, { entryType: 'payout', payloadHash: H(String((i % 9) + 1)) });
    }
  }

  beforeEach(reset);
  afterAll(reset);

  describe('createCheckpoint', () => {
    it('does nothing on an empty ledger', async () => {
      expect(await createCheckpoint(db, { signingKey })).toBeNull();
      expect(await latestCheckpoint(db)).toBeNull();
    });

    it('signs the head, once: a second run for the same through_seq writes nothing', async () => {
      await append(3);
      const cp = await createCheckpoint(db, { signingKey });
      expect(cp).toMatchObject({ throughSeq: 3 });
      expect(await createCheckpoint(db, { signingKey })).toBeNull();
      expect(await db.select().from(ledgerCheckpoints)).toHaveLength(1);
    });

    it('is idempotent under concurrent runs', async () => {
      await append(2);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => createCheckpoint(db, { signingKey })),
      );
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await db.select().from(ledgerCheckpoints)).toHaveLength(1);
    });

    it('waits for minNewEntries since the last checkpoint', async () => {
      await append(2);
      await createCheckpoint(db, { signingKey });
      await append(1);
      expect(await createCheckpoint(db, { signingKey, minNewEntries: 2 })).toBeNull();
      await append(1);
      expect(await createCheckpoint(db, { signingKey, minNewEntries: 2 })).toMatchObject({
        throughSeq: 4,
      });
    });
  });

  describe('verifyLedger', () => {
    it('verifies the chain and the checkpoint signatures (full)', async () => {
      await append(3);
      await createCheckpoint(db, { signingKey });
      await append(2);
      await createCheckpoint(db, { signingKey });

      expect(await verifyLedger(db, { publicKey })).toMatchObject({
        ok: true,
        mode: 'full',
        count: 5,
        throughSeq: 5,
        checkpoints: { verified: 2, signaturesChecked: true },
      });
    });

    it('is ok on an empty ledger, and without a public key reports signatures unchecked', async () => {
      expect(await verifyLedger(db)).toMatchObject({ ok: true, count: 0 });
      await append(1);
      await createCheckpoint(db, { signingKey });
      expect(await verifyLedger(db)).toMatchObject({
        ok: true,
        checkpoints: { verified: 1, signaturesChecked: false },
      });
    });

    it('fails on a tampered checkpoint signature and on the wrong key', async () => {
      await append(2);
      const cp = (await createCheckpoint(db, { signingKey }))!;
      expect(
        await verifyLedger(db, {
          publicKey: publicKeyOf(loadSigningKey(Buffer.alloc(32, 6).toString('base64'))),
        }),
      ).toMatchObject({
        ok: false,
        brokenAt: 2,
      });

      await db
        .update(ledgerCheckpoints)
        .set({ signature: signCheckpoint(signingKey, 1, H('1')) })
        .where(eq(ledgerCheckpoints.id, cp.id));
      expect(await verifyLedger(db, { publicKey })).toMatchObject({
        ok: false,
        brokenAt: 2,
        reason: expect.stringContaining('invalid signature'),
      });
    });

    it('fails when a checkpoint names an entry hash the chain does not have, or a seq past the head', async () => {
      await append(2);
      await db.insert(ledgerCheckpoints).values({
        throughSeq: 2,
        entryHash: H('f'),
        signature: signCheckpoint(signingKey, 2, H('f')),
      });
      expect(await verifyLedger(db, { publicKey })).toMatchObject({
        ok: false,
        reason: expect.stringContaining('does not match the chain'),
      });

      await db.delete(ledgerCheckpoints);
      await db.insert(ledgerCheckpoints).values({
        throughSeq: 9,
        entryHash: H('9'),
        signature: signCheckpoint(signingKey, 9, H('9')),
      });
      expect(await verifyLedger(db, { publicKey })).toMatchObject({ ok: false, brokenAt: 9 });
    });

    it('windowed starts from the latest checkpoint and still catches later tampering', async () => {
      await append(3);
      await createCheckpoint(db, { signingKey });
      await append(2);

      expect(await verifyLedger(db, { mode: 'windowed', publicKey })).toMatchObject({
        ok: true,
        mode: 'windowed',
        count: 2,
        throughSeq: 5,
        checkpoints: { verified: 1, signaturesChecked: true },
      });

      // a structurally-linked row with a wrong hash after the checkpoint
      const head = await pageEntries(db, { order: 'desc', limit: 1 });
      await db.insert(ledgerEntries).values({
        seq: 6,
        entryType: 'payout',
        payloadHash: H('6'),
        prevEntryHash: head.entries[0]!.entryHash,
        entryHash: H('0'),
      });
      expect(await verifyLedger(db, { mode: 'windowed', publicKey })).toMatchObject({
        ok: false,
        mode: 'windowed',
        brokenAt: 6,
      });
    });

    it('windowed falls back to a full verify when there is no checkpoint yet', async () => {
      await append(2);
      expect(await verifyLedger(db, { mode: 'windowed', publicKey })).toMatchObject({
        ok: true,
        mode: 'full',
        count: 2,
      });
    });
  });

  describe('pagination', () => {
    it('pages entries ascending and descending by seq cursor, with nextCursor', async () => {
      await append(5);

      const first = await pageEntries(db, { limit: 2 });
      expect(first.entries.map((e) => e.seq)).toEqual([1, 2]);
      expect(first.nextCursor).toBe(2);

      const second = await pageEntries(db, { limit: 2, cursor: 2 });
      expect(second.entries.map((e) => e.seq)).toEqual([3, 4]);

      const last = await pageEntries(db, { limit: 2, cursor: 4 });
      expect(last.entries.map((e) => e.seq)).toEqual([5]);
      expect(last.nextCursor).toBeNull();

      const newest = await pageEntries(db, { limit: 2, order: 'desc' });
      expect(newest.entries.map((e) => e.seq)).toEqual([5, 4]);
      expect(newest.nextCursor).toBe(4);
      const older = await pageEntries(db, { limit: 5, order: 'desc', cursor: 4 });
      expect(older.entries.map((e) => e.seq)).toEqual([3, 2, 1]);
      expect(older.nextCursor).toBeNull();
    });

    it('an exact-size final page has no nextCursor; limit is clamped to [1, max]', async () => {
      await append(2);
      expect((await pageEntries(db, { limit: 2 })).nextCursor).toBeNull();
      expect((await pageEntries(db, { limit: 0 })).entries).toHaveLength(1);
      expect((await pageEntries(db, { limit: LEDGER_PAGE_MAX * 10 })).entries).toHaveLength(2);
      expect((await pageEntries(db, { cursor: 99 })).entries).toEqual([]);
    });

    it('pages checkpoints newest first', async () => {
      await append(1);
      await createCheckpoint(db, { signingKey });
      await append(1);
      await createCheckpoint(db, { signingKey });
      await append(1);
      await createCheckpoint(db, { signingKey });

      const page = await pageCheckpoints(db, { limit: 2 });
      expect(page.checkpoints.map((c) => c.throughSeq)).toEqual([3, 2]);
      expect(page.nextCursor).toBe(2);
      const rest = await pageCheckpoints(db, { limit: 2, cursor: 2 });
      expect(rest.checkpoints.map((c) => c.throughSeq)).toEqual([1]);
      expect(rest.nextCursor).toBeNull();
    });
  });
});
