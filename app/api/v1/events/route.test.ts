// SPDX-License-Identifier: AGPL-3.0-only

import { eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { collectionEvents } from '@/lib/db/schema';
import { raiseFlag } from '@/lib/fraud';
import { createCollector } from '@/lib/testing/fixtures';
import { seedEvent, seedPaidPayout } from '@/lib/testing/fraud-fixtures';
import {
  NOW,
  PAYOUT_TRUNCATE,
  type PayoutWorld,
  seedPayoutWorld,
} from '@/lib/testing/payout-fixtures';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const as = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const get = (query = '') => GET(new NextRequest(`http://localhost/api/v1/events${query}`));
const at = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

describe('GET /api/v1/events — auth (no DB)', () => {
  it('401 without a session, 403 for a partner', async () => {
    authMock.mockResolvedValue(null);
    expect((await get()).status).toBe(401);
    authMock.mockResolvedValue(as('11111111-1111-4111-8111-111111111111', 'partner'));
    expect((await get()).status).toBe(403);
  });

  it('400 for a bad filter or a limit over 100', async () => {
    authMock.mockResolvedValue(as('11111111-1111-4111-8111-111111111111', 'admin'));
    expect((await get('?sessionId=nope')).status).toBe(400);
    expect((await get('?limit=101')).status).toBe(400);
    expect((await get('?from=yesterday-ish')).status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('GET /api/v1/events — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;
  let mine: string;
  let mineWithGps: string;
  let theirs: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (response: Response) => (await response.json()) as Record<string, any>;

  beforeEach(async () => {
    world = await seedPayoutWorld(db);
    mine = await seedEvent(db, world, { weightKg: '2.000', recordedAt: at(1) });
    mineWithGps = await seedEvent(db, world, {
      weightKg: '3.000',
      recordedAt: at(2),
      gps: { lat: -1.29, lng: 36.82 },
    });
    theirs = await seedEvent(db, world, {
      weightKg: '4.000',
      recordedAt: at(3),
      supervisorId: world.otherSupervisorId,
      material: 'HDPE',
    });
    await seedPaidPayout(db, mineWithGps, world.collectorId, 400);
    await raiseFlag(db, { type: 'weight_outlier', eventId: mineWithGps });
    await raiseFlag(db, { type: 'duplicate_photo', eventId: mineWithGps });
    authMock.mockResolvedValue(as(world.adminId, 'admin'));
  });
  afterAll(async () => {
    await db.execute(PAYOUT_TRUNCATE);
  });

  it('a plain supervisor sees ONLY the events they recorded, and no coordinates', async () => {
    authMock.mockResolvedValue(as(world.recorderId, 'supervisor'));
    const body = await json(await get());
    expect(body.events.map((e: { id: string }) => e.id)).toEqual([mineWithGps, mine]);
    expect(body.events[0].geo).toEqual({ kind: 'fix' });
    expect(body.events[1].geo).toEqual({ kind: 'unavailable' });
    expect(JSON.stringify(body)).not.toContain('36.82');

    authMock.mockResolvedValue(as(world.otherSupervisorId, 'supervisor'));
    expect((await json(await get())).events.map((e: { id: string }) => e.id)).toEqual([theirs]);
    // Asking for someone else's collector/session does not widen the view.
    expect((await json(await get(`?sessionId=${world.sessionId}`))).events).toHaveLength(1);
  });

  it('hub_lead and admin see everything, newest first, with coordinates', async () => {
    for (const role of ['hub_lead', 'admin']) {
      authMock.mockResolvedValue(as(world.adminId, role));
      const body = await json(await get());
      expect(body.events.map((e: { id: string }) => e.id)).toEqual([theirs, mineWithGps, mine]);
      expect(body.events[1].geo).toEqual({ kind: 'fix', lat: -1.29, lng: 36.82, accuracyM: 8 });
      expect(body.events[2].geo).toEqual({ kind: 'unavailable', reason: 'test' });
    }
  });

  it('returns the documented item — photoPath, never photo_url — with payout and open flags', async () => {
    const [item] = (await json(await get(`?collectorId=${world.collectorId}&material=PET`))).events;
    expect(Object.keys(item).sort()).toEqual(
      [
        'collector',
        'geo',
        'id',
        'indicativeSats',
        'material',
        'openFlags',
        'payout',
        'photoPath',
        'photoSha256',
        'recordedAt',
        'scaleId',
        'seq',
        'sessionId',
        'supervisorId',
        'syncedAt',
        'verificationLevel',
        'verificationStatus',
        'weightKg',
        'weightSource',
      ].sort(),
    );
    expect(item).toMatchObject({
      id: mineWithGps,
      weightKg: 3,
      weightSource: 'manual',
      collector: { id: world.collectorId, alias: 'Amina', publicCode: expect.any(String) },
      photoPath: `/api/v1/photos/${item.photoSha256}`,
      verificationLevel: 'V0',
      payout: { status: 'paid', amountSats: 400, id: expect.any(String) },
      openFlags: 2,
    });
    const quiet = (await json(await get(`?material=HDPE`))).events[0];
    expect(quiet).toMatchObject({ payout: null, openFlags: 0 });
    expect(JSON.stringify(item)).not.toContain('photoUrl');
    expect(JSON.stringify(item)).not.toContain('photo_url');
  });

  it('filters by collector, session, and a [from, to) window', async () => {
    const other = await createCollector(db, { alias: 'Other', publicCode: 'TS-7777' });
    await db
      .update(collectionEvents)
      .set({ collectorId: other.id })
      .where(eq(collectionEvents.id, theirs));
    const ids = async (q: string) =>
      (await json(await get(q))).events.map((e: { id: string }) => e.id);
    expect(await ids(`?collectorId=${other.id}`)).toEqual([theirs]);
    expect(await ids(`?sessionId=${world.sessionId}`)).toHaveLength(3);
    expect(await ids(`?from=${at(2).toISOString()}&to=${at(3).toISOString()}`)).toEqual([
      mineWithGps,
    ]);
  });

  it('paginates with a cursor', async () => {
    const page1 = await json(await get('?limit=2'));
    expect(page1.events).toHaveLength(2);
    const page2 = await json(await get(`?limit=2&cursor=${page1.nextCursor}`));
    expect(page2.events.map((e: { id: string }) => e.id)).toEqual([mine]);
    expect(page2.nextCursor).toBeNull();
    expect((await get('?cursor=garbage')).status).toBe(400);
  });
});
