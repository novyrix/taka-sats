// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { appendEntry } from '@/lib/ledger';
import { createCheckpoint } from '@/lib/ledger/checkpoints';
import { loadSigningKey, publicKeyOf } from '@/lib/ledger/signing';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const as = (role: string): Session => ({
  user: { id: '11111111-1111-4111-8111-111111111111', role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const get = (query = '') =>
  GET(new NextRequest(`http://localhost/api/v1/ledger/checkpoints${query}`));

const SEED = Buffer.alloc(32, 4).toString('base64');

describe('GET /api/v1/ledger/checkpoints — auth (no DB)', () => {
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

describe.skipIf(!hasDatabase)('GET /api/v1/ledger/checkpoints — integration', () => {
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

  it('lists checkpoints newest first with the public key', async () => {
    process.env.LEDGER_SIGNING_KEY = SEED;
    const key = loadSigningKey(SEED);
    for (const c of ['1', '2']) {
      await appendEntry(db, { entryType: 'payout', payloadHash: c.repeat(64) });
      await createCheckpoint(db, { signingKey: key });
    }

    const body = await (await get('?limit=1')).json();
    expect(body.publicKey).toBe(publicKeyOf(key));
    expect(body.checkpoints).toHaveLength(1);
    expect(body.checkpoints[0]).toMatchObject({ throughSeq: 2, entryHash: expect.any(String) });
    expect(body.checkpoints[0].signature).toEqual(expect.any(String));
    expect(body.nextCursor).toBe(2);

    const rest = await (await get('?cursor=2')).json();
    expect(rest.checkpoints.map((c: { throughSeq: number }) => c.throughSeq)).toEqual([1]);
    expect(rest.nextCursor).toBeNull();
  });

  it('an empty list and a null public key when nothing is configured', async () => {
    const body = await (await get()).json();
    expect(body).toEqual({ checkpoints: [], nextCursor: null, publicKey: null });
  });

  it('400 for a bad query', async () => {
    expect((await get('?limit=0')).status).toBe(400);
  });
});
