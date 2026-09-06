// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { collectors } from '@/lib/db/schema';
import { sql } from 'drizzle-orm';
import { GET, POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };

function sessionFor(role: string): Session {
  return {
    user: { id: 'actor-1', role: role as never, locale: 'en' },
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

describe.skipIf(!hasDatabase)('POST /api/v1/collectors — success (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    await db.execute(sql`truncate table tag_history, collectors restart identity cascade`);
  });

  afterAll(async () => {
    await db.execute(sql`truncate table tag_history, collectors restart identity cascade`);
  });

  it('enrols a collector and returns 201', async () => {
    const response = await POST(postRequest({ alias: 'Amina' }));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.collector.alias).toBe('Amina');
    expect(body.collector.status).toBe('active');
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

  it('GET ?q= returns alias matches (case-insensitive)', async () => {
    await POST(postRequest({ alias: 'Amina Otieno' }));
    await POST(postRequest({ alias: 'Brian Kamau' }));
    await POST(postRequest({ alias: 'Aminata' }));

    const response = await GET(getRequest('?q=amin'));
    expect(response.status).toBe(200);
    const body = await response.json();
    const aliases = (body.collectors as { alias: string }[]).map((c) => c.alias).sort();
    expect(aliases).toEqual(['Amina Otieno', 'Aminata']);
  });
});
