// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';
import {
  createRotation,
  createRotationInputSchema,
  deleteRotation,
  listRotations,
  rotationSupervisorsFor,
} from './index';

describe('createRotationInputSchema (no DB)', () => {
  it('requires windowEnd after windowStart', () => {
    expect(() =>
      createRotationInputSchema.parse({
        supervisorId: '11111111-1111-4111-8111-111111111111',
        location: 'Kibera Hub',
        windowStart: '2026-06-10T08:00:00Z',
        windowEnd: '2026-06-10T07:00:00Z',
      }),
    ).toThrow();
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('lib/rotations (integration)', () => {
  const db = hasDatabase ? getDb() : undefined!;

  beforeEach(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisor_rotations, supervisors restart identity cascade`,
    );
  });
  afterAll(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisor_rotations, supervisors restart identity cascade`,
    );
  });

  async function makeSupervisor(name: string): Promise<string> {
    const [row] = await db
      .insert(supervisors)
      .values({ name, phone: `+2547${Math.floor(Math.random() * 1e8)}`, passwordHash: 'x:y' })
      .returning({ id: supervisors.id });
    return row!.id;
  }

  it('create / list (with supervisor name) / delete', async () => {
    const sup = await makeSupervisor('Brian');
    const created = await createRotation(db, {
      supervisorId: sup,
      location: 'Kibera Hub',
      windowStart: new Date('2026-06-01T00:00:00Z'),
      windowEnd: new Date('2026-06-30T00:00:00Z'),
    });

    const listed = await listRotations(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.supervisorName).toBe('Brian');
    expect(listed[0]?.location).toBe('Kibera Hub');

    expect(await deleteRotation(db, created.id)).toBe(true);
    expect(await deleteRotation(db, created.id)).toBe(false);
    expect(await listRotations(db)).toHaveLength(0);
  });

  it('rotationSupervisorsFor: exact location, window overlap, distinct', async () => {
    const brian = await makeSupervisor('Brian');
    const chris = await makeSupervisor('Chris');
    const dana = await makeSupervisor('Dana');

    // Brian covers Kibera all June (two overlapping rows — should de-dupe).
    await createRotation(db, {
      supervisorId: brian,
      location: 'Kibera Hub',
      windowStart: new Date('2026-06-01T00:00:00Z'),
      windowEnd: new Date('2026-06-15T00:00:00Z'),
    });
    await createRotation(db, {
      supervisorId: brian,
      location: 'Kibera Hub',
      windowStart: new Date('2026-06-14T00:00:00Z'),
      windowEnd: new Date('2026-06-30T00:00:00Z'),
    });
    // Chris covers Kibera only early June.
    await createRotation(db, {
      supervisorId: chris,
      location: 'Kibera Hub',
      windowStart: new Date('2026-06-01T00:00:00Z'),
      windowEnd: new Date('2026-06-05T00:00:00Z'),
    });
    // Dana covers a different location.
    await createRotation(db, {
      supervisorId: dana,
      location: 'Mathare Yard',
      windowStart: new Date('2026-06-01T00:00:00Z'),
      windowEnd: new Date('2026-06-30T00:00:00Z'),
    });

    const midJune = await rotationSupervisorsFor(
      db,
      'Kibera Hub',
      new Date('2026-06-20T08:00:00Z'),
      new Date('2026-06-20T14:00:00Z'),
    );
    expect(midJune.sort()).toEqual([brian].sort());

    const earlyJune = await rotationSupervisorsFor(
      db,
      'Kibera Hub',
      new Date('2026-06-03T08:00:00Z'),
      new Date('2026-06-03T14:00:00Z'),
    );
    expect(earlyJune.sort()).toEqual([brian, chris].sort());

    // touching only the boundary (rotation.end === session.start) does not count
    const atBoundary = await rotationSupervisorsFor(
      db,
      'Kibera Hub',
      new Date('2026-06-05T00:00:00Z'),
      new Date('2026-06-05T06:00:00Z'),
    );
    expect(atBoundary).toEqual([brian]);

    const other = await rotationSupervisorsFor(
      db,
      'Mathare Yard',
      new Date('2026-06-10T08:00:00Z'),
      new Date('2026-06-10T14:00:00Z'),
    );
    expect(other).toEqual([dana]);
  });
});
