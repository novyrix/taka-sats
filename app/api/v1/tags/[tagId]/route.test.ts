// SPDX-License-Identifier: AGPL-3.0-only

import { eq } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { reissueTag, revokeTag } from '@/lib/collectors';
import { getDb } from '@/lib/db/client';
import { createCollector, resetCollectorTables } from '@/lib/testing/fixtures';
import { anomalyFlags, collectors } from '@/lib/db/schema';
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
    await resetCollectorTables(db);
  });

  afterAll(async () => {
    await resetCollectorTables(db);
  });

  it('resolves an active tag to its collector (200)', async () => {
    const collector = await createCollector(db);
    await reissueTag(db, { collectorId: collector.id, newTagId: 'TAG-ACTIVE' });

    const response = await call('TAG-ACTIVE');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.collector.alias).toBe('Amina');
    expect(body.collector.publicCode).toBe(collector.publicCode);
  });

  it('409 collector_not_authorized when the collector was revoked after being tagged (D-25)', async () => {
    const collector = await createCollector(db);
    await reissueTag(db, { collectorId: collector.id, newTagId: 'TAG-DEAUTH' });
    await db.update(collectors).set({ status: 'revoked' }).where(eq(collectors.id, collector.id));

    const response = await call('TAG-DEAUTH');
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('collector_not_authorized');
  });

  it('rejects a revoked tag with 410 (M1-9)', async () => {
    const collector = await createCollector(db);
    await reissueTag(db, { collectorId: collector.id, newTagId: 'TAG-GONE' });
    await revokeTag(db, { tagId: 'TAG-GONE' });

    const response = await call('TAG-GONE');
    expect(response.status).toBe(410);
    const body = await response.json();
    expect(body.error.code).toBe('tag_revoked');

    // The attempt is logged for review (M1-9), never silently.
    const flags = await db.select().from(anomalyFlags);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.flagType).toBe('revoked_tag_tap');
    expect(flags[0]?.context).toEqual({ tagId: 'TAG-GONE' });
  });

  it('404s for a tag that was never issued', async () => {
    expect((await call('NEVER-ISSUED')).status).toBe(404);
  });
});
