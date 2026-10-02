// SPDX-License-Identifier: AGPL-3.0-only

import { eq, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';
import { verifyPassword, weakPasswordReason } from '@/lib/auth/password';
import { generatePassword, planTeam, seedTeam, TeamPlanError } from './seedTeam';

describe('planTeam', () => {
  it('names the accounts in a stable order with typeable codes', () => {
    const plan = planTeam({ supervisors: 2, admins: 1, hubLeads: 1, prefix: 'test' });
    expect(plan.map((p) => p.identifier)).toEqual([
      'TESTADM01',
      'TESTHUB01',
      'TESTSUP01',
      'TESTSUP02',
    ]);
  });

  it('refuses bad input', () => {
    const base = { supervisors: 1, admins: 1, hubLeads: 0, prefix: 'T' };
    expect(() => planTeam({ ...base, prefix: 'has space' })).toThrow(TeamPlanError);
    expect(() => planTeam({ ...base, prefix: '' })).toThrow(TeamPlanError);
    expect(() => planTeam({ ...base, supervisors: -1 })).toThrow(TeamPlanError);
    expect(() => planTeam({ ...base, admins: 1.5 })).toThrow(TeamPlanError);
    expect(() => planTeam({ ...base, supervisors: 999 })).toThrow(TeamPlanError);
    expect(() => planTeam({ supervisors: 0, admins: 0, hubLeads: 0, prefix: 'T' })).toThrow(
      TeamPlanError,
    );
  });
});

describe('generatePassword', () => {
  it('is long, random and acceptable to the password policy', () => {
    const a = generatePassword();
    expect(a.length).toBeGreaterThanOrEqual(24);
    expect(weakPasswordReason(a)).toBeNull();
    expect(generatePassword()).not.toBe(a);
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('seedTeam (database)', () => {
  const db = hasDatabase ? getDb() : (undefined as never);
  const prefix = 'ZSEEDT';

  afterAll(async () => {
    await db.delete(supervisors).where(like(supervisors.phone, `${prefix}%`));
  });

  it('creates the team once, then changes nothing and prints no password again', async () => {
    const plan = { supervisors: 3, admins: 3, hubLeads: 1, prefix };
    const first = await seedTeam(db, plan);
    expect(first).toHaveLength(7);
    expect(first.every((a) => a.password)).toBe(true);
    expect(new Set(first.map((a) => a.password)).size).toBe(7);
    expect(first.filter((a) => a.role === 'admin')).toHaveLength(3);

    const [row] = await db.select().from(supervisors).where(eq(supervisors.phone, 'ZSEEDTSUP01'));
    const supPassword = first.find((a) => a.identifier === 'ZSEEDTSUP01')?.password ?? '';
    expect(row?.role).toBe('supervisor');
    expect(await verifyPassword(supPassword, row?.passwordHash ?? '')).toBe(true);

    const second = await seedTeam(db, plan);
    expect(second.map((a) => a.id)).toEqual(first.map((a) => a.id));
    expect(second.some((a) => a.password)).toBe(false);
    // The stored hash did not move.
    const [again] = await db.select().from(supervisors).where(eq(supervisors.phone, 'ZSEEDTSUP01'));
    expect(again?.passwordHash).toBe(row?.passwordHash);
  });

  it('refuses a code that already belongs to another role', async () => {
    await db.update(supervisors).set({ role: 'admin' }).where(eq(supervisors.phone, 'ZSEEDTSUP01'));
    await expect(seedTeam(db, { supervisors: 1, admins: 0, hubLeads: 0, prefix })).rejects.toThrow(
      /another role/,
    );
  });

  it('refuses an unknown session', async () => {
    await expect(
      seedTeam(db, {
        supervisors: 1,
        admins: 0,
        hubLeads: 0,
        prefix,
        sessionId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toThrow(/session/);
  });
});
