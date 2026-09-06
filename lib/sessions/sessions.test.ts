// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';
import { createRotation } from '@/lib/rotations';
import {
  createSession,
  createSessionInputSchema,
  currentSessionForSupervisor,
  getSession,
  listSessions,
  NoActiveSessionError,
  patchSession,
  requireActiveSession,
} from './index';

describe('createSessionInputSchema (no DB)', () => {
  it('requires end after start', () => {
    expect(() =>
      createSessionInputSchema.parse({
        location: 'Soweto West',
        scheduledStart: '2026-06-01T08:00:00Z',
        scheduledEnd: '2026-06-01T07:00:00Z',
      }),
    ).toThrow();
  });

  it('validates a geoBounds polygon shape', () => {
    const ok = createSessionInputSchema.parse({
      location: 'X',
      scheduledStart: '2026-06-01T08:00:00Z',
      scheduledEnd: '2026-06-01T12:00:00Z',
      geoBounds: {
        type: 'Polygon',
        coordinates: [
          [
            [36.8, -1.3],
            [36.9, -1.3],
            [36.9, -1.2],
          ],
        ],
      },
    });
    expect(ok.geoBounds?.type).toBe('Polygon');
    expect(() =>
      createSessionInputSchema.parse({
        location: 'X',
        scheduledStart: '2026-06-01T08:00:00Z',
        scheduledEnd: '2026-06-01T12:00:00Z',
        geoBounds: { type: 'Circle', coordinates: [] },
      }),
    ).toThrow();
  });
});

const hasDatabase = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDatabase)('lib/sessions (integration)', () => {
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

  it('creates a session with assigned supervisors and reads them back', async () => {
    const s1 = await makeSupervisor('Brian');
    const s2 = await makeSupervisor('Chris');
    const created = await createSession(db, {
      location: 'Soweto West',
      scheduledStart: new Date('2026-06-01T08:00:00Z'),
      scheduledEnd: new Date('2026-06-01T14:00:00Z'),
      supervisorIds: [s1, s2, s1], // dup ignored
    });
    expect(created.status).toBe('scheduled');
    expect(created.supervisorIds.sort()).toEqual([s1, s2].sort());

    const fetched = await getSession(db, created.id);
    expect(fetched?.supervisorIds.sort()).toEqual([s1, s2].sort());
  });

  it('createSession unions explicit supervisors with anyone rostered by a rotation (M2-8)', async () => {
    const explicit = await makeSupervisor('Ada');
    const rostered = await makeSupervisor('Brian');
    await createRotation(db, {
      supervisorId: rostered,
      location: 'Kibera Hub',
      windowStart: new Date('2026-06-01T00:00:00Z'),
      windowEnd: new Date('2026-06-30T00:00:00Z'),
    });

    const created = await createSession(db, {
      location: 'Kibera Hub',
      scheduledStart: new Date('2026-06-10T08:00:00Z'),
      scheduledEnd: new Date('2026-06-10T14:00:00Z'),
      supervisorIds: [explicit],
    });
    expect(created.supervisorIds.sort()).toEqual([explicit, rostered].sort());

    // applyRotations:false keeps only the explicit list
    const opted = await createSession(
      db,
      {
        location: 'Kibera Hub',
        scheduledStart: new Date('2026-06-11T08:00:00Z'),
        scheduledEnd: new Date('2026-06-11T14:00:00Z'),
        supervisorIds: [explicit],
      },
      { applyRotations: false },
    );
    expect(opted.supervisorIds).toEqual([explicit]);

    // a different location gets nobody from the rotation
    const elsewhere = await createSession(db, {
      location: 'Mathare Yard',
      scheduledStart: new Date('2026-06-10T08:00:00Z'),
      scheduledEnd: new Date('2026-06-10T14:00:00Z'),
      supervisorIds: [],
    });
    expect(elsewhere.supervisorIds).toEqual([]);
  });

  it('patches fields and replaces the supervisor set', async () => {
    const s1 = await makeSupervisor('Brian');
    const s2 = await makeSupervisor('Chris');
    const created = await createSession(db, {
      location: 'A',
      scheduledStart: new Date('2026-06-01T08:00:00Z'),
      scheduledEnd: new Date('2026-06-01T14:00:00Z'),
      supervisorIds: [s1],
    });

    const patched = await patchSession(db, created.id, {
      status: 'active',
      location: 'B',
      supervisorIds: [s2],
    });
    expect(patched?.status).toBe('active');
    expect(patched?.location).toBe('B');
    expect(patched?.supervisorIds).toEqual([s2]);
  });

  it('lists by assigned supervisor', async () => {
    const s1 = await makeSupervisor('Brian');
    const s2 = await makeSupervisor('Chris');
    const mine = await createSession(db, {
      location: 'Mine',
      scheduledStart: new Date('2026-06-02T08:00:00Z'),
      scheduledEnd: new Date('2026-06-02T14:00:00Z'),
      supervisorIds: [s1],
    });
    await createSession(db, {
      location: 'Theirs',
      scheduledStart: new Date('2026-06-03T08:00:00Z'),
      scheduledEnd: new Date('2026-06-03T14:00:00Z'),
      supervisorIds: [s2],
    });

    const forS1 = await listSessions(db, { assignedSupervisorId: s1 });
    expect(forS1.map((s) => s.id)).toEqual([mine.id]);
  });

  it('patchSession returns null for an unknown id', async () => {
    expect(
      await patchSession(db, '00000000-0000-0000-0000-000000000000', { status: 'closed' }),
    ).toBeNull();
  });

  describe('currentSessionForSupervisor / requireActiveSession (M2-7)', () => {
    const now = new Date('2026-06-10T10:00:00Z');
    const openWindow = {
      scheduledStart: new Date('2026-06-10T08:00:00Z'),
      scheduledEnd: new Date('2026-06-10T14:00:00Z'),
    };

    it('returns the assigned session only when active and in-window', async () => {
      const sup = await makeSupervisor('Brian');

      // assigned but still 'scheduled' → not yet
      const s = await createSession(db, { location: 'Hub', ...openWindow, supervisorIds: [sup] });
      expect(await currentSessionForSupervisor(db, sup, now)).toBeNull();

      // now active and in-window → yes
      await patchSession(db, s.id, { status: 'active' });
      expect((await currentSessionForSupervisor(db, sup, now))?.id).toBe(s.id);

      // active but `now` past the end → no
      const after = new Date('2026-06-10T15:00:00Z');
      expect(await currentSessionForSupervisor(db, sup, after)).toBeNull();
    });

    it('a different supervisor, or an unassigned one, gets nothing', async () => {
      const sup = await makeSupervisor('Brian');
      const other = await makeSupervisor('Chris');
      const s = await createSession(db, { location: 'Hub', ...openWindow, supervisorIds: [sup] });
      await patchSession(db, s.id, { status: 'active' });

      expect(await currentSessionForSupervisor(db, other, now)).toBeNull();
    });

    it('requireActiveSession: throws for a shift-less supervisor, passes others through', async () => {
      const sup = await makeSupervisor('Brian');

      await expect(
        requireActiveSession(db, { id: sup, role: 'supervisor' }, now),
      ).rejects.toBeInstanceOf(NoActiveSessionError);

      // hub_lead / admin are not shift-bound
      expect(await requireActiveSession(db, { id: sup, role: 'admin' }, now)).toBeNull();

      const s = await createSession(db, { location: 'Hub', ...openWindow, supervisorIds: [sup] });
      await patchSession(db, s.id, { status: 'active' });
      expect((await requireActiveSession(db, { id: sup, role: 'supervisor' }, now))?.id).toBe(s.id);
    });
  });
});
