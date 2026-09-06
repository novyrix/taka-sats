// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Standing supervisor→location rotations (FR-3.7, FR-6.1, ROADMAP M2-8). A
 * rotation says "this supervisor covers this location for this window". When
 * a session is created for a location whose window overlaps a rotation, the
 * rostered supervisor is auto-assigned — see `rotationSupervisorsFor`, which
 * `lib/sessions.createSession` calls. Framework-free apart from Drizzle (D-04).
 */

import { and, asc, eq, gt, type InferSelectModel, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Database, Queryable } from '@/lib/db/client';
import { supervisorRotations, supervisors } from '@/lib/db/schema';

export type RotationRecord = InferSelectModel<typeof supervisorRotations>;
/** A rotation row joined with the supervisor's display name, for the admin list. */
export type RotationWithName = RotationRecord & { readonly supervisorName: string };

export class RotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RotationError';
  }
}

export const createRotationInputSchema = z
  .object({
    supervisorId: z.uuid(),
    location: z.string().trim().min(1).max(200),
    windowStart: z.coerce.date(),
    windowEnd: z.coerce.date(),
  })
  .refine((v) => v.windowEnd > v.windowStart, {
    message: 'windowEnd must be after windowStart',
    path: ['windowEnd'],
  });
export type CreateRotationInput = z.infer<typeof createRotationInputSchema>;

export async function listRotations(db: Database): Promise<RotationWithName[]> {
  const rows = await db
    .select({
      id: supervisorRotations.id,
      supervisorId: supervisorRotations.supervisorId,
      location: supervisorRotations.location,
      windowStart: supervisorRotations.windowStart,
      windowEnd: supervisorRotations.windowEnd,
      supervisorName: supervisors.name,
    })
    .from(supervisorRotations)
    .innerJoin(supervisors, eq(supervisors.id, supervisorRotations.supervisorId))
    .orderBy(asc(supervisorRotations.windowStart), asc(supervisors.name));
  return rows;
}

export async function createRotation(
  db: Database,
  input: CreateRotationInput,
): Promise<RotationRecord> {
  const parsed = createRotationInputSchema.parse(input);
  const [row] = await db
    .insert(supervisorRotations)
    .values({
      supervisorId: parsed.supervisorId,
      location: parsed.location,
      windowStart: parsed.windowStart,
      windowEnd: parsed.windowEnd,
    })
    .returning();
  if (!row) {
    throw new RotationError('createRotation: insert returned no row');
  }
  return row;
}

/** @returns true if a row was deleted. */
export async function deleteRotation(db: Database, id: string): Promise<boolean> {
  const deleted = await db
    .delete(supervisorRotations)
    .where(eq(supervisorRotations.id, id))
    .returning({ id: supervisorRotations.id });
  return deleted.length > 0;
}

/**
 * The supervisor ids rostered for `location` over `[start, end)`. A rotation
 * counts when its window **overlaps** the session window at all
 * (`rotation.start < session.end` AND `rotation.end > session.start`) — the
 * rostered supervisor covers any session that touches their shift. Location
 * match is exact (same string the session stores).
 */
export async function rotationSupervisorsFor(
  db: Queryable,
  location: string,
  start: Date,
  end: Date,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ supervisorId: supervisorRotations.supervisorId })
    .from(supervisorRotations)
    .where(
      and(
        eq(supervisorRotations.location, location),
        lt(supervisorRotations.windowStart, end),
        gt(supervisorRotations.windowEnd, start),
      ),
    );
  return rows.map((r) => r.supervisorId);
}
