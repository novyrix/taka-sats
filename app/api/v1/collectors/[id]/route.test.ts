// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { enrolCollector } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };

function sessionFor(role: string): Session {
  return {
    user: { id: 'actor-1', role: role as never, locale: 'en' },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function getRequest(id: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/collectors/${id}`);
}

describe('GET /api/v1/collectors/:id — auth (no DB required)', () => {
  it('401s with no session', async () => {
    authMock.mockResolvedValue(null);
    const response = await GET(getRequest('11111111-1111-4111-8111-111111111111'), {
      params: Promise.resolve({ id: '11111111-1111-4111-8111-111111111111' }),
    });
    expect(response.status).toBe(401);
  });

  it('400s on a non-UUID id', async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    const response = await GET(getRequest('not-a-uuid'), {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(response.status).toBe(400);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('GET /api/v1/collectors/:id — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    await db.execute(
      sql`truncate table anomaly_flags, tag_history, collectors restart identity cascade`,
    );
  });

  afterAll(async () => {
    await db.execute(
      sql`truncate table anomaly_flags, tag_history, collectors restart identity cascade`,
    );
  });

  it('returns the collector', async () => {
    const collector = await enrolCollector(db, { alias: 'Amina' });
    const response = await GET(getRequest(collector.id), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.collector.alias).toBe('Amina');
  });

  it('404s for an unknown id', async () => {
    const response = await GET(getRequest('99999999-9999-4999-8999-999999999999'), {
      params: Promise.resolve({ id: '99999999-9999-4999-8999-999999999999' }),
    });
    expect(response.status).toBe(404);
  });
});
