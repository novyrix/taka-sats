// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Fixtures for the fraud / reconciliation suites. Tests only — never imported by application
 * code. They insert rows directly (as sync ingest would have left them) so a test controls
 * every field a detector looks at. Callers need a migrated `DATABASE_URL`.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import type { Database } from '@/lib/db/client';
import { collectionEvents, payouts } from '@/lib/db/schema';
import { appendEntry } from '@/lib/ledger';
import { NOW, type PayoutWorld, seedSnapshot } from './payout-fixtures';

export type SeedEventOptions = {
  readonly weightKg?: string;
  readonly material?: string;
  readonly supervisorId?: string;
  readonly collectorId?: string;
  readonly photoSha256?: string;
  readonly recordedAt?: Date;
  readonly gps?: { readonly lat: number; readonly lng: number };
};

let counter = 0;

/** A confirmed collection event (ledger entry + detail row). Each gets a distinct photo hash unless given. */
export async function seedEvent(
  db: Database,
  world: PayoutWorld,
  options: SeedEventOptions = {},
): Promise<string> {
  const id = randomUUID();
  const entry = await appendEntry(db, {
    entryType: 'collection_event',
    id,
    payloadHash: randomBytes(32).toString('hex'),
  });
  counter += 1;
  await db.insert(collectionEvents).values({
    id,
    ledgerEntryId: entry.id,
    collectorId: options.collectorId ?? world.collectorId,
    supervisorId: options.supervisorId ?? world.recorderId,
    sessionId: world.sessionId,
    material: options.material ?? 'PET',
    weightKg: options.weightKg ?? '2.5',
    rateId: world.rateId,
    indicativeSats: 1000,
    photoSha256: options.photoSha256 ?? counter.toString(16).padStart(64, '0'),
    ...(options.gps
      ? { gpsLat: String(options.gps.lat), gpsLng: String(options.gps.lng), gpsAccuracyM: '8' }
      : { gpsUnavailableReason: 'test' }),
    recordedAt: options.recordedAt ?? new Date(NOW.getTime() - 3_600_000),
  });
  return id;
}

/** Mark an event's payout as `paid` for `sats` (a valid `paid` row, as `processPayout` leaves it). */
export async function seedPaidPayout(
  db: Database,
  eventId: string,
  collectorId: string,
  sats: number,
): Promise<void> {
  const entry = await appendEntry(db, {
    entryType: 'payout',
    payloadHash: randomBytes(32).toString('hex'),
  });
  await db.insert(payouts).values({
    collectionEventId: eventId,
    collectorId,
    ledgerEntryId: entry.id,
    amountSats: sats,
    amountFiatMinor: sats * 5,
    fiatCurrency: 'KES',
    exchangeSnapshotId: await seedSnapshot(db, NOW),
    status: 'paid',
    provider: 'fake',
    providerPaymentRef: `ref-${eventId}`,
    settledAt: NOW,
  });
}
