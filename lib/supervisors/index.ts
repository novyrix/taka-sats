// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reading the staff roster (ROADMAP M2-6, M2-8). The admin "New Session" flow
 * and the rotations UI both need a pickable list of supervisors. Writes still
 * go only through `scripts/create-supervisor.ts` (§3.1). Framework-free apart
 * from Drizzle (D-04).
 */

import { and, asc, eq, inArray, type SQL } from 'drizzle-orm';
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
