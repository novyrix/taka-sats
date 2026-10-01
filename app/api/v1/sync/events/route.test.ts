// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/storage', () => ({ photoUrlFor: vi.fn(async () => null) }));
vi.mock('@/lib/jobs', () => ({ enqueueProcessPayout: vi.fn(async () => undefined) }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import {
  collectors,
  exchangeRateSnapshots,
  materialRates,
  sessions,
  sessionSupervisors,
  supervisors,
} from '@/lib/db/schema';
import { assembleCollectionEvent } from '@/lib/sync';
import { POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const req = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/sync/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/api/v1/sync/events — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(req({ events: [] }))).status).toBe(401);
  });
  it('403 for a partner', async () => {
    authMock.mockResolvedValue(session('p', 'partner'));
    expect((await POST(req({ events: [] }))).status).toBe(403);
  });
  it('400 for an empty batch', async () => {
    authMock.mockResolvedValue(session('s', 'supervisor'));
    expect((await POST(req({ events: [] }))).status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);
const HEX64 = 'f'.repeat(64);
const TRUNCATE = sql`truncate collection_events, ledger_entries, session_supervisors, sessions, supervisors, collectors, material_rates, exchange_rate_snapshots restart identity cascade`;

describe.skipIf(!hasDatabase)('/api/v1/sync/events — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let supId = '';
  let input: Record<string, unknown>;

  beforeEach(async () => {
    await db.execute(TRUNCATE);
    const [sup] = await db
      .insert(supervisors)
      .values({
        name: 'Brian',
        phone: `+2547${Math.floor(Math.random() * 1e8)}`,
        passwordHash: 'x:y',
      })
      .returning({ id: supervisors.id });
    supId = sup!.id;
    const [col] = await db
      .insert(collectors)
      .values({ alias: 'Amina', addressSource: 'byo', publicCode: 'TS-0001', status: 'active' })
      .returning({ id: collectors.id });
    const [rate] = await db
      .insert(materialRates)
      .values({
        material: 'PET',
        rateFiatMinor: 2000,
        fiatCurrency: 'KES',
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      })
      .returning({ id: materialRates.id });
    await db.insert(exchangeRateSnapshots).values({
      base: 'BTC',
      quote: 'KES',
      rate: '5000000',
      sources: [{ source: 't', rate: 5_000_000 }],
      fetchedAt: new Date('2026-06-10T09:00:00Z'),
    });
    const [ses] = await db
      .insert(sessions)
      .values({
        location: 'Hub',
        status: 'active',
        scheduledStart: new Date('2026-06-10T08:00:00Z'),
        scheduledEnd: new Date('2026-06-10T14:00:00Z'),
      })
      .returning({ id: sessions.id });
    await db.insert(sessionSupervisors).values({ sessionId: ses!.id, supervisorId: supId });

    const event = await assembleCollectionEvent(
      {
        collectorId: col!.id,
        supervisorId: supId,
        sessionId: ses!.id,
        material: 'PET',
        weightKg: 2.5,
        rateId: rate!.id,
        rateFiatMinor: 2000,
        exchangeRate: 5_000_000,
        photoSha256: HEX64,
        geo: { kind: 'unavailable', reason: 'no signal' },
        registrationType: 'tap',
      },
      { recordedAt: new Date('2026-06-10T10:00:00Z') },
    );
    input = { ...event };
    delete (input as { photoUrl?: unknown }).photoUrl;
  });
  afterAll(async () => {
    await db.execute(TRUNCATE);
  });

  it('a supervisor syncs their own event → confirmed + seq', async () => {
    authMock.mockResolvedValue(session(supId, 'supervisor'));
    const body = await (await POST(req({ events: [input] }))).json();
    expect(body.results).toEqual([{ id: input.id, status: 'confirmed', seq: 1 }]);

    // resend → same result, no dup
    const again = await (await POST(req({ events: [input] }))).json();
    expect(again.results).toEqual([{ id: input.id, status: 'confirmed', seq: 1 }]);
  });

  it("a supervisor may not sync another supervisor's event", async () => {
    authMock.mockResolvedValue(session('someone-else', 'supervisor'));
    const body = await (await POST(req({ events: [input] }))).json();
    expect(body.results[0]).toMatchObject({ id: input.id, status: 'needs_attention' });
    expect(body.results[0].reason).toMatch(/only sync their own/);
  });

  it('an admin may sync on behalf of the supervisor', async () => {
    authMock.mockResolvedValue(session('admin', 'admin'));
    const body = await (await POST(req({ events: [input] }))).json();
    expect(body.results[0]).toMatchObject({ status: 'confirmed', seq: 1 });
  });

  it('a malformed event never fails the batch — the good events behind it still sync', async () => {
    authMock.mockResolvedValue(session(supId, 'supervisor'));
    const poisoned = { ...input, id: crypto.randomUUID(), weightKg: 1500 }; // overflows numeric(6,3)
    const res = await POST(req({ events: [poisoned, null, 'junk', {}, input] }));

    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results).toHaveLength(5);
    expect(results[0]).toMatchObject({
      id: poisoned.id,
      status: 'needs_attention',
      code: 'invalid_event',
    });
    for (const bad of results.slice(1, 4)) {
      expect(bad).toMatchObject({ id: '', status: 'needs_attention', code: 'invalid_event' });
    }
    expect(results[4]).toMatchObject({ id: input.id, status: 'confirmed' });
  });

  it('still 400s for a broken envelope (not an events array, or empty, or over 200)', async () => {
    authMock.mockResolvedValue(session(supId, 'supervisor'));
    expect((await POST(req({ events: [] }))).status).toBe(400);
    expect((await POST(req({}))).status).toBe(400);
    expect((await POST(req({ events: 'x' }))).status).toBe(400);
    expect((await POST(req({ events: new Array(201).fill(input) }))).status).toBe(400);
  });
});
