// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { ledgerEntries } from '@/lib/db/schema';
import { appendEntry } from '@/lib/ledger';
import { createCheckpoint } from '@/lib/ledger/checkpoints';
import { loadSigningKey } from '@/lib/ledger/signing';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const as = (role: string): Session => ({
  user: { id: '11111111-1111-4111-8111-111111111111', role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const get = (query = '') => GET(new NextRequest(`http://localhost/api/v1/ledger/verify${query}`));

const SEED = Buffer.alloc(32, 4).toString('base64');

describe('GET /api/v1/ledger/verify — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it.each(['supervisor', 'hub_lead', 'partner'])('403 for %s', async (role) => {
    authMock.mockResolvedValue(as(role));
    expect((await get()).status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('GET /api/v1/ledger/verify — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  const reset = () =>
    db.execute(sql`truncate ledger_entries, ledger_checkpoints restart identity cascade`);

  beforeEach(async () => {
    await reset();
    authMock.mockResolvedValue(as('admin'));
  });
  afterEach(() => {
    delete process.env.LEDGER_SIGNING_KEY;
  });
  afterAll(reset);

  it('reports ok for an empty ledger', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      mode: 'full',
      count: 0,
      throughSeq: 0,
      headHash: null,
    });
  });

  it('verifies the chain and checkpoint signatures; windowed starts from the checkpoint', async () => {
    process.env.LEDGER_SIGNING_KEY = SEED;
    for (const c of ['1', '2', '3']) {
      await appendEntry(db, { entryType: 'payout', payloadHash: c.repeat(64) });
    }
    await createCheckpoint(db, { signingKey: loadSigningKey(SEED) });
    await appendEntry(db, { entryType: 'payout', payloadHash: '4'.repeat(64) });

    expect(await (await get()).json()).toMatchObject({
      ok: true,
      mode: 'full',
      count: 4,
      throughSeq: 4,
      headHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      checkpoints: { verified: 1, signaturesChecked: true },
    });
    expect(await (await get('?mode=windowed')).json()).toMatchObject({
      ok: true,
      mode: 'windowed',
      count: 1,
      throughSeq: 4,
    });
  });

  it('a broken chain is a 200 result with the break, not an error', async () => {
    const a = await appendEntry(db, { entryType: 'payout', payloadHash: '1'.repeat(64) });
    await db.insert(ledgerEntries).values({
      seq: 2,
      entryType: 'payout',
      payloadHash: '2'.repeat(64),
      prevEntryHash: a.entryHash,
      entryHash: '0'.repeat(64),
    });

    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, mode: 'full', brokenAt: 2 });
  });

  it('503 ledger_key_invalid when LEDGER_SIGNING_KEY is malformed; 400 for a bad mode', async () => {
    process.env.LEDGER_SIGNING_KEY = 'not-a-key';
    const res = await get();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('ledger_key_invalid');

    expect((await get('?mode=sideways')).status).toBe(400);
  });
});
