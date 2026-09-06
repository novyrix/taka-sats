// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import type { Session } from 'next-auth';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { auth } from '@/auth';
import { getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';
import { GET } from './route';

const authMock = auth as unknown as { mockResolvedValue: (value: Session | null) => void };
const session = (id: string, role: string): Session => ({
  user: { id, role: role as never, locale: 'en' },
  expires: '2099-01-01T00:00:00.000Z',
});
const req = (qs = '') => new NextRequest(`http://localhost/api/v1/supervisors${qs}`);

describe('/api/v1/supervisors — auth (no DB)', () => {
  it('401 without a session', async () => {
    authMock.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
  });
  it('403 for a supervisor (needs session:configure)', async () => {
    authMock.mockResolvedValue(session('s', 'supervisor'));
    expect((await GET(req())).status).toBe(403);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('/api/v1/supervisors — integration', () => {
  const db = hasDatabase ? getDb() : undefined!;
  beforeEach(async () => {
    await db.execute(sql`truncate table supervisors restart identity cascade`);
  });
  afterAll(async () => {
    await db.execute(sql`truncate table supervisors restart identity cascade`);
  });

  async function make(name: string, role: string, active = true): Promise<void> {
    await db.insert(supervisors).values({
      name,
      role,
      active,
      phone: `+2547${Math.floor(Math.random() * 1e8)}`,
      passwordHash: 'x:y',
    });
  }

  it('lists active staff by name; hides inactive unless asked; filters by role', async () => {
    await make('Ada', 'admin');
    await make('Brian', 'supervisor');
    await make('Zoe', 'hub_lead');
    await make('Gone', 'supervisor', false);

    authMock.mockResolvedValue(session('admin', 'admin'));

    const active = await (await GET(req())).json();
    expect(active.supervisors.map((s: { name: string }) => s.name)).toEqual([
      'Ada',
      'Brian',
      'Zoe',
    ]);
    expect(active.supervisors[0]).not.toHaveProperty('passwordHash');

    const all = await (await GET(req('?includeInactive=1'))).json();
    expect(all.supervisors).toHaveLength(4);

    const assignable = await (await GET(req('?role=supervisor&role=hub_lead'))).json();
    expect(assignable.supervisors.map((s: { name: string }) => s.name)).toEqual(['Brian', 'Zoe']);
  });
});
