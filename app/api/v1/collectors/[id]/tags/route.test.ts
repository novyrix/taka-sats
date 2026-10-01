// SPDX-License-Identifier: AGPL-3.0-only

import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { createCollector, resetCollectorTables } from '@/lib/testing/fixtures';
import { POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };

function sessionFor(role: string): Session {
  return {
    user: { id: 'actor-1', role: role as never, locale: 'en' },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function postRequest(id: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/v1/collectors/${id}/tags`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/collectors/:id/tags — auth (no DB required)', () => {
  it("403s for a role without collector:enrol (partner can't reissue)", async () => {
    authMock.mockResolvedValue(sessionFor('partner'));
    const id = '11111111-1111-4111-8111-111111111111';
    const response = await POST(postRequest(id, { newTagId: 'TAG-001' }), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('POST /api/v1/collectors/:id/tags — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    await resetCollectorTables(db);
  });

  afterAll(async () => {
    await resetCollectorTables(db);
  });

  it('reissues a tag and returns 201', async () => {
    const collector = await createCollector(db);
    const response = await POST(postRequest(collector.id, { newTagId: 'TAG-001' }), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.tag.tagId).toBe('TAG-001');
  });

  it('409 collector_not_authorized when the collector is still pending (D-25)', async () => {
    const collector = await createCollector(db, { status: 'pending' });
    const response = await POST(postRequest(collector.id, { newTagId: 'TAG-NOPE' }), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe('collector_not_authorized');
    expect(body.error.details).toEqual({ status: 'pending' });
  });

  it('404s for an unknown collector', async () => {
    const id = '99999999-9999-4999-8999-999999999999';
    const response = await POST(postRequest(id, { newTagId: 'TAG-002' }), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(404);
  });
});
