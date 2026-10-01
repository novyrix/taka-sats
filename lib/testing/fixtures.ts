// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared fixtures for the database-backed test suites. Tests only — never
 * imported by application code. Each helper inserts real rows, so callers need a
 * migrated `DATABASE_URL` (their suites are `describe.skipIf(!hasDatabase)`).
 */

import { sql } from 'drizzle-orm';
import type { Role } from '@/lib/auth/permissions';
import type { CollectorRecord } from '@/lib/collectors/types';
import type { Database } from '@/lib/db/client';
import { collectors, supervisors } from '@/lib/db/schema';

let counter = 0;

export type StaffFixture = { readonly id: string; readonly role: Exclude<Role, 'partner'> };

/** Insert a staff member (a `supervisor`, `hub_lead` or `admin`) to act as an actor. */
export async function createStaff(
  db: Database,
  role: StaffFixture['role'] = 'supervisor',
  name = `${role} ${(counter += 1)}`,
): Promise<StaffFixture> {
  const [row] = await db
    .insert(supervisors)
    .values({
      name,
      phone: `+2547${String(Date.now()).slice(-6)}${String((counter += 1)).padStart(3, '0')}`,
      passwordHash: 'x:y',
      role,
    })
    .returning({ id: supervisors.id });
  if (!row) {
    throw new Error('createStaff: insert returned no row');
  }
  return { id: row.id, role };
}

/** Insert an `active` (authorized) collector with a unique public code. Override anything. */
export async function createCollector(
  db: Database,
  overrides: Partial<typeof collectors.$inferInsert> = {},
): Promise<CollectorRecord> {
  const [row] = await db
    .insert(collectors)
    .values({
      alias: 'Amina',
      addressSource: 'byo',
      status: 'active',
      publicCode: `TS-${String((counter += 1)).padStart(4, '0')}`,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error('createCollector: insert returned no row');
  }
  return row;
}

/** Empty every table the collector domain touches and restart the public-code sequence. */
export async function resetCollectorTables(db: Database): Promise<void> {
  await db.execute(
    sql`truncate table anomaly_flags, tag_history, collector_payment_destinations, collector_authorizations, collection_events, collectors, ledger_entries, supervisors restart identity cascade`,
  );
  await db.execute(sql`alter sequence collector_public_code_seq restart with 1`);
}
