// SPDX-License-Identifier: AGPL-3.0-only

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '@/lib/db/client';
import { supervisors } from '@/lib/db/schema';
import {
  createSession,
  createSessionInputSchema,
  getSession,
  listSessions,
  patchSession,
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
      sql`truncate table session_supervisors, sessions, supervisors restart identity cascade`,
    );
  });
  afterAll(async () => {
    await db.execute(
      sql`truncate table session_supervisors, sessions, supervisors restart identity cascade`,
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
});
