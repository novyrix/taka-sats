// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reading the staff roster (ROADMAP M2-6, M2-8). The admin "New Session" flow
 * and the rotations UI both need a pickable list of supervisors. Writes still
 * go only through `scripts/create-supervisor.ts` (§3.1). Framework-free apart
 * from Drizzle (D-04).
 */

import { and, asc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import type { Role } from '@/lib/auth/permissions';
import type { Database } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';

/** The compact projection the pickers render — never the password hash. */
export type SupervisorSummary = {
  readonly id: string;
  readonly name: string;
  readonly role: Role;
  readonly active: boolean;
};

export type ListSupervisorsFilter = {
  /** Default `true` — inactive staff are hidden from the pickers. */
  readonly activeOnly?: boolean;
  /** Restrict to these roles (e.g. only `supervisor` + `hub_lead` for assignment). */
  readonly roles?: readonly Role[];
};

export async function listSupervisors(
  db: Database,
  filter: ListSupervisorsFilter = {},
): Promise<SupervisorSummary[]> {
  const conditions: SQL[] = [];
  if (filter.activeOnly ?? true) {
    conditions.push(eq(supervisors.active, true));
  }
  if (filter.roles && filter.roles.length > 0) {
    conditions.push(inArray(supervisors.role, [...filter.roles]));
  }

  const rows = await db
    .select({
      id: supervisors.id,
      name: supervisors.name,
      role: supervisors.role,
      active: supervisors.active,
    })
    .from(supervisors)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(supervisors.name));

  return rows.map((r) => ({ id: r.id, name: r.name, role: r.role as Role, active: r.active }));
}

/** Why a deactivate / reactivate request was refused. */
export class SupervisorAccessError extends Error {
  constructor(
    public readonly reason: 'not_found' | 'self_change' | 'last_admin',
    message: string,
  ) {
    super(message);
    this.name = 'SupervisorAccessError';
  }
}

/**
 * Deactivate or reactivate a staff account (a lost phone, someone leaving). Effective on the very
 * next request: sessions are re-checked against the account (`lib/auth/live-account.ts`).
 * Rules: you cannot change your own account (so an admin cannot lock themselves out, or reactivate
 * themselves after another admin acted), and the last active admin can never be deactivated.
 * Idempotent: `changed: false` when the account was already so. Account creation and password
 * changes still go through the operator scripts only.
 */
export async function setSupervisorActive(
  db: Database,
  input: { readonly id: string; readonly active: boolean; readonly actorId: string },
): Promise<{ readonly supervisor: SupervisorSummary; readonly changed: boolean }> {
  if (input.id === input.actorId) {
    throw new SupervisorAccessError('self_change', 'You cannot change your own account');
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('supervisor-access', 0))`);
    const [row] = await tx.select().from(supervisors).where(eq(supervisors.id, input.id));
    if (!row) {
      throw new SupervisorAccessError('not_found', 'No such account');
    }
    const summary = (active: boolean): SupervisorSummary => ({
      id: row.id,
      name: row.name,
      role: row.role as Role,
      active,
    });
    if (row.active === input.active) {
      return { supervisor: summary(row.active), changed: false };
    }
    if (!input.active && row.role === 'admin') {
      const [others] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(supervisors)
        .where(
          and(
            eq(supervisors.role, 'admin'),
            eq(supervisors.active, true),
            ne(supervisors.id, row.id),
          ),
        );
      if ((others?.n ?? 0) === 0) {
        throw new SupervisorAccessError(
          'last_admin',
          'The last active admin cannot be deactivated',
        );
      }
    }
    await tx.update(supervisors).set({ active: input.active }).where(eq(supervisors.id, row.id));
    console.info(
      '[access]',
      JSON.stringify({ account: row.id, active: input.active, by: input.actorId }),
    );
    return { supervisor: summary(input.active), changed: true };
  });
}
