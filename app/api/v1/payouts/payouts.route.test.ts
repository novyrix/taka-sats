// SPDX-License-Identifier: AGPL-3.0-only

import { eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/jobs', () => ({ enqueueProcessPayoutSafely: vi.fn(async () => undefined) }));

import { auth } from '@/auth';
import { resetSettingsCache } from '@/lib/config';
import { getDb } from '@/lib/db/client';
import { anomalyFlags, collectors, payouts } from '@/lib/db/schema';
import { enqueueProcessPayoutSafely } from '@/lib/jobs';
import { FakeLightningProvider } from '@/lib/lightning';
import { PaymentFailedError } from '@/lib/lightning/errors';
import { createPayoutForEvent, processPayout } from '@/lib/payouts';
import { sats } from '@/lib/money';
import {
  NOW,
  PAYOUT_TRUNCATE,
  type PayoutWorld,
  seedCollectionEvent,
  seedPayoutWorld,
} from '@/lib/testing/payout-fixtures';
import { GET as LIST } from './route';
import { GET as DETAIL } from './[id]/route';
import { POST as APPROVE } from './[id]/approve/route';
import { POST as RETRY } from './[id]/retry/route';
import { GET as SUMMARY } from './summary/route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const get = (path: string) => new NextRequest(`http://localhost/api/v1/payouts${path}`);
const post = (path: string, body?: unknown) =>
  new NextRequest(`http://localhost/api/v1/payouts${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const UNKNOWN = '00000000-0000-4000-8000-000000000000';

describe('/api/v1/payouts — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await LIST(get(''))).status).toBe(401);
    expect((await SUMMARY()).status).toBe(401);
    expect((await DETAIL(get(`/${UNKNOWN}`), idParams(UNKNOWN))).status).toBe(401);
    expect((await APPROVE(post(`/${UNKNOWN}/approve`), idParams(UNKNOWN))).status).toBe(401);
    expect((await RETRY(post(`/${UNKNOWN}/retry`), idParams(UNKNOWN))).status).toBe(401);
  });

  it('403 for a partner everywhere', async () => {
    authMock.mockResolvedValue(session('p', 'partner'));
    expect((await LIST(get(''))).status).toBe(403);
    expect((await SUMMARY()).status).toBe(403);
    expect((await DETAIL(get(`/${UNKNOWN}`), idParams(UNKNOWN))).status).toBe(403);
    expect((await APPROVE(post(`/${UNKNOWN}/approve`), idParams(UNKNOWN))).status).toBe(403);
  });

  it('403 for a supervisor on approve and retry — they can read, never release', async () => {
    authMock.mockResolvedValue(session('s', 'supervisor'));
    expect((await APPROVE(post(`/${UNKNOWN}/approve`), idParams(UNKNOWN))).status).toBe(403);
    expect((await RETRY(post(`/${UNKNOWN}/retry`), idParams(UNKNOWN))).status).toBe(403);
  });

  it('400 for a malformed id or query', async () => {
    authMock.mockResolvedValue(session('a', 'admin'));
    expect((await DETAIL(get('/nope'), idParams('nope'))).status).toBe(400);
    expect((await APPROVE(post('/nope/approve'), idParams('nope'))).status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/payouts — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let world: PayoutWorld;
  let fake: FakeLightningProvider;
  /** A: paid (recorder) · B: pending_approval (recorder) · C: pending_approval (other supervisor). */
  let a: string;
  let b: string;
  let c: string;

  async function payout(weightKg: string, supervisorId: string) {
    const eventId = await seedCollectionEvent(db, world, { weightKg, supervisorId });
    const created = await createPayoutForEvent(db, eventId);
    return processPayout(db, fake, created.id, NOW);
  }
  // The response bodies are asserted field by field below; a loose type keeps that readable.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = async (response: Response) => (await response.json()) as Record<string, any>;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(enqueueProcessPayoutSafely).mockClear();
    // 1 kg = 400 sats goes straight through; 2.5 kg = 1000 sats is above this threshold.
    process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS = '999';
    process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT = 'false';
    resetSettingsCache();

    world = await seedPayoutWorld(db);
    fake = new FakeLightningProvider();
    a = (await payout('1', world.recorderId)).id;
    b = (await payout('2.5', world.recorderId)).id;
    c = (await payout('2.5', world.otherSupervisorId)).id;
    authMock.mockResolvedValue(session(world.adminId, 'admin'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TAKASATS__PAYOUTS__SECOND_SIGNOFF_THRESHOLD_SATS;
    delete process.env.TAKASATS__PAYOUTS__REQUIRE_APPROVAL_FIRST_PAYOUT;
    resetSettingsCache();
  });
  afterAll(async () => {
    if (hasDatabase) {
      await db.execute(PAYOUT_TRUNCATE);
    }
  });

  describe('GET /payouts', () => {
    it('lists newest first with the documented fields — and never a Lightning address', async () => {
      const response = await LIST(get(''));
      expect(response.status).toBe(200);
      const body = await json(response);
      expect(body.payouts.map((p: { id: string }) => p.id)).toEqual([c, b, a]);
      expect(body.nextCursor).toBeNull();

      const paid = body.payouts[2];
      expect(Object.keys(paid).sort()).toEqual(
        [
          'amountFiatMinor',
          'amountSats',
          'approvedAt',
          'approvedBy',
          'attempts',
          'collectionEventId',
          'collectorAlias',
          'collectorId',
          'collectorPublicCode',
          'createdAt',
          'fiatCurrency',
          'id',
          'lastError',
          'openFlags',
          'provider',
          'providerPaymentRef',
          'settledAt',
          'status',
        ].sort(),
      );
      expect(paid).toMatchObject({
        status: 'paid',
        amountSats: 400,
        amountFiatMinor: 2000,
        fiatCurrency: 'KES',
        collectorAlias: 'Amina',
        provider: 'fake',
      });
      expect(JSON.stringify(body)).not.toContain('wallet.example');
      expect(JSON.stringify(body)).not.toContain('@');
    });

    it('counts the unreviewed anomaly flags on each payout event', async () => {
      const [pending] = await db
        .select({ eventId: payouts.collectionEventId })
        .from(payouts)
        .where(eq(payouts.id, b));
      await db.insert(anomalyFlags).values([
        { flagType: 'duplicate_photo', collectionEventId: pending!.eventId },
        { flagType: 'weight_outlier', collectionEventId: pending!.eventId },
        {
          flagType: 'gps_outlier',
          collectionEventId: pending!.eventId,
          reviewOutcome: 'dismissed',
        },
      ]);
      const body = await json(await LIST(get('')));
      const flags = Object.fromEntries(
        body.payouts.map((p: { id: string; openFlags: number }) => [p.id, p.openFlags]),
      );
      expect(flags).toEqual({ [a]: 0, [b]: 2, [c]: 0 });
    });

    it('filters by status, collector, event and session', async () => {
      const ids = async (query: string) =>
        (await json(await LIST(get(query)))).payouts.map((p: { id: string }) => p.id);
      expect(await ids('?status=paid')).toEqual([a]);
      expect(await ids('?status=pending_approval')).toEqual([c, b]);
      expect(await ids(`?collectorId=${world.collectorId}`)).toHaveLength(3);
      expect(await ids(`?collectorId=${UNKNOWN}`)).toEqual([]);
      expect(await ids(`?sessionId=${world.sessionId}`)).toHaveLength(3);
      const [event] = (await json(await LIST(get(`?status=paid`)))).payouts;
      expect(await ids(`?eventId=${event.collectionEventId}`)).toEqual([a]);
    });

    it('paginates with an opaque cursor, newest first', async () => {
      const first = await json(await LIST(get('?limit=2')));
      expect(first.payouts.map((p: { id: string }) => p.id)).toEqual([c, b]);
      expect(typeof first.nextCursor).toBe('string');
      const second = await json(
        await LIST(get(`?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`)),
      );
      expect(second.payouts.map((p: { id: string }) => p.id)).toEqual([a]);
      expect(second.nextCursor).toBeNull();
    });

    it('rejects a limit over 100, an unknown status and a forged cursor', async () => {
      expect((await LIST(get('?limit=101'))).status).toBe(400);
      expect((await LIST(get('?limit=0'))).status).toBe(400);
      expect((await LIST(get('?status=refunded'))).status).toBe(400);
      const forged = await LIST(get('?cursor=not-a-real-cursor'));
      expect(forged.status).toBe(400);
      expect((await json(forged)).error.code).toBe('invalid_cursor');
    });

    it('shows a plain supervisor only the payouts of events they recorded', async () => {
      authMock.mockResolvedValue(session(world.recorderId, 'supervisor'));
      const mine = await json(await LIST(get('')));
      expect(mine.payouts.map((p: { id: string }) => p.id)).toEqual([b, a]);

      authMock.mockResolvedValue(session(world.otherSupervisorId, 'supervisor'));
      const theirs = await json(await LIST(get('')));
      expect(theirs.payouts.map((p: { id: string }) => p.id)).toEqual([c]);

      // Asking for someone else's by filter does not widen the view.
      const [first] = mine.payouts;
      const probe = await json(await LIST(get(`?eventId=${first.collectionEventId}`)));
      expect(probe.payouts).toEqual([]);
    });

    it('lets a hub lead see everything', async () => {
      authMock.mockResolvedValue(session(world.hubLeadId, 'hub_lead'));
      expect((await json(await LIST(get('')))).payouts).toHaveLength(3);
    });
  });

  describe('GET /payouts/:id', () => {
    it('returns one payout', async () => {
      const response = await DETAIL(get(`/${a}`), idParams(a));
      expect(response.status).toBe(200);
      expect((await json(response)).payout).toMatchObject({ id: a, status: 'paid' });
    });

    it('404 for an unknown id', async () => {
      const response = await DETAIL(get(`/${UNKNOWN}`), idParams(UNKNOWN));
      expect(response.status).toBe(404);
      expect((await json(response)).error.code).toBe('not_found');
    });

    it("404 — not 403 — for another supervisor's payout", async () => {
      authMock.mockResolvedValue(session(world.recorderId, 'supervisor'));
      expect((await DETAIL(get(`/${c}`), idParams(c))).status).toBe(404);
      expect((await DETAIL(get(`/${b}`), idParams(b))).status).toBe(200);
    });
  });

  describe('GET /payouts/summary', () => {
    it('counts and sums every status, zero-filled', async () => {
      const body = await json(await SUMMARY());
      const by = Object.fromEntries(
        body.byStatus.map((r: { status: string }) => [r.status, r]),
      ) as Record<string, { count: number; totalSats: number }>;
      expect(body.byStatus).toHaveLength(8);
      expect(by.paid).toEqual({ status: 'paid', count: 1, totalSats: 400 });
      expect(by.pending_approval).toEqual({
        status: 'pending_approval',
        count: 2,
        totalSats: 2000,
      });
      expect(by.failed).toEqual({ status: 'failed', count: 0, totalSats: 0 });
      expect(body.total).toEqual({ count: 3, totalSats: 2400 });
    });

    it('is scoped to the supervisor’s own events', async () => {
      authMock.mockResolvedValue(session(world.otherSupervisorId, 'supervisor'));
      expect((await json(await SUMMARY())).total).toEqual({ count: 1, totalSats: 1000 });
    });
  });

  describe('POST /payouts/:id/approve', () => {
    it('releases a held payout once, enqueues it, and is idempotent', async () => {
      authMock.mockResolvedValue(session(world.hubLeadId, 'hub_lead'));
      const first = await APPROVE(post(`/${b}/approve`), idParams(b));
      expect(first.status).toBe(200);
      const body = await json(first);
      expect(body.changed).toBe(true);
      expect(body.payout).toMatchObject({ id: b, status: 'queued', approvedBy: world.hubLeadId });
      expect(enqueueProcessPayoutSafely).toHaveBeenCalledTimes(1);
      expect(enqueueProcessPayoutSafely).toHaveBeenCalledWith({ payoutId: b });

      authMock.mockResolvedValue(session(world.adminId, 'admin'));
      const again = await json(await APPROVE(post(`/${b}/approve`), idParams(b)));
      expect(again.changed).toBe(false);
      expect(again.payout.approvedBy).toBe(world.hubLeadId);
      expect(enqueueProcessPayoutSafely).toHaveBeenCalledTimes(1);
    });

    it('the worker then pays the STORED destination — a destination in the body is ignored', async () => {
      authMock.mockResolvedValue(session(world.hubLeadId, 'hub_lead'));
      const response = await APPROVE(
        post(`/${b}/approve`, { destination: 'attacker@evil.example', lnurlOrAddress: 'x@y.z' }),
        idParams(b),
      );
      expect(response.status).toBe(200);

      const pay = vi.spyOn(fake, 'pay');
      const result = await processPayout(db, fake, b, NOW);
      expect(result.status).toBe('paid');
      expect(pay).toHaveBeenCalledTimes(1);
      expect(pay.mock.calls[0]?.[0]).toEqual({ lnurlOrAddress: 'amina@wallet.example' });
      expect(JSON.stringify(pay.mock.calls)).not.toContain('evil');
    });

    it('403 self_approval when the approver recorded the collection', async () => {
      const own = await payout('2.5', world.hubLeadId); // recorded by the hub lead
      authMock.mockResolvedValue(session(world.hubLeadId, 'hub_lead'));
      const response = await APPROVE(post(`/${own.id}/approve`), idParams(own.id));
      expect(response.status).toBe(403);
      expect((await json(response)).error.code).toBe('self_approval');
      expect(enqueueProcessPayoutSafely).not.toHaveBeenCalled();
    });

    it('409 for a payout that is not awaiting approval, 404 for an unknown one', async () => {
      authMock.mockResolvedValue(session(world.hubLeadId, 'hub_lead'));
      const paid = await APPROVE(post(`/${a}/approve`), idParams(a));
      expect(paid.status).toBe(409);
      expect((await json(paid)).error.code).toBe('invalid_state');
      expect((await APPROVE(post(`/${UNKNOWN}/approve`), idParams(UNKNOWN))).status).toBe(404);
    });
  });

  describe('POST /payouts/:id/retry', () => {
    it('re-queues a failed payout, once', async () => {
      const eventId = await seedCollectionEvent(db, world, { weightKg: '1' });
      const created = await createPayoutForEvent(db, eventId);
      const failing = {
        kind: 'fake' as const,
        pay: async () => {
          throw new PaymentFailedError('no route');
        },
        getFloatBalance: async () => ({ available: sats(1_000_000), asOf: NOW }),
      };
      expect((await processPayout(db, failing, created.id, NOW)).status).toBe('failed');

      authMock.mockResolvedValue(session(world.hubLeadId, 'hub_lead'));
      const first = await RETRY(post(`/${created.id}/retry`), idParams(created.id));
      expect(first.status).toBe(200);
      const body = await json(first);
      expect(body.changed).toBe(true);
      expect(body.payout).toMatchObject({ status: 'queued', lastError: null });
      expect(enqueueProcessPayoutSafely).toHaveBeenCalledWith({ payoutId: created.id });

      const again = await json(await RETRY(post(`/${created.id}/retry`), idParams(created.id)));
      expect(again.changed).toBe(false);
      expect(enqueueProcessPayoutSafely).toHaveBeenCalledTimes(1);
    });

    it('409 for any other state', async () => {
      authMock.mockResolvedValue(session(world.adminId, 'admin'));
      expect((await RETRY(post(`/${a}/retry`), idParams(a))).status).toBe(409);
      expect((await RETRY(post(`/${b}/retry`), idParams(b))).status).toBe(409);
    });

    it('does not touch a revoked collector’s payout state beyond what the engine decides', async () => {
      await db.update(collectors).set({ status: 'revoked' });
      const eventId = await seedCollectionEvent(db, world);
      const created = await createPayoutForEvent(db, eventId);
      expect((await processPayout(db, fake, created.id, NOW)).status).toBe('failed');
      authMock.mockResolvedValue(session(world.adminId, 'admin'));
      await RETRY(post(`/${created.id}/retry`), idParams(created.id));
      // Retried, re-evaluated — still refused, still unpaid.
      expect((await processPayout(db, fake, created.id, NOW)).status).toBe('failed');
      expect(fake.paymentsSent()).toHaveLength(1); // only A's
    });
  });
});
