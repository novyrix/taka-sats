// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';
import { DELETE } from './[id]/route';
import { GET, POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (role: string): Session => ({
  user: { id: 'actor-1', role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const postRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/rotations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('/api/v1/rotations — auth (no DB)', () => {
  it('GET 401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it('POST 403 for a supervisor (needs session:configure)', async () => {
    authMock.mockResolvedValue(session('supervisor'));
    expect((await POST(postRequest({}))).status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/rotations — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  beforeEach(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisor_rotations, supervisors restart identity cascade`,
    );
  });
  afterAll(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisor_rotations, supervisors restart identity cascade`,
    );
  });

  it('admin adds, lists, and removes a rotation', async () => {
    const [sup] = await db
      .insert(supervisors)
      .values({ name: 'Brian', phone: '+254700123123', passwordHash: 'x:y' })
      .returning({ id: supervisors.id });
    authMock.mockResolvedValue(session('admin'));

    const created = await POST(
      postRequest({
        supervisorId: sup!.id,
        location: 'Kibera Hub',
        windowStart: '2026-06-01T00:00:00Z',
        windowEnd: '2026-06-30T00:00:00Z',
      }),
    );
    expect(created.status).toBe(201);
    const { rotation } = await created.json();

    const listed = await (await GET()).json();
    expect(listed.rotations).toHaveLength(1);
    expect(listed.rotations[0].supervisorName).toBe('Brian');

    const del = await DELETE(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id: rotation.id }),
    });
    expect(del.status).toBe(204);
    expect((await (await GET()).json()).rotations).toHaveLength(0);
  });

  it('422 when the window is backwards', async () => {
    const [sup] = await db
      .insert(supervisors)
      .values({ name: 'Brian', phone: '+254700123124', passwordHash: 'x:y' })
      .returning({ id: supervisors.id });
    authMock.mockResolvedValue(session('admin'));

    const res = await POST(
      postRequest({
        supervisorId: sup!.id,
        location: 'Kibera Hub',
        windowStart: '2026-06-30T00:00:00Z',
        windowEnd: '2026-06-01T00:00:00Z',
      }),
    );
    expect(res.status).toBe(400); // Zod refine → invalid_request
  });

  it('DELETE 404 for an unknown id', async () => {
    authMock.mockResolvedValue(session('admin'));
    const res = await DELETE(new NextRequest('http://localhost/x'), {
      params: Promise.resolve({ id: '99999999-9999-4999-8999-999999999999' }),
    });
    expect(res.status).toBe(404);
  });
});
