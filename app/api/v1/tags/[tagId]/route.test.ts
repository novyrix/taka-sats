// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { enrolCollector, reissueTag, revokeTag } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };

function sessionFor(role: string): Session {
  return {
    user: { id: 'actor-1', role: role as never, locale: 'en' },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function getRequest(tagId: string): NextRequest {
  return new NextRequest(`http://localhost/api/v1/tags/${tagId}`);
}

function call(tagId: string) {
  return GET(getRequest(tagId), { params: Promise.resolve({ tagId }) });
}

describe('GET /api/v1/tags/:tagId — auth (no DB required)', () => {
  it('401s with no session', async () => {
    authMock.mockResolvedValue(null);
    expect((await call('TAG-1')).status).toBe(401);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('GET /api/v1/tags/:tagId — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    await db.execute(sql`truncate table tag_history, collectors restart identity cascade`);
  });

  afterAll(async () => {
    await db.execute(sql`truncate table tag_history, collectors restart identity cascade`);
  });

  it('resolves an active tag to its collector (200)', async () => {
    const collector = await enrolCollector(db, { alias: 'Amina' });
    await reissueTag(db, { collectorId: collector.id, newTagId: 'TAG-ACTIVE' });

    const response = await call('TAG-ACTIVE');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.collector.alias).toBe('Amina');
  });

  it('rejects a revoked tag with 410 (M1-9)', async () => {
    const collector = await enrolCollector(db, { alias: 'Amina' });
    await reissueTag(db, { collectorId: collector.id, newTagId: 'TAG-GONE' });
    await revokeTag(db, { tagId: 'TAG-GONE' });

    const response = await call('TAG-GONE');
    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error.code).toBe('tag_revoked');
  });

  it('404s for a tag that was never issued', async () => {
    expect((await call('NEVER-ISSUED')).status).toBe(404);
  });
});
