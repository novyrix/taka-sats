// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Create a whole test team in one go: N supervisors, M admins and K hub leads, each with a staff
 * code (their sign in name) and a random strong password. Idempotent: an account that already exists
 * is reused and never changed, and only NEW accounts get a password (shown once by the caller).
 * Optionally assigns the field staff to an existing session. Server side only.
 */

import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Role } from '@/lib/auth/permissions';
import { hashPassword } from '@/lib/auth/password';
import type { Database } from '@/lib/db/client';
import { sessions, sessionSupervisors, supervisors } from '@/lib/db/schema';

export type TeamRole = Exclude<Role, 'partner'>;

export type TeamPlan = {
  readonly supervisors: number;
  readonly admins: number;
  readonly hubLeads: number;
  /** Staff code prefix. Letters and digits only, so the code is easy to type on a phone. */
  readonly prefix: string;
  /** Add the supervisors and hub leads to this session (it must exist). */
  readonly sessionId?: string;
};

export type TeamAccount = {
  readonly id: string;
  readonly role: TeamRole;
  readonly identifier: string;
  readonly name: string;
  /** Present only when this run created the account. */
  readonly password?: string;
};

const ROLE_TAG: Record<TeamRole, string> = { supervisor: 'SUP', admin: 'ADM', hub_lead: 'HUB' };
const ROLE_LABEL: Record<TeamRole, string> = {
  supervisor: 'Supervisor',
  admin: 'Admin',
  hub_lead: 'Hub lead',
};
const MAX_PER_ROLE = 50;
const PREFIX = /^[A-Za-z0-9]{1,12}$/;

export class TeamPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamPlanError';
  }
}

/** The staff codes and names a plan calls for, in a stable order. Pure. */
export function planTeam(plan: TeamPlan): { identifier: string; name: string; role: TeamRole }[] {
  if (!PREFIX.test(plan.prefix)) {
    throw new TeamPlanError('prefix must be 1 to 12 letters or digits');
  }
  const counts: [TeamRole, number][] = [
    ['admin', plan.admins],
    ['hub_lead', plan.hubLeads],
    ['supervisor', plan.supervisors],
  ];
  const out: { identifier: string; name: string; role: TeamRole }[] = [];
  for (const [role, count] of counts) {
    if (!Number.isInteger(count) || count < 0 || count > MAX_PER_ROLE) {
      throw new TeamPlanError(`each count must be a whole number from 0 to ${MAX_PER_ROLE}`);
    }
    for (let i = 1; i <= count; i += 1) {
      const n = String(i).padStart(2, '0');
      out.push({
        identifier: `${plan.prefix.toUpperCase()}${ROLE_TAG[role]}${n}`,
        name: `${ROLE_LABEL[role]} ${n}`,
        role,
      });
    }
  }
  if (out.length === 0) {
    throw new TeamPlanError('nothing to create: ask for at least one account');
  }
  return out;
}

/** 24 random characters from a URL safe alphabet: about 144 bits, passes the weak password check. */
export function generatePassword(): string {
  return randomBytes(18).toString('base64url');
}

export async function seedTeam(db: Database, plan: TeamPlan): Promise<TeamAccount[]> {
  const wanted = planTeam(plan);
  if (plan.sessionId) {
    const [session] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.id, plan.sessionId));
    if (!session) {
      throw new TeamPlanError('that session does not exist');
    }
  }

  const accounts: TeamAccount[] = [];
  for (const spec of wanted) {
    const [existing] = await db
      .select({ id: supervisors.id, role: supervisors.role })
      .from(supervisors)
      .where(eq(supervisors.phone, spec.identifier));
    if (existing) {
      if (existing.role !== spec.role) {
        // Never silently reuse a code that belongs to a different role.
        throw new TeamPlanError(`${spec.identifier} already exists with another role`);
      }
      accounts.push({ ...spec, id: existing.id });
      continue;
    }
    const password = generatePassword();
    const [row] = await db
      .insert(supervisors)
      .values({
        name: spec.name,
        phone: spec.identifier,
        role: spec.role,
        passwordHash: await hashPassword(password),
      })
      .returning({ id: supervisors.id });
    if (!row) {
      throw new Error(`could not create ${spec.identifier}`);
    }
    accounts.push({ ...spec, id: row.id, password });
  }

  const field = accounts.filter((a) => a.role !== 'admin');
  if (plan.sessionId && field.length > 0) {
    const sessionId = plan.sessionId;
    await db
      .insert(sessionSupervisors)
      .values(field.map((a) => ({ sessionId, supervisorId: a.id })))
      .onConflictDoNothing();
  }
  return accounts;
}
