// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { partners, supervisors } from '@/lib/db/schema';
import { listPartners } from '@/lib/partners';
import { listSupervisors } from './index';

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('listSupervisors / listPartners', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    await db.execute(sql`truncate table supervisors, partners restart identity cascade`);
  });
  afterAll(async () => {
    await db.execute(sql`truncate table supervisors, partners restart identity cascade`);
  });

  it('listSupervisors: active-only by default, role filter, name order', async () => {
    await db.insert(supervisors).values([
      { name: 'Zoe', role: 'admin', phone: '+254700000001', passwordHash: 'x:y' },
      { name: 'Ada', role: 'supervisor', phone: '+254700000002', passwordHash: 'x:y' },
      {
        name: 'Old',
        role: 'supervisor',
        phone: '+254700000003',
        passwordHash: 'x:y',
        active: false,
      },
    ]);

    const active = await listSupervisors(db);
    expect(active.map((s) => s.name)).toEqual(['Ada', 'Zoe']);

    const all = await listSupervisors(db, { activeOnly: false });
    expect(all).toHaveLength(3);

    const supersOnly = await listSupervisors(db, { roles: ['supervisor'] });
    expect(supersOnly.map((s) => s.name)).toEqual(['Ada']);
  });

  it('listPartners: active-only by default, name order', async () => {
    await db.insert(partners).values([
      { name: 'Fedi', loginEmail: 'a@fedi.example', passwordHash: 'x:y' },
      { name: 'Blink', loginEmail: 'b@blink.example', passwordHash: 'x:y' },
      { name: 'Dormant', loginEmail: 'c@x.example', passwordHash: 'x:y', active: false },
    ]);

    const active = await listPartners(db);
    expect(active.map((p) => p.name)).toEqual(['Blink', 'Fedi']);

    const all = await listPartners(db, { activeOnly: false });
    expect(all).toHaveLength(3);
  });
});
