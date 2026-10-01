// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { collectors, exchangeRateSnapshots, materialRates, supervisors } from '@/lib/db/schema';
import { createSession, patchSession } from '@/lib/sessions';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});

describe('/api/v1/weigh/bootstrap — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it('403 for a partner (no collection:record)', async () => {
    authMock.mockResolvedValue(session('p', 'partner'));
    expect((await GET()).status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/weigh/bootstrap — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  beforeEach(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisors, collectors, material_rates, exchange_rate_snapshots restart identity cascade`,
    );
  });
  afterAll(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisors, collectors, material_rates, exchange_rate_snapshots restart identity cascade`,
    );
  });

  it('403 no_active_session when the supervisor has no active session', async () => {
    const [sup] = await db
      .insert(supervisors)
      .values({ name: 'Brian', phone: '+254700555111', passwordHash: 'x:y' })
      .returning({ id: supervisors.id });
    authMock.mockResolvedValue(session(sup!.id, 'supervisor'));

    const res = await GET();
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('no_active_session');
  });

  it('returns the session, rates, exchange rate and cached collectors', async () => {
    const [sup] = await db
      .insert(supervisors)
      .values({ name: 'Brian', phone: '+254700555222', passwordHash: 'x:y' })
      .returning({ id: supervisors.id });
    await db.insert(materialRates).values({
      material: 'PET',
      rateFiatMinor: 2200,
      fiatCurrency: 'KES',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });
    await db.insert(exchangeRateSnapshots).values({
      base: 'BTC',
      quote: 'KES',
      rate: '5000000',
      sources: [{ source: 'fake', rate: 5_000_000 }],
      fetchedAt: new Date(),
    });
    await db.insert(collectors).values([
      { alias: 'Amina', addressSource: 'byo', publicCode: 'TS-0001', status: 'active' },
      { alias: 'Brian K', addressSource: 'byo', publicCode: 'TS-0002', status: 'active' },
      // Never cached: awaiting authorization (D-25).
      { alias: 'Pending Pat', addressSource: 'byo', publicCode: 'TS-0003', status: 'pending' },
    ]);

    const created = await createSession(db, {
      location: 'Kibera Hub',
      scheduledStart: new Date(Date.now() - 3_600_000),
      scheduledEnd: new Date(Date.now() + 3_600_000),
      supervisorIds: [sup!.id],
    });
    await patchSession(db, created.id, { status: 'active' });

    authMock.mockResolvedValue(session(sup!.id, 'supervisor'));
    const body = await (await GET()).json();

    expect(body.session).toMatchObject({ sessionId: created.id, location: 'Kibera Hub' });
    expect(body.rates).toEqual([
      { rateId: expect.any(String), material: 'PET', rateFiatMinor: 2200, fiatCurrency: 'KES' },
    ]);
    expect(body.exchangeRate).toBe(5_000_000);
    expect(body.collectors.map((c: { alias: string }) => c.alias).sort()).toEqual([
      'Amina',
      'Brian K',
    ]);
    expect(body.collectors[0]).toHaveProperty('publicCode');
  });
});
