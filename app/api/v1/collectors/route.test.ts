// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { collectors, sessions, sessionSupervisors, supervisors } from '@/lib/db/schema';
import { createCollector } from '@/lib/testing/fixtures';
import { sql } from 'drizzle-orm';
import { GET, POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };

function sessionFor(role: string, id = 'actor-1'): Session {
  return {
    user: { id, role: role as never, locale: 'en' },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/v1/collectors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getRequest(qs: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/collectors${qs}`);
}

describe('POST /api/v1/collectors — auth (no DB required)', () => {
  it('401s with no session', async () => {
    authMock.mockResolvedValue(null);
    const response = await POST(postRequest({ alias: 'Amina' }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('unauthorized');
  });

  it("403s for a role without collector:enrol (partner can't enrol)", async () => {
    authMock.mockResolvedValue(sessionFor('partner'));
    const response = await POST(postRequest({ alias: 'Amina' }));
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.code).toBe('forbidden');
  });

  it('GET ?q= 400s without a query', async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    expect((await GET(getRequest(''))).status).toBe(400);
  });

  it('GET ?q= 403s for partner (needs collector:read)', async () => {
    authMock.mockResolvedValue(sessionFor('partner'));
    expect((await GET(getRequest('?q=am'))).status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

const TRUNCATE = sql`truncate table anomaly_flags, tag_history, collector_payment_destinations, collector_authorizations, collection_events, collectors, ledger_entries, session_supervisors, sessions, supervisors restart identity cascade`;

describe.skipIf(!hasDatabase)('POST /api/v1/collectors — success (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;
  let supId = '';

  beforeEach(async () => {
    await db.execute(TRUNCATE);
    // M2-7: a plain supervisor enrols only inside an active assigned session.
    const [sup] = await db
      .insert(supervisors)
      .values({
        name: 'Brian',
        phone: `+2547${Math.floor(Math.random() * 1e8)}`,
        passwordHash: 'x:y',
      })
      .returning({ id: supervisors.id });
    supId = sup!.id;
    const [ses] = await db
      .insert(sessions)
      .values({
        location: 'Kibera Hub',
        status: 'active',
        scheduledStart: new Date(Date.now() - 3_600_000),
        scheduledEnd: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: sessions.id });
    await db.insert(sessionSupervisors).values({ sessionId: ses!.id, supervisorId: supId });
    authMock.mockResolvedValue(sessionFor('supervisor', supId));
  });

  afterAll(async () => {
    await db.execute(TRUNCATE);
  });

  it("registers a supervisor's collector as pending, with a public code and a credential reference", async () => {
    const response = await POST(postRequest({ alias: 'Amina', siteCode: 'KBR' }));
    expect(response.status).toBe(201);
    const { collector } = await response.json();
    expect(collector).toMatchObject({
      alias: 'Amina',
      status: 'pending',
      publicCode: 'TS-KBR-0001',
      registeredBy: supId,
      authorizedBy: null,
    });
    expect(collector.reference).toEqual({
      payload: 'takasats:TS-KBR-0001',
      url: 'https://taka.afribit.africa/c/TS-KBR-0001',
    });
    // Internal columns never reach the client.
    expect(collector).not.toHaveProperty('lnbitsWalletId');
  });

  it('registers an admin-created collector as already authorized', async () => {
    authMock.mockResolvedValue(sessionFor('admin', supId));
    const { collector } = await (await POST(postRequest({ alias: 'Musa' }))).json();
    expect(collector.status).toBe('active');
    expect(collector.authorizedBy).toBe(supId);
  });

  it('rejects an invalid body with 400', async () => {
    const response = await POST(postRequest({ alias: '' }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('invalid_request');
  });

  it('is idempotent on a repeated client id (REQUIREMENTS §10.1)', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const first = await POST(postRequest({ id, alias: 'Amina' }));
    const second = await POST(postRequest({ id, alias: 'Amina (retry)' }));

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const firstBody = await first.json();
    const secondBody = await second.json();
    expect(secondBody.collector).toEqual(firstBody.collector); // original result, not the retry's alias

    const rows = await db.select().from(collectors);
    expect(rows).toHaveLength(1);
  });

  it('GET ?q= returns authorized alias matches (case-insensitive) and finds by code', async () => {
    await createCollector(db, { alias: 'Amina Otieno', publicCode: 'TS-KBR-0042' });
    await createCollector(db, { alias: 'Brian Kamau' });
    await createCollector(db, { alias: 'Aminata' });
    await createCollector(db, { alias: 'Amina Pending', status: 'pending' }); // never offered

    const byAlias = await (await GET(getRequest('?q=amin'))).json();
    expect((byAlias.collectors as { alias: string }[]).map((c) => c.alias).sort()).toEqual([
      'Amina Otieno',
      'Aminata',
    ]);
    expect(byAlias.collectors[0]).toHaveProperty('publicCode');

    const byCode = await (await GET(getRequest('?q=0042'))).json();
    expect((byCode.collectors as { alias: string }[]).map((c) => c.alias)).toEqual([
      'Amina Otieno',
    ]);
  });

  it('GET without q 400s for the default (active) listing', async () => {
    expect((await GET(getRequest(''))).status).toBe(400);
    expect((await GET(getRequest('?status=active'))).status).toBe(400);
  });

  it('a supervisor lists only their own pending registrations — never revoked or all', async () => {
    await POST(postRequest({ alias: 'Mine' }));
    await createCollector(db, { alias: 'Theirs', status: 'pending' });

    const mine = await (await GET(getRequest('?status=pending'))).json();
    expect((mine.collectors as { alias: string }[]).map((c) => c.alias)).toEqual(['Mine']);
    // A supervisor gets no destination detail for the review queue.
    expect(mine.collectors[0]).not.toHaveProperty('destination');

    expect((await GET(getRequest('?status=revoked'))).status).toBe(403);
    expect((await GET(getRequest('?status=all'))).status).toBe(403);
  });

  it('staff with collector:authorize see the whole pending queue with each destination', async () => {
    await createCollector(db, {
      alias: 'Queued',
      status: 'pending',
      lightningAddress: 'queued@blink.sv',
    });
    authMock.mockResolvedValue(sessionFor('hub_lead', supId));

    const { collectors: queue } = await (await GET(getRequest('?status=pending'))).json();
    expect(queue.map((c: { alias: string }) => c.alias)).toEqual(['Queued']);
    expect(queue[0]).toHaveProperty('destination', null);
    expect((await GET(getRequest('?status=all'))).status).toBe(200);
  });

  it('403 no_active_session when a supervisor has no session to act in (M2-7)', async () => {
    await db.execute(sql`truncate table session_supervisors restart identity cascade`);
    const response = await POST(postRequest({ alias: 'Amina' }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('no_active_session');
  });

  it('an admin enrols without any active session (not shift-bound)', async () => {
    await db.execute(sql`truncate table session_supervisors, sessions restart identity cascade`);
    authMock.mockResolvedValue(sessionFor('admin', supId));
    const response = await POST(postRequest({ alias: 'Amina' }));
    expect(response.status).toBe(201);
  });
});
