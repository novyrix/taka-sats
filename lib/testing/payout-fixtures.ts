// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Fixtures for the payout test suites (lib/payouts, the payout routes). Tests only — never
 * imported by application code. Real rows, so callers need a migrated `DATABASE_URL`.
 */

import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  collectionEvents,
  collectorPaymentDestinations,
  exchangeRateSnapshots,
  materialRates,
  sessions,
  sessionSupervisors,
} from '@/lib/db/schema';
import { appendEntry } from '@/lib/ledger';
import { createCollector, createStaff } from './fixtures';

/** The clock the suites pass to `processPayout`; snapshots are seeded relative to it. */
export const NOW = new Date('2026-06-10T10:00:00.000Z');
export const DESTINATION_ADDRESS = 'amina@wallet.example';

export const PAYOUT_TRUNCATE = sql`truncate payouts, anomaly_flags, collection_events, collector_payment_destinations, collector_authorizations, tag_history, collectors, ledger_entries, session_supervisors, sessions, supervisors, material_rates, exchange_rate_snapshots restart identity cascade`;

export type PayoutWorld = {
  readonly recorderId: string;
  readonly otherSupervisorId: string;
  readonly hubLeadId: string;
  readonly adminId: string;
  readonly collectorId: string;
  readonly destinationId: string;
  readonly sessionId: string;
  readonly rateId: string;
};

/**
 * One programme: a recording supervisor, another supervisor, a hub lead and an admin; an
 * active collector with a VERIFIED destination; an active session; a PET rate of 2000 minor
 * per kg; and a fresh BTC snapshot of KES 5,000,000. So 2.5 kg = 5000 minor = 1000 sats.
 */
export async function seedPayoutWorld(db: Database): Promise<PayoutWorld> {
  await db.execute(PAYOUT_TRUNCATE);
  const recorder = await createStaff(db, 'supervisor', 'Brian');
  const other = await createStaff(db, 'supervisor', 'Other');
  const hubLead = await createStaff(db, 'hub_lead', 'Hub');
  const admin = await createStaff(db, 'admin', 'Admin');
  const collector = await createCollector(db);

  const [destination] = await db
    .insert(collectorPaymentDestinations)
    .values({
      collectorId: collector.id,
      type: 'lightning_address',
      address: DESTINATION_ADDRESS,
      status: 'verified',
      verifiedAt: NOW,
      createdBy: recorder.id,
    })
    .returning({ id: collectorPaymentDestinations.id });
  const [rate] = await db
    .insert(materialRates)
    .values({
      material: 'PET',
      rateFiatMinor: 2000,
      fiatCurrency: 'KES',
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    })
    .returning({ id: materialRates.id });
  await seedSnapshot(db, new Date(NOW.getTime() - 60_000));
  const [session] = await db
    .insert(sessions)
    .values({
      location: 'Hub',
      status: 'active',
      scheduledStart: new Date('2026-06-10T08:00:00Z'),
      scheduledEnd: new Date('2026-06-10T14:00:00Z'),
    })
    .returning({ id: sessions.id });
  if (!destination || !rate || !session) {
    throw new Error('seedPayoutWorld: an insert returned no row');
  }
  await db.insert(sessionSupervisors).values([
    { sessionId: session.id, supervisorId: recorder.id },
    { sessionId: session.id, supervisorId: other.id },
  ]);

  return {
    recorderId: recorder.id,
    otherSupervisorId: other.id,
    hubLeadId: hubLead.id,
    adminId: admin.id,
    collectorId: collector.id,
    destinationId: destination.id,
    sessionId: session.id,
    rateId: rate.id,
  };
}

/** A BTC/KES snapshot of KES 5,000,000 per BTC, observed at `fetchedAt`. */
export async function seedSnapshot(
  db: Database,
  fetchedAt: Date,
  rate = '5000000',
): Promise<string> {
  const [row] = await db
    .insert(exchangeRateSnapshots)
    .values({
      base: 'BTC',
      quote: 'KES',
      rate,
      sources: [{ source: 'test', rate: Number(rate) }],
      fetchedAt,
    })
    .returning({ id: exchangeRateSnapshots.id });
  if (!row) {
    throw new Error('seedSnapshot: insert returned no row');
  }
  return row.id;
}

/** A confirmed collection event (ledger entry + detail row), as sync ingest would leave it. */
export async function seedCollectionEvent(
  db: Database,
  world: PayoutWorld,
  overrides: {
    readonly weightKg?: string;
    readonly supervisorId?: string;
    readonly collectorId?: string;
    readonly rateId?: string;
  } = {},
): Promise<string> {
  const entry = await appendEntry(db, {
    entryType: 'collection_event',
    payloadHash: randomBytes(32).toString('hex'),
  });
  const [event] = await db
    .insert(collectionEvents)
    .values({
      id: entry.id,
      ledgerEntryId: entry.id,
      collectorId: overrides.collectorId ?? world.collectorId,
      supervisorId: overrides.supervisorId ?? world.recorderId,
      sessionId: world.sessionId,
      material: 'PET',
      weightKg: overrides.weightKg ?? '2.5',
      rateId: overrides.rateId ?? world.rateId,
      indicativeSats: 1000,
      photoSha256: 'a'.repeat(64),
      gpsUnavailableReason: 'test',
      recordedAt: new Date(NOW.getTime() - 3_600_000),
    })
    .returning({ id: collectionEvents.id });
  if (!event) {
    throw new Error('seedCollectionEvent: insert returned no row');
  }
  return event.id;
}
