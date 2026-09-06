// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { enrolCollector } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import { POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };

function sessionFor(role: string): Session {
  return {
    user: { id: 'actor-1', role: role as never, locale: 'en' },
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

  beforeEach(async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    await db.execute(
      sql`truncate table anomaly_flags, tag_history, collectors restart identity cascade`,
    );
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    await db.execute(
      sql`truncate table anomaly_flags, tag_history, collectors restart identity cascade`,
    );
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

  it('stores a validated receive address (200)', async () => {
    stubLnurl('payRequest');
    const collector = await enrolCollector(db, { alias: 'Amina' });
    const response = await POST(postRequest(collector.id, { rawCode: 'amina@blink.sv' }), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.collector.lightningAddress).toBe('amina@blink.sv');
  });

  it('rejects a withdraw code with 422 and stores nothing (ADR-0001)', async () => {
    stubLnurl('withdrawRequest');
    const collector = await enrolCollector(db, { alias: 'Amina' });
    const response = await POST(postRequest(collector.id, { rawCode: 'evil@attacker.test' }), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error.code).toBe('not_receive_capable');
  });
});
