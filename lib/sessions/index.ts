// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Collection sessions (FR-8.1, FR-6.1, ROADMAP M2-5). A session is a place +
 * time window with assigned supervisors, an optional geo polygon, and an
 * optional sponsoring partner. Only `admin` writes (enforced at the API
 * layer); reads are scoped there too. Framework-free apart from Drizzle (D-04).
 */

import { and, desc, eq, type InferSelectModel, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Queryable } from '@/lib/db/client';
import { sessions, sessionSupervisors } from '@/lib/db/schema';

export type SessionRecord = InferSelectModel<typeof sessions>;
export type SessionWithSupervisors = SessionRecord & { readonly supervisorIds: string[] };

export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
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

export async function createSession(
  db: Database,
  input: CreateSessionInput,
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
    await replaceSupervisors(tx, row.id, parsed.supervisorIds);
    return { ...row, supervisorIds: [...new Set(parsed.supervisorIds)] };
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
