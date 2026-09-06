// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { partners, supervisors } from '@/lib/db/schema';
import { GET, POST } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const postRequest = (body: unknown) =>
  new NextRequest('http://localhost/api/v1/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const listRequest = () => new NextRequest('http://localhost/api/v1/sessions');

describe('/api/v1/sessions — auth (no DB)', () => {
  it('GET 401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(listRequest())).status).toBe(401);
  });
  it('POST 403 for a supervisor (needs session:configure)', async () => {
    authMock.mockResolvedValue(session('s', 'supervisor'));
    expect((await POST(postRequest({ location: 'X' }))).status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/sessions — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  beforeEach(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisors, partners restart identity cascade`,
    );
  });
  afterAll(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisors, partners restart identity cascade`,
    );
  });

  async function makeSupervisor(): Promise<string> {
    const [r] = await db
      .insert(supervisors)
      .values({
        name: 'Brian',
        phone: `+2547${Math.floor(Math.random() * 1e8)}`,
        passwordHash: 'x:y',
      })
      .returning({ id: supervisors.id });
    return r!.id;
  }

  it('admin creates a session; scoped GET shows it only to the assigned supervisor', async () => {
    const s1 = await makeSupervisor();
    const s2 = await makeSupervisor();

    authMock.mockResolvedValue(session('admin', 'admin'));
    const created = await POST(
      postRequest({
        location: 'Soweto West',
        scheduledStart: '2026-06-01T08:00:00Z',
        scheduledEnd: '2026-06-01T14:00:00Z',
        supervisorIds: [s1],
      }),
    );
    expect(created.status).toBe(201);

    authMock.mockResolvedValue(session(s1, 'supervisor'));
    const mine = await (await GET(listRequest())).json();
    expect(mine.sessions).toHaveLength(1);

    authMock.mockResolvedValue(session(s2, 'supervisor'));
    const theirs = await (await GET(listRequest())).json();
    expect(theirs.sessions).toHaveLength(0);

    authMock.mockResolvedValue(session('admin', 'admin'));
    const all = await (await GET(listRequest())).json();
    expect(all.sessions).toHaveLength(1);
  });

  it('a partner sees only sessions they sponsor', async () => {
    const [p] = await db
      .insert(partners)
      .values({ name: 'Trezor', loginEmail: 'p@t.example', passwordHash: 'x:y' })
      .returning({ id: partners.id });

    authMock.mockResolvedValue(session('admin', 'admin'));
    await POST(
      postRequest({
        location: 'Sponsored',
        scheduledStart: '2026-06-01T08:00:00Z',
        scheduledEnd: '2026-06-01T14:00:00Z',
        sponsorPartnerId: p!.id,
      }),
    );
    await POST(
      postRequest({
        location: 'Not sponsored',
        scheduledStart: '2026-06-02T08:00:00Z',
        scheduledEnd: '2026-06-02T14:00:00Z',
      }),
    );

    authMock.mockResolvedValue(session(p!.id, 'partner'));
    const body = await (await GET(listRequest())).json();
    expect(body.sessions.map((s: { location: string }) => s.location)).toEqual(['Sponsored']);
  });
});
