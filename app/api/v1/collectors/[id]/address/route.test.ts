// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/jobs', () => ({
  enqueueValidateCollectorDestination: vi.fn(),
  enqueueProcessPayout: vi.fn(),
  enqueuePayoutsAwaitingDestination: vi.fn(),
}));
// The real provider fetches with the global fetch behind a DNS check — answer it offline.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { sessions, sessionSupervisors } from '@/lib/db/schema';
import { createCollector, createStaff, resetCollectorTables } from '@/lib/testing/fixtures';
import { POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };

function sessionFor(role: string, id = 'actor-1'): Session {
  return {
    user: { id, role: role as never, locale: 'en' },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function postRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/collectors/${id}/address`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/collectors/:id/address — auth (no DB required)', () => {
  it('401s with no session', async () => {
    authMock.mockResolvedValue(null);
    const id = '11111111-1111-4111-8111-111111111111';
    const response = await POST(postRequest(id, { rawCode: 'amina@blink.sv' }), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(401);
  });

  it("403s for a role without collector:enrol (partner can't attach)", async () => {
    authMock.mockResolvedValue(sessionFor('partner'));
    const id = '11111111-1111-4111-8111-111111111111';
    const response = await POST(postRequest(id, { rawCode: 'amina@blink.sv' }), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('POST /api/v1/collectors/:id/address — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  const originalFetch = globalThis.fetch;

  let supervisorId = '';

  /** Open a session now and assign this supervisor — the M2-7 "may act" window. */
  async function openSessionFor(staffId: string): Promise<void> {
    const [ses] = await db
      .insert(sessions)
      .values({
        location: 'Kibera Hub',
        status: 'active',
        scheduledStart: new Date(Date.now() - 3_600_000),
        scheduledEnd: new Date(Date.now() + 3_600_000),
      })
      .returning({ id: sessions.id });
    await db.insert(sessionSupervisors).values({ sessionId: ses!.id, supervisorId: staffId });
  }

  beforeEach(async () => {
    await resetCollectorTables(db);
    await db.execute(sql`truncate table session_supervisors, sessions restart identity cascade`);
    const supervisor = await createStaff(db, 'supervisor');
    supervisorId = supervisor.id;
    await openSessionFor(supervisor.id);
    authMock.mockResolvedValue(sessionFor('supervisor', supervisor.id));
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await resetCollectorTables(db);
  });

  function stubLnurl(tag: 'payRequest' | 'withdrawRequest') {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          tag,
          callback: 'https://blink.sv/cb',
          minSendable: 1000,
          maxSendable: 100000000,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;
  }

  it('stores a validated receive address (200) and exposes it as the live destination', async () => {
    stubLnurl('payRequest');
    const collector = await createCollector(db, { registeredBy: supervisorId });
    const response = await POST(postRequest(collector.id, { rawCode: 'amina@blink.sv' }), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.collector.lightningAddress).toBe('amina@blink.sv');
    expect(body.destination).toMatchObject({ address: 'amina@blink.sv', status: 'verified' });
  });

  it('rejects a withdraw code with 422 and stores nothing (ADR-0001)', async () => {
    stubLnurl('withdrawRequest');
    const collector = await createCollector(db, { registeredBy: supervisorId });
    const response = await POST(postRequest(collector.id, { rawCode: 'evil@attacker.test' }), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('not_receive_capable');
  });

  it("rejects a Paybee card's Pay QR with 422 spend_credential_rejected — and never fetches it", async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const collector = await createCollector(db, { registeredBy: supervisorId });
    const response = await POST(
      postRequest(collector.id, { rawCode: 'https://card.paybee.buzz/sample-card' }),
      { params: Promise.resolve({ id: collector.id }) },
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('spend_credential_rejected');
    expect(JSON.stringify(body)).not.toContain('sample-card');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('403 no_active_session when a supervisor has no session to act in (M2-7)', async () => {
    await db.execute(sql`truncate table session_supervisors restart identity cascade`);
    const collector = await createCollector(db, { registeredBy: supervisorId });
    const response = await POST(postRequest(collector.id, { rawCode: 'amina@blink.sv' }), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('no_active_session');
  });

  it('403 not_your_collector when the collector was registered by someone else', async () => {
    const other = await createStaff(db, 'supervisor');
    const collector = await createCollector(db, { registeredBy: other.id });
    const response = await POST(postRequest(collector.id, { rawCode: 'thief@blink.sv' }), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe('not_your_collector');
  });

  it('staff are not shift-bound and may set any collector’s wallet', async () => {
    stubLnurl('payRequest');
    await db.execute(sql`truncate table session_supervisors, sessions restart identity cascade`);
    const hubLead = await createStaff(db, 'hub_lead');
    authMock.mockResolvedValue(sessionFor('hub_lead', hubLead.id));
    const collector = await createCollector(db); // registered by nobody (pre-gate)
    const response = await POST(postRequest(collector.id, { rawCode: 'amina@blink.sv' }), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(200);
  });
});
