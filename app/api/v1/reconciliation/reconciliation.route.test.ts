// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { recordRecyclerSale, recyclerSaleInputSchema } from '@/lib/fraud';
import { seedEvent } from '@/lib/testing/fraud-fixtures';
import { PAYOUT_TRUNCATE, type PayoutWorld, seedPayoutWorld } from '@/lib/testing/payout-fixtures';
import { GET as REPORTS } from './reports/route';
import { POST as RUNS } from './runs/route';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const as = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const url = (path: string) => `http://localhost/api/v1/reconciliation${path}`;
const PERIOD = 'from=2026-06-10T00:00:00Z&to=2026-06-11T00:00:00Z';
const run = (body: unknown) =>
  RUNS(
    new NextRequest(url('/runs'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

describe('/api/v1/reconciliation — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(new NextRequest(url(`?${PERIOD}`)))).status).toBe(401);
    expect((await run({})).status).toBe(401);
    expect((await REPORTS(new NextRequest(url('/reports')))).status).toBe(401);
  });

  it.each(['supervisor', 'hub_lead', 'partner'])('403 for %s on every route', async (role) => {
    authMock.mockResolvedValue(as('11111111-1111-4111-8111-111111111111', role));
    expect((await GET(new NextRequest(url(`?${PERIOD}`)))).status).toBe(403);
    expect((await run({ from: '2026-06-10', to: '2026-06-11' })).status).toBe(403);
    expect((await REPORTS(new NextRequest(url('/reports')))).status).toBe(403);
  });

  it('400 for a missing or inverted period', async () => {
    authMock.mockResolvedValue(as('11111111-1111-4111-8111-111111111111', 'admin'));
    expect((await GET(new NextRequest(url('')))).status).toBe(400);
    expect((await GET(new NextRequest(url('?from=2026-06-11&to=2026-06-10')))).status).toBe(400);
    expect((await run({ from: '2026-06-11', to: '2026-06-10' })).status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/reconciliation — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;

  beforeEach(async () => {
    world = await seedPayoutWorld(db);
    authMock.mockResolvedValue(as(world.adminId, 'admin'));
    await seedEvent(db, world, { weightKg: '20.000' });
    await seedEvent(db, world, { weightKg: '20.000' });
    await recordRecyclerSale(
      db,
      recyclerSaleInputSchema.parse({
        material: 'PET',
        grossKg: 30,
        buyer: 'B',
        soldAt: '2026-06-10T15:00:00Z',
      }),
      world.adminId,
    );
  });
  afterAll(async () => {
    await db.execute(PAYOUT_TRUNCATE);
  });

  it('GET computes on the fly and writes nothing', async () => {
    const res = await GET(new NextRequest(url(`?${PERIOD}`)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      period: { from: '2026-06-10T00:00:00.000Z', to: '2026-06-11T00:00:00.000Z', material: null },
      rows: [
        {
          material: 'PET',
          collectedKg: 40,
          paidKg: 0,
          recyclerKg: 30,
          varianceKg: 10,
          variancePct: 25,
          tolerancePct: 5,
          status: 'flagged',
        },
      ],
    });
    const reports = await (await REPORTS(new NextRequest(url('/reports')))).json();
    expect(reports.reports).toEqual([]);
  });

  it('GET filters by material', async () => {
    const res = await GET(new NextRequest(url(`?${PERIOD}&material=HDPE`)));
    expect((await res.json()).rows).toEqual([]);
  });

  it('POST /runs persists a report and raises the flag; GET /reports lists it', async () => {
    const res = await run({ from: '2026-06-10T00:00:00Z', to: '2026-06-11T00:00:00Z' });
    expect(res.status).toBe(201);
    const { reports } = await res.json();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      material: 'PET',
      status: 'flagged',
      variancePct: 25,
      createdBy: world.adminId,
    });

    const listed = await (await REPORTS(new NextRequest(url('/reports?material=PET')))).json();
    expect(listed.reports.map((r: { id: string }) => r.id)).toEqual([reports[0].id]);
    expect(listed.nextCursor).toBeNull();
  });
});
