// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';
import { createSession, patchSession } from '@/lib/sessions';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});

describe('/api/v1/sessions/current — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });
  it('403 for a partner (partners do not act)', async () => {
    authMock.mockResolvedValue(session('p', 'partner'));
    expect((await GET()).status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/sessions/current — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  beforeEach(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisors restart identity cascade`,
    );
  });
  afterAll(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisors restart identity cascade`,
    );
  });

  it('null until the assigned session is active and open, then returns it', async () => {
    const [sup] = await db
      .insert(supervisors)
      .values({ name: 'Brian', phone: '+254700999888', passwordHash: 'x:y' })
      .returning({ id: supervisors.id });
    authMock.mockResolvedValue(session(sup!.id, 'supervisor'));

    const s = await createSession(db, {
      location: 'Kibera Hub',
      scheduledStart: new Date(Date.now() - 3_600_000),
      scheduledEnd: new Date(Date.now() + 3_600_000),
      supervisorIds: [sup!.id],
    });

    expect((await (await GET()).json()).session).toBeNull();

    await patchSession(db, s.id, { status: 'active' });
    const body = await (await GET()).json();
    expect(body.session.id).toBe(s.id);
    expect(body.session.location).toBe('Kibera Hub');
  });
});
