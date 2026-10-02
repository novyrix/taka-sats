// SPDX-License-Identifier: AGPL-3.0-only

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';
import { createStaff } from '@/lib/testing/fixtures';
import { SupervisorAccessError, setSupervisorActive } from './index';

const hasDatabase = Boolean(process.env.DATABASE_URL);
const TRUNCATE = sql`truncate supervisors restart identity cascade`;

describe.skipIf(!hasDatabase)('setSupervisorActive (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    await db.execute(TRUNCATE);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (hasDatabase) {
      await db.execute(TRUNCATE);
    }
  });

  const isActive = async (id: string) =>
    (await db.select().from(supervisors).where(eq(supervisors.id, id)))[0]?.active;

  it('deactivates and reactivates another account, idempotently', async () => {
    const admin = await createStaff(db, 'admin', 'Admin');
    const field = await createStaff(db, 'supervisor', 'Field');
    expect(
      await setSupervisorActive(db, { id: field.id, active: false, actorId: admin.id }),
    ).toMatchObject({
      changed: true,
      supervisor: { active: false, role: 'supervisor' },
    });
    expect(await isActive(field.id)).toBe(false);
    expect(
      (await setSupervisorActive(db, { id: field.id, active: false, actorId: admin.id })).changed,
    ).toBe(false);
    expect(
      (await setSupervisorActive(db, { id: field.id, active: true, actorId: admin.id })).changed,
    ).toBe(true);
    expect(await isActive(field.id)).toBe(true);
  });

  it('nobody can change their own account', async () => {
    const admin = await createStaff(db, 'admin', 'Admin');
    await createStaff(db, 'admin', 'Other');
    await expect(
      setSupervisorActive(db, { id: admin.id, active: false, actorId: admin.id }),
    ).rejects.toMatchObject({ reason: 'self_change' });
    expect(await isActive(admin.id)).toBe(true);
  });

  it('the last active admin cannot be deactivated, but one of two can', async () => {
    const a = await createStaff(db, 'admin', 'A');
    const b = await createStaff(db, 'admin', 'B');
    await setSupervisorActive(db, { id: a.id, active: false, actorId: b.id });
    await expect(
      setSupervisorActive(db, { id: b.id, active: false, actorId: a.id }),
    ).rejects.toMatchObject({ reason: 'last_admin' });
    expect(await isActive(b.id)).toBe(true);
  });

  it('two admins deactivating each other at the same moment cannot leave none', async () => {
    const a = await createStaff(db, 'admin', 'A');
    const b = await createStaff(db, 'admin', 'B');
    const results = await Promise.allSettled([
      setSupervisorActive(db, { id: a.id, active: false, actorId: b.id }),
      setSupervisorActive(db, { id: b.id, active: false, actorId: a.id }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const [row] = await db.execute(
      sql`select count(*)::int as n from supervisors where role = 'admin' and active`,
    );
    expect(row?.n).toBe(1);
  });

  it('an unknown account is not found', async () => {
    const admin = await createStaff(db, 'admin', 'Admin');
    await expect(
      setSupervisorActive(db, {
        id: '00000000-0000-4000-8000-000000000000',
        active: false,
        actorId: admin.id,
      }),
    ).rejects.toBeInstanceOf(SupervisorAccessError);
  });
});
