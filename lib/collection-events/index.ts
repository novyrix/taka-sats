// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sync ingest for offline-recorded collection events (FR-4.2, REQUIREMENTS
 * §10.3, ROADMAP M4-3). Each event carries its client UUID + `content_hash`.
 * For each one, in submitted order:
 *
 *   - idempotent by `id` — a resent, already-ingested event returns its stored
 *     `{ status: 'confirmed', seq }`, no duplicate;
 *   - validated: the `content_hash` recomputes from the same canonical shape
 *     the PWA used; the `rate_id` is the rate active at `recorded_at`; the
 *     supervisor is assigned to the session; weight & GPS are in sane bounds;
 *   - on success: `lib/ledger.appendEntryTx` writes the canonical
 *     `ledger_entries` row and a `collection_events` detail row is linked to
 *     it, atomically;
 *   - on failure: `{ status: 'needs_attention', reason }` — never a silent drop.
 *
 * Framework-free apart from Drizzle (D-04); server only.
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/lib/db/client';
import { isUniqueViolation } from '@/lib/db/pg-errors';
import { collectionEvents, ledgerEntries, sessionSupervisors } from '@/lib/db/schema';
import { appendEntryTx } from '@/lib/ledger';
import { rateActiveAt } from '@/lib/rates';
import { photoUrlFor } from '@/lib/storage';
import { contentHash } from '@/lib/sync/contentHash';
import { collectionEventPayload } from '@/lib/sync/events';

/** A weighed collection over ~this many kg is almost certainly a mis-key. */
export const MAX_WEIGHT_KG = 2000;

const geoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('fix'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracyM: z.number().nonnegative(),
  }),
  z.object({ kind: z.literal('unavailable'), reason: z.string().trim().min(1) }),
]);

export const syncEventInputSchema = z.object({
  id: z.uuid(),
  collectorId: z.uuid(),
  supervisorId: z.uuid(),
  sessionId: z.uuid(),
  material: z.string().trim().min(1).max(64),
  weightKg: z.number().positive().max(MAX_WEIGHT_KG),
  rateId: z.uuid(),
  rateFiatMinor: z.number().int().nonnegative(),
  exchangeRate: z.number().positive(),
  indicativeSats: z.number().int().nonnegative(),
  photoSha256: z.string().regex(/^[0-9a-f]{64}$/),
  geo: geoSchema,
  registrationType: z.enum(['tap', 'walk_in', 'pending_self_serve']),
  /** The exact ISO string the device hashed. */
  recordedAt: z.string().min(20),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SyncEventInput = z.infer<typeof syncEventInputSchema>;

export const syncEventsBodySchema = z.object({
  events: z.array(syncEventInputSchema).min(1).max(200),
});

export type SyncResult =
  | { readonly id: string; readonly status: 'confirmed'; readonly seq: number }
  | { readonly id: string; readonly status: 'needs_attention'; readonly reason: string };

const attention = (id: string, reason: string): SyncResult => ({
  id,
  status: 'needs_attention',
  reason,
});

/** The stored result for an already-ingested id, or null. */
async function existingResult(db: Database, id: string): Promise<SyncResult | null> {
  const [row] = await db
    .select({ seq: ledgerEntries.seq })
    .from(collectionEvents)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, collectionEvents.ledgerEntryId))
    .where(eq(collectionEvents.id, id));
  return row ? { id, status: 'confirmed', seq: row.seq } : null;
}

export async function ingestCollectionEvent(
  db: Database,
  input: SyncEventInput,
): Promise<SyncResult> {
  const prior = await existingResult(db, input.id);
  if (prior) {
    return prior;
  }

  // 1. The record must be the one the device hashed.
  const recomputed = await contentHash(
    collectionEventPayload({
      id: input.id as never,
      collectorId: input.collectorId,
      supervisorId: input.supervisorId,
      sessionId: input.sessionId,
      material: input.material,
      weightKg: input.weightKg,
      rateId: input.rateId,
      rateFiatMinor: input.rateFiatMinor,
      exchangeRate: input.exchangeRate,
      indicativeSats: input.indicativeSats,
      photoSha256: input.photoSha256,
      geo: input.geo,
      registrationType: input.registrationType,
      recordedAt: input.recordedAt as never,
    }),
  );
  if (recomputed !== input.contentHash) {
    return attention(input.id, 'content_hash does not match the submitted fields');
  }

  const recordedAt = new Date(input.recordedAt);
  if (Number.isNaN(recordedAt.getTime())) {
    return attention(input.id, 'recorded_at is not a valid timestamp');
  }

  // 2. The rate must be the one that was active for that material at capture.
  const rate = await rateActiveAt(db, input.material, recordedAt);
  if (!rate) {
    return attention(input.id, `no "${input.material}" rate was active at ${input.recordedAt}`);
  }
  if (rate.id !== input.rateId) {
    return attention(input.id, 'rate_id is not the rate that was active at recorded_at');
  }

  // 3. The supervisor must be assigned to the session (M2-7 at the boundary).
  const [assigned] = await db
    .select({ ok: sessionSupervisors.supervisorId })
    .from(sessionSupervisors)
    .where(
      and(
        eq(sessionSupervisors.sessionId, input.sessionId),
        eq(sessionSupervisors.supervisorId, input.supervisorId),
      ),
    );
  if (!assigned) {
    return attention(input.id, 'supervisor is not assigned to this session');
  }

  // 4. Back-fill the photo URL if the upload queue already delivered it (soft).
  const photoUrl = await photoUrlFor(input.photoSha256).catch(() => null);

  // 5. Ledger entry + detail row, atomic.
  const geoCols =
    input.geo.kind === 'fix'
      ? {
          gpsLat: String(input.geo.lat),
          gpsLng: String(input.geo.lng),
          gpsAccuracyM: String(input.geo.accuracyM),
        }
      : { gpsUnavailableReason: input.geo.reason };

  try {
    return await db.transaction(async (tx) => {
      const entry = await appendEntryTx(tx, {
        entryType: 'collection_event',
        id: input.id,
        payloadHash: input.contentHash,
        deviceRecordedAt: recordedAt,
      });
      await tx.insert(collectionEvents).values({
        id: input.id,
        ledgerEntryId: entry.id,
        collectorId: input.collectorId,
        supervisorId: input.supervisorId,
        sessionId: input.sessionId,
        material: input.material,
        weightKg: String(input.weightKg),
        rateId: input.rateId,
        indicativeSats: input.indicativeSats,
        ...(photoUrl ? { photoUrl } : {}),
        photoSha256: input.photoSha256,
        ...geoCols,
        recordedAt,
        registrationType: input.registrationType,
      });
      return { id: input.id, status: 'confirmed', seq: entry.seq };
    });
  } catch (error) {
    // A concurrent submit of the same id won the race — return its result.
    if (isUniqueViolation(error)) {
      const now = await existingResult(db, input.id);
      if (now) {
        return now;
      }
    }
    throw error;
  }
}

/** Ingest a batch, one result per event in submitted order. Each event is its own transaction. */
export async function ingestCollectionEvents(
  db: Database,
  events: readonly SyncEventInput[],
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const event of events) {
    results.push(await ingestCollectionEvent(db, event));
  }
  return results;
}
