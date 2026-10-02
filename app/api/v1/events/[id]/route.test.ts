// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { raiseFlag } from '@/lib/fraud';
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
const get = (id: string) =>
  GET(new NextRequest(`http://localhost/api/v1/events/${id}`), { params: Promise.resolve({ id }) });

describe('GET /api/v1/events/:id (no DB)', () => {
  it('401 without a session, 403 for a partner, 400 for a bad id', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    authMock.mockResolvedValue(null);
    expect((await get(id)).status).toBe(401);
    authMock.mockResolvedValue(as(id, 'partner'));
    expect((await get(id)).status).toBe(403);
    authMock.mockResolvedValue(as(id, 'admin'));
    expect((await get('not-a-uuid')).status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('GET /api/v1/events/:id (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;
  let eventId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (response: Response) => (await response.json()) as Record<string, any>;

  beforeEach(async () => {
    world = await seedPayoutWorld(db);
    eventId = await seedEvent(db, world, {
      weightKg: '3.000',
      recordedAt: new Date(NOW.getTime() + 60_000),
      gps: { lat: -1.29, lng: 36.82 },
    });
    await seedPaidPayout(db, eventId, world.collectorId, 400);
    await raiseFlag(db, { type: 'duplicate_photo', eventId });
    authMock.mockResolvedValue(as(world.adminId, 'admin'));
  });
  afterAll(async () => {
    await db.execute(PAYOUT_TRUNCATE);
  });

  it('returns the event, its flags and a verification check for each question', async () => {
    const res = await get(eventId);
    expect(res.status).toBe(200);
    const { event } = await json(res);
    expect(event.id).toBe(eventId);
    expect(event.ledger.seq).toBeGreaterThan(0);
    expect(event.ledger.entryHash).toMatch(/^[0-9a-f]{64}$/);
    expect(event.flags).toEqual([
      expect.objectContaining({ type: 'duplicate_photo', status: 'open' }),
    ]);
    expect(event.checks.map((c: { key: string }) => c.key)).toEqual([
      'collector_authorized',
      'session_window',
      'rate_in_force',
      'photo_stored',
      'gps_inside',
      'duplicate_photo',
      'weight_outlier',
      'payout',
      'ledger_anchor',
    ]);
    const by = (key: string) => event.checks.find((c: { key: string }) => c.key === key);
    expect(by('duplicate_photo').status).toBe('warn');
    expect(by('payout').status).toBe('pass');
    expect(by('ledger_anchor').status).toBe('pass');
    expect(JSON.stringify(event)).not.toContain('photo_url');
  });

  it('a supervisor opens only their own event, and sees no coordinates', async () => {
    authMock.mockResolvedValue(as(world.otherSupervisorId, 'supervisor'));
    expect((await get(eventId)).status).toBe(404);

    authMock.mockResolvedValue(as(world.recorderId, 'supervisor'));
    const res = await get(eventId);
    expect(res.status).toBe(200);
    expect(JSON.stringify(await json(res))).not.toContain('36.82');
  });

  it('404 for an unknown event', async () => {
    expect((await get('22222222-2222-4222-8222-222222222222')).status).toBe(404);
  });
});
