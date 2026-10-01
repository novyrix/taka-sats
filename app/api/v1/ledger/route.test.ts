// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import type { Session } from 'next-auth';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { appendEntry } from '@/lib/ledger';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const as = (role: string): Session => ({
  user: { id: '11111111-1111-4111-8111-111111111111', role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const get = (query = '') => GET(new NextRequest(`http://localhost/api/v1/ledger${query}`));

describe('GET /api/v1/ledger — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });

  it.each(['supervisor', 'hub_lead', 'partner'])(
    '403 for %s — the ledger is admin-only',
    async (role) => {
      authMock.mockResolvedValue(as(role));
      const res = await get();
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe('forbidden');
    },
  );
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('GET /api/v1/ledger — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  const reset = () =>
    db.execute(sql`truncate ledger_entries, ledger_checkpoints restart identity cascade`);

  beforeEach(async () => {
    await reset();
    authMock.mockResolvedValue(as('admin'));
    for (const c of ['1', '2', '3']) {
      await appendEntry(db, { entryType: 'collection_event', payloadHash: c.repeat(64) });
    }
  });
  afterAll(reset);

  it('streams the chain ascending with a cursor', async () => {
    const first = await (await get('?limit=2')).json();
    expect(first.entries.map((e: { seq: number }) => e.seq)).toEqual([1, 2]);
    expect(first.nextCursor).toBe(2);
    expect(first.order).toBe('asc');
    expect(first.entries[0]).toEqual({
      id: expect.any(String),
      seq: 1,
      entryType: 'collection_event',
      payloadHash: '1'.repeat(64),
      prevEntryHash: null,
      entryHash: expect.stringMatching(/^[0-9a-f]{64}$/),
      referencesId: null,
      createdAt: expect.any(String),
      deviceRecordedAt: null,
    });

    const rest = await (await get('?limit=2&cursor=2')).json();
    expect(rest.entries.map((e: { seq: number }) => e.seq)).toEqual([3]);
    expect(rest.nextCursor).toBeNull();
  });

  it('supports newest-first', async () => {
    const body = await (await get('?order=desc&limit=2')).json();
    expect(body.entries.map((e: { seq: number }) => e.seq)).toEqual([3, 2]);
    expect(body.nextCursor).toBe(2);
  });

  it('clamps an oversized limit rather than failing', async () => {
    const res = await get('?limit=100000');
    expect(res.status).toBe(200);
    expect((await res.json()).entries).toHaveLength(3);
  });

  it.each(['?order=sideways', '?limit=0', '?limit=abc', '?cursor=-1', '?cursor=1.5'])(
    '400 for the bad query %s',
    async (query) => {
      const res = await get(query);
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('invalid_request');
    },
  );
});
