// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { verifyChain } from '@/lib/ledger';
import { PAYOUT_TRUNCATE, type PayoutWorld, seedPayoutWorld } from '@/lib/testing/payout-fixtures';
import { GET, POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const as = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const post = (body: unknown) =>
  POST(
    new NextRequest('http://localhost/api/v1/recycler-sales', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const get = (query = '') => GET(new NextRequest(`http://localhost/api/v1/recycler-sales${query}`));
const SALE = {
  material: 'PET',
  grossKg: 10.5,
  tareKg: 0.25,
  buyer: 'Kibera Recyclers',
  soldAt: '2026-06-10T12:00:00Z',
};

describe('/api/v1/recycler-sales — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await post(SALE)).status).toBe(401);
    expect((await get()).status).toBe(401);
  });

  it.each(['supervisor', 'hub_lead', 'partner'])('403 for %s — admin only', async (role) => {
    authMock.mockResolvedValue(as('11111111-1111-4111-8111-111111111111', role));
    expect((await post(SALE)).status).toBe(403);
    expect((await get()).status).toBe(403);
  });

  it('400 for a malformed body, before any DB access', async () => {
    authMock.mockResolvedValue(as('11111111-1111-4111-8111-111111111111', 'admin'));
    const res = await post({ ...SALE, tareKg: 11 }); // tare > gross
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_request');
    expect((await post({ ...SALE, grossKg: -1 })).status).toBe(400);
    expect((await post({ ...SALE, receiptSha256: 'nope' })).status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/recycler-sales — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;

  beforeEach(async () => {
    world = await seedPayoutWorld(db);
    authMock.mockResolvedValue(as(world.adminId, 'admin'));
  });
  afterAll(async () => {
    await db.execute(PAYOUT_TRUNCATE);
  });

  it('201 with the server-computed net weight, ledgered and attributed to the admin', async () => {
    const res = await post({ ...SALE, receiptSha256: 'f'.repeat(64), totalFiatMinor: 21000 });
    expect(res.status).toBe(201);
    const { sale } = await res.json();
    expect(sale).toMatchObject({
      material: 'PET',
      grossKg: 10.5,
      tareKg: 0.25,
      weightKg: 10.25,
      buyer: 'Kibera Recyclers',
      totalFiatMinor: 21000,
      receiptPath: `/api/v1/photos/${'f'.repeat(64)}`,
      enteredBy: world.adminId,
      ledgerSeq: 1,
    });
    expect(await verifyChain(db)).toMatchObject({ ok: true, count: 1 });
  });

  it('is idempotent on the client id — a resend returns the original, nothing new', async () => {
    const id = '7d1f4a6e-3b52-4c80-9a11-0f2e5d6c7b88';
    const first = await (await post({ ...SALE, id })).json();
    const resend = await post({ ...SALE, id, grossKg: 99 });
    expect(resend.status).toBe(201);
    expect((await resend.json()).sale).toEqual(first.sale);
    expect(await verifyChain(db)).toMatchObject({ count: 1 });
  });

  it('GET lists newest sale first with a cursor', async () => {
    for (const day of ['08', '09', '10']) {
      await post({ ...SALE, soldAt: `2026-06-${day}T12:00:00Z` });
    }
    const page1 = await (await get('?limit=2')).json();
    expect(page1.sales.map((s: { soldAt: string }) => s.soldAt.slice(0, 10))).toEqual([
      '2026-06-10',
      '2026-06-09',
    ]);
    const page2 = await (await get(`?limit=2&cursor=${page1.nextCursor}`)).json();
    expect(page2.sales).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    expect((await get('?cursor=garbage')).status).toBe(400);
  });
});
