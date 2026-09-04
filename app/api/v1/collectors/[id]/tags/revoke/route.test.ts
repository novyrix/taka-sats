// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { enrolCollector, reissueTag } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import { POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };

function sessionFor(role: string): Session {
  return {
    user: { id: 'actor-1', role: role as never, locale: 'en' },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function postRequest(id: string, body: unknown = {}): NextRequest {
  return new NextRequest(`http://localhost/api/v1/collectors/${id}/tags/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/collectors/:id/tags/revoke — auth (no DB required)', () => {
  it('403s for supervisor (admin-only — §3.2)', async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    const id = '11111111-1111-4111-8111-111111111111';
    const response = await POST(postRequest(id), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
  });

  it('403s for hub_lead too — only admin holds tag:revoke', async () => {
    authMock.mockResolvedValue(sessionFor('hub_lead'));
    const id = '11111111-1111-4111-8111-111111111111';
    const response = await POST(postRequest(id), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('POST /api/v1/collectors/:id/tags/revoke — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    authMock.mockResolvedValue(sessionFor('admin'));
    await db.execute(sql`truncate table tag_history, collectors restart identity cascade`);
  });

  afterAll(async () => {
    await db.execute(sql`truncate table tag_history, collectors restart identity cascade`);
  });

  it("revokes the collector's current tag when no tagId is given", async () => {
    const collector = await enrolCollector(db, { alias: 'Amina' });
    await reissueTag(db, { collectorId: collector.id, newTagId: 'TAG-001' });

    const response = await POST(postRequest(collector.id), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tag.revokedAt).not.toBeNull();
  });

  it('404s when the collector has no active tag', async () => {
    const collector = await enrolCollector(db, { alias: 'Amina' });
    const response = await POST(postRequest(collector.id), {
      params: Promise.resolve({ id: collector.id }),
    });
    expect(response.status).toBe(404);
  });
});
