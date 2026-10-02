// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Collection sessions (FR-8.1, FR-6.1). A session is a place +
 * time window with assigned supervisors, an optional geo polygon, and an
 * optional sponsoring partner. Only `admin` writes (enforced at the API
 * layer); reads are scoped there too. Framework-free apart from Drizzle (D-04).
 */

import { and, desc, eq, gt, type InferSelectModel, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Queryable } from '@/lib/db/client';
import { sessions, sessionSupervisors } from '@/lib/db/schema';
import { rotationSupervisorsFor } from '@/lib/rotations';

export type SessionRecord = InferSelectModel<typeof sessions>;
export type SessionWithSupervisors = SessionRecord & { readonly supervisorIds: string[] };

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

/**
 * A `supervisor` tried to act (enrol, weigh) with no session they may act in
 * right now (FR-6.1, US-6.1). `hub_lead`/`admin` are not
 * shift-bound and never hit this.
 */
export class NoActiveSessionError extends Error {
  constructor(message = 'No active session assigned to you right now') {
    super(message);
    this.name = 'NoActiveSessionError';
  }
}

/** A GeoJSON-ish Polygon: an array of linear rings, each an array of [lng, lat]. */
export const geoBoundsSchema = z
  .object({
    type: z.literal('Polygon'),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
  })
  .strict();

export const createSessionInputSchema = z
  .object({
    id: z.uuid().optional(),
    location: z.string().trim().min(1).max(200),
    scheduledStart: z.coerce.date(),
    scheduledEnd: z.coerce.date(),
    geoBounds: geoBoundsSchema.optional(),
    sponsorPartnerId: z.uuid().optional(),
    supervisorIds: z.array(z.uuid()).default([]),
  })
  .refine((v) => v.scheduledEnd > v.scheduledStart, {
    message: 'scheduledEnd must be after scheduledStart',
    path: ['scheduledEnd'],
  });
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

export const patchSessionInputSchema = z
  .object({
    location: z.string().trim().min(1).max(200).optional(),
    scheduledStart: z.coerce.date().optional(),
    scheduledEnd: z.coerce.date().optional(),
    status: z.enum(['scheduled', 'active', 'closed']).optional(),
    geoBounds: geoBoundsSchema.nullable().optional(),
    sponsorPartnerId: z.uuid().nullable().optional(),
    supervisorIds: z.array(z.uuid()).optional(),
  })
  .strict();
export type PatchSessionInput = z.infer<typeof patchSessionInputSchema>;

async function supervisorIdsFor(db: Queryable, sessionId: string): Promise<string[]> {
  const rows = await db
    .select({ supervisorId: sessionSupervisors.supervisorId })
    .from(sessionSupervisors)
    .where(eq(sessionSupervisors.sessionId, sessionId));
  return rows.map((r) => r.supervisorId);
}

async function replaceSupervisors(
  db: Queryable,
  sessionId: string,
  supervisorIds: string[],
): Promise<void> {
  await db.delete(sessionSupervisors).where(eq(sessionSupervisors.sessionId, sessionId));
  if (supervisorIds.length > 0) {
    await db
      .insert(sessionSupervisors)
      .values([...new Set(supervisorIds)].map((supervisorId) => ({ sessionId, supervisorId })));
  }
}

export type CreateSessionOptions = {
  /**
   * Union the explicit `supervisorIds` with anyone rostered for this
   * location+window via `supervisor_rotations` (M2-8). Default `true`; pass
   * `false` to assign only the explicit list.
   */
  readonly applyRotations?: boolean;
};

export async function createSession(
  db: Database,
  input: CreateSessionInput,
  options: CreateSessionOptions = {},
): Promise<SessionWithSupervisors> {
  const parsed = createSessionInputSchema.parse(input);

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(sessions)
      .values({
        ...(parsed.id ? { id: parsed.id } : {}),
        location: parsed.location,
        scheduledStart: parsed.scheduledStart,
        scheduledEnd: parsed.scheduledEnd,
        geoBounds: parsed.geoBounds ?? null,
        sponsorPartnerId: parsed.sponsorPartnerId ?? null,
      })
      .returning();
    if (!row) {
      throw new SessionError('createSession: insert returned no row');
    }

    const rostered =
      (options.applyRotations ?? true)
        ? await rotationSupervisorsFor(tx, row.location, row.scheduledStart, row.scheduledEnd)
        : [];
    const supervisorIds = [...new Set([...parsed.supervisorIds, ...rostered])];

    await replaceSupervisors(tx, row.id, supervisorIds);
    return { ...row, supervisorIds };
  });
}

export async function patchSession(
  db: Database,
  id: string,
  patch: PatchSessionInput,
): Promise<SessionWithSupervisors | null> {
  const parsed = patchSessionInputSchema.parse(patch);
  const { supervisorIds, ...fields } = parsed;

  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(sessions).where(eq(sessions.id, id));
    if (!existing) {
      return null;
    }

    const merged = {
      scheduledStart: fields.scheduledStart ?? existing.scheduledStart,
      scheduledEnd: fields.scheduledEnd ?? existing.scheduledEnd,
    };
    if (merged.scheduledEnd <= merged.scheduledStart) {
      throw new SessionError('scheduledEnd must be after scheduledStart');
    }

    if (Object.keys(fields).length > 0) {
      await tx.update(sessions).set(fields).where(eq(sessions.id, id));
    }
    if (supervisorIds) {
      await replaceSupervisors(tx, id, supervisorIds);
    }

    const [row] = await tx.select().from(sessions).where(eq(sessions.id, id));
    return { ...row!, supervisorIds: await supervisorIdsFor(tx, id) };
  });
}

export async function getSession(db: Database, id: string): Promise<SessionWithSupervisors | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id));
  if (!row) {
    return null;
  }
  return { ...row, supervisorIds: await supervisorIdsFor(db, id) };
}

export type ListSessionsFilter = {
  readonly status?: 'scheduled' | 'active' | 'closed';
  /** Only sessions this supervisor is assigned to. */
  readonly assignedSupervisorId?: string;
  /** Only sessions sponsored by this partner. */
  readonly sponsorPartnerId?: string;
};

export async function listSessions(
  db: Database,
  filter: ListSessionsFilter = {},
): Promise<SessionRecord[]> {
  const conditions = [];
  if (filter.status) {
    conditions.push(eq(sessions.status, filter.status));
  }
  if (filter.sponsorPartnerId) {
    conditions.push(eq(sessions.sponsorPartnerId, filter.sponsorPartnerId));
  }
  if (filter.assignedSupervisorId) {
    const assigned = db
      .select({ sessionId: sessionSupervisors.sessionId })
      .from(sessionSupervisors)
      .where(eq(sessionSupervisors.supervisorId, filter.assignedSupervisorId));
    conditions.push(inArray(sessions.id, assigned));
  }

  return db
    .select()
    .from(sessions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(sessions.scheduledStart));
}

/**
 * The one session a supervisor may act in **right now** (
 * FR-6.1): they are assigned to it, its `status` is `active`, and `now` is
 * within `[scheduledStart, scheduledEnd)`. Null when there is none — the
 * caller (an API route, later the weigh flow) then refuses the action for a
 * plain `supervisor`. The window end is exclusive, matching `rateActiveAt`.
 */
export async function currentSessionForSupervisor(
  db: Database,
  supervisorId: string,
  now: Date = new Date(),
): Promise<SessionWithSupervisors | null> {
  const rows = await db
    .select({ session: sessions })
    .from(sessions)
    .innerJoin(sessionSupervisors, eq(sessionSupervisors.sessionId, sessions.id))
    .where(
      and(
        eq(sessionSupervisors.supervisorId, supervisorId),
        eq(sessions.status, 'active'),
        lte(sessions.scheduledStart, now),
        gt(sessions.scheduledEnd, now),
      ),
    )
    .orderBy(desc(sessions.scheduledStart))
    .limit(1);

  const row = rows[0]?.session;
  if (!row) {
    return null;
  }
  return { ...row, supervisorIds: await supervisorIdsFor(db, row.id) };
}

/**
 * Enforce M2-7 for a write a `supervisor` performs in the PWA. `hub_lead` and
 * `admin` are not shift-bound and pass through. Returns the active session
 * (or null for the non-shift-bound roles) so a caller can record its id.
 * @throws {NoActiveSessionError} a `supervisor` with no session to act in now.
 */
export async function requireActiveSession(
  db: Database,
  actor: { readonly id: string; readonly role: string },
  now: Date = new Date(),
): Promise<SessionWithSupervisors | null> {
  if (actor.role !== 'supervisor') {
    return null;
  }
  const session = await currentSessionForSupervisor(db, actor.id, now);
  if (!session) {
    throw new NoActiveSessionError();
  }
  return session;
}
