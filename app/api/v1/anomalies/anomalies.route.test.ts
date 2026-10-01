// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { raiseFlag } from '@/lib/fraud';
import { createStaff } from '@/lib/testing/fixtures';
import { seedEvent } from '@/lib/testing/fraud-fixtures';
import { PAYOUT_TRUNCATE, type PayoutWorld, seedPayoutWorld } from '@/lib/testing/payout-fixtures';
import { POST as REVIEW } from './[id]/review/route';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const as = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const get = (query = '') => GET(new NextRequest(`http://localhost/api/v1/anomalies${query}`));
const review = (id: string, body: unknown) =>
  REVIEW(
    new NextRequest(`http://localhost/api/v1/anomalies/${id}/review`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('/api/v1/anomalies — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    expect((await review(UNKNOWN, { outcome: 'dismissed' })).status).toBe(401);
  });

  it.each(['supervisor', 'hub_lead', 'partner'])('403 for %s — admin only', async (role) => {
    authMock.mockResolvedValue(as('11111111-1111-4111-8111-111111111111', role));
    expect((await get()).status).toBe(403);
    expect((await review(UNKNOWN, { outcome: 'dismissed' })).status).toBe(403);
  });

  it('400 for a bad filter, a bad outcome or a bad id', async () => {
    authMock.mockResolvedValue(as('11111111-1111-4111-8111-111111111111', 'admin'));
    expect((await get('?status=weird')).status).toBe(400);
    expect((await get('?type=weird')).status).toBe(400);
    expect((await review(UNKNOWN, { outcome: 'maybe' })).status).toBe(400);
    expect((await review('nope', { outcome: 'dismissed' })).status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/anomalies — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;
  let eventId: string;
  let flagId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (response: Response) => (await response.json()) as Record<string, any>;

  beforeEach(async () => {
    world = await seedPayoutWorld(db);
    authMock.mockResolvedValue(as(world.adminId, 'admin'));
    eventId = await seedEvent(db, world);
    await raiseFlag(db, {
      type: 'weight_outlier',
      eventId,
      collectorId: world.collectorId,
      supervisorId: world.recorderId,
      context: { weightKg: '900.000' },
    });
    await raiseFlag(db, { type: 'mass_balance_variance', context: { material: 'PET' } });
    flagId = (await json(await get(`?eventId=${eventId}`))).anomalies[0].id;
  });
  afterAll(async () => {
    await db.execute(PAYOUT_TRUNCATE);
  });

  it('lists open flags, naming the collector and supervisor, filterable by type and event', async () => {
    const all = await json(await get());
    expect(all.anomalies).toHaveLength(2);
    expect(all.nextCursor).toBeNull();

    const byEvent = (await json(await get(`?eventId=${eventId}`))).anomalies;
    expect(byEvent).toHaveLength(1);
    expect(byEvent[0]).toMatchObject({
      id: flagId,
      type: 'weight_outlier',
      status: 'open',
      eventId,
      sessionId: world.sessionId,
      context: { weightKg: '900.000' },
      collector: { alias: 'Amina', publicCode: expect.any(String) },
      supervisor: { name: 'Brian' },
    });
    expect((await json(await get('?type=mass_balance_variance'))).anomalies).toHaveLength(1);
    expect((await json(await get('?limit=1'))).nextCursor).not.toBeNull();
  });

  it('review: sets the verdict, is idempotent, and a different admin can overturn it', async () => {
    const first = await json(await review(flagId, { outcome: 'dismissed', note: 'fine' }));
    expect(first).toMatchObject({
      changed: true,
      anomaly: { status: 'dismissed', reviewedBy: world.adminId, reviewNote: 'fine' },
    });
    expect((await json(await get())).anomalies).toHaveLength(1); // no longer open
    expect((await json(await get('?status=dismissed'))).anomalies).toHaveLength(1);

    expect((await json(await review(flagId, { outcome: 'dismissed' }))).changed).toBe(false);

    const flip = await review(flagId, { outcome: 'confirmed' });
    expect(flip.status).toBe(409);
    expect((await json(flip)).error.code).toBe('review_final');

    const other = await createStaff(db, 'admin', 'Second admin');
    authMock.mockResolvedValue(as(other.id, 'admin'));
    const overturned = await json(await review(flagId, { outcome: 'confirmed', note: 'fraud' }));
    expect(overturned).toMatchObject({
      changed: true,
      anomaly: { status: 'confirmed', reviewedBy: other.id },
    });
    expect(overturned.anomaly.context.history).toEqual([
      expect.objectContaining({ outcome: 'dismissed', reviewedBy: world.adminId, note: 'fine' }),
    ]);
  });

  it('404 for an unknown flag', async () => {
    const res = await review(UNKNOWN, { outcome: 'dismissed' });
    expect(res.status).toBe(404);
  });
});
