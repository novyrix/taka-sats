// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Seeds the DB for the e2e suites (M3-11). Idempotent: it truncates the
 * tables it owns and re-inserts a known field supervisor + an active session
 * assigned to them + one collector + a rate + an exchange snapshot — exactly
 * what `GET /api/v1/weigh/bootstrap` needs. Credentials are in `e2e/fixtures`.
 */

import { sql } from 'drizzle-orm';
import { hashPassword } from '@/lib/auth/password';
import { closeDb, getDb } from '@/lib/db/client';
import {
  collectors,
  exchangeRateSnapshots,
  materialRates,
  sessions,
  sessionSupervisors,
  supervisors,
} from '@/lib/db/schema';
import { ADMINS, FIELD_SUPERVISOR, HUB_LEAD, STORY_SUPERVISOR } from './fixtures/accounts';

export default async function globalSetup(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('e2e: DATABASE_URL must be set (Playwright global-setup)');
  }

  const db = getDb();
  try {
    await db.execute(
      sql`truncate table payouts, anomaly_flags, collection_events, collector_payment_destinations, collector_authorizations, tag_history, treasury_topup_signoffs, treasury_topups, ledger_entries, session_supervisors, sessions, supervisors, collectors, material_rates, exchange_rate_snapshots restart identity cascade`,
    );

    const [sup] = await db
      .insert(supervisors)
      .values({
        name: FIELD_SUPERVISOR.name,
        phone: FIELD_SUPERVISOR.phone,
        role: 'supervisor',
        passwordHash: await hashPassword(FIELD_SUPERVISOR.password),
      })
      .returning({ id: supervisors.id });

    // The people of the full-story and treasury specs: three admins, a hub lead, a second supervisor.
    const others = [
      ...ADMINS.map((a) => ({ ...a, role: 'admin' as const })),
      { ...HUB_LEAD, role: 'hub_lead' as const },
      { ...STORY_SUPERVISOR, role: 'supervisor' as const },
    ];
    for (const person of others) {
      await db.insert(supervisors).values({
        name: person.name,
        phone: person.phone,
        role: person.role,
        passwordHash: await hashPassword(person.password),
      });
    }

    await db.insert(materialRates).values({
      material: 'PET',
      rateFiatMinor: 2000,
      fiatCurrency: 'KES',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    });

    await db.insert(exchangeRateSnapshots).values({
      base: 'BTC',
      quote: 'KES',
      rate: '5000000',
      sources: [{ source: 'e2e', rate: 5_000_000 }],
      fetchedAt: new Date(),
    });

    await db.insert(collectors).values({
      alias: 'Amina E2E',
      addressSource: 'byo',
      // Not the shape the code sequence produces: other suites restart that sequence at 1, and a
      // collision with a collector registered during the run would fail its enrolment.
      publicCode: 'TS-E2E-0001',
      status: 'active',
    });

    const [session] = await db
      .insert(sessions)
      .values({
        location: 'E2E Hub',
        status: 'active',
        scheduledStart: new Date(Date.now() - 3_600_000),
        scheduledEnd: new Date(Date.now() + 6 * 3_600_000),
      })
      .returning({ id: sessions.id });

    await db.insert(sessionSupervisors).values({ sessionId: session!.id, supervisorId: sup!.id });
  } finally {
    await closeDb();
  }
}
