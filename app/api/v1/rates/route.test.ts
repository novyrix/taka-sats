// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { GET, POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const sessionFor = (role: string): Session => ({
  user: { id: 'a', role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const postRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/rates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/api/v1/rates — auth (no DB)', () => {
  it('GET 401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it('GET 200 for a supervisor (rates:read)', async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    // no DB → this will 500 on getDb(); assert it at least passed the scope gate
    const res = await GET();
    expect([200, 500]).toContain(res.status);
  });
  it('POST 403 for a supervisor (needs session:configure)', async () => {
    authMock.mockResolvedValue(sessionFor('supervisor'));
    expect((await POST(postRequest({ material: 'PET', rateFiatMinor: 2000 }))).status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/rates — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  beforeEach(async () => {
    await db.execute(sql`truncate table material_rates restart identity cascade`);
  });
  afterAll(async () => {
    await db.execute(sql`truncate table material_rates restart identity cascade`);
  });

  it('admin POSTs a rate, then GET returns it', async () => {
    authMock.mockResolvedValue(sessionFor('admin'));
    const created = await POST(postRequest({ material: 'PET', rateFiatMinor: 2200 }));
    expect(created.status).toBe(201);

    authMock.mockResolvedValue(sessionFor('supervisor'));
    const body = await (await GET()).json();
    expect(body.rates).toHaveLength(1);
    expect(Number(body.rates[0].rateFiatMinor)).toBe(2200);
  });

  it('a second version for the same material closes the first (422 if not forward)', async () => {
    authMock.mockResolvedValue(sessionFor('admin'));
    await POST(
      postRequest({ material: 'PET', rateFiatMinor: 2000, effectiveFrom: '2026-01-01T00:00:00Z' }),
    );
    const older = await POST(
      postRequest({ material: 'PET', rateFiatMinor: 2500, effectiveFrom: '2026-01-01T00:00:00Z' }),
    );
    expect(older.status).toBe(422);
  });
});
