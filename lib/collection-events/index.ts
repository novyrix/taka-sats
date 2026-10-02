// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sync ingest for offline-recorded collection events (FR-4.2, REQUIREMENTS
 * §10.3). Each event carries its client UUID + `content_hash`.
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
 *   - on failure: `{ status: 'needs_attention', reason }` — never a silent drop;
 *   - a confirmed event gets its `payouts` row in the same transaction (M5), and the
 *     optional `onPayoutCreated` hook — fired only AFTER the commit, and never allowed to
 *     fail the result — lets the caller enqueue the payout job;
 *   - after the commit the anomaly detectors run (`lib/fraud`); they only write flags and a
 *     failure there never changes the result.
 *
 * Framework-free apart from Drizzle (D-04); server only.
 */

import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '@/lib/db/client';
import { isUniqueViolation, pgErrorCode } from '@/lib/db/pg-errors';
import {
  collectionEvents,
  collectors,
  ledgerEntries,
  sessions,
  sessionSupervisors,
} from '@/lib/db/schema';
import { getSettings } from '@/lib/config';
import { runEventDetectors } from '@/lib/fraud';
import { appendEntryTx } from '@/lib/ledger';
import { createPayoutForEvent } from '@/lib/payouts';
import { rateActiveAt } from '@/lib/rates';
import { photoUrlFor } from '@/lib/storage';
import { contentHash } from '@/lib/sync/contentHash';
import { collectionEventPayload } from '@/lib/sync/events';
import { WEIGHT_SOURCES } from '@/types/domain';

/**
 * The largest weight one event may carry. It is the capacity of `collection_events.weight_kg`
 * (`numeric(6,3)`, ≤ 999.999) — a value above it would overflow the column, and a collection
 * that heavy is almost certainly a mis-key anyway.
 */
export const MAX_WEIGHT_KG = 999.999;

/** At most 3 decimals (the column's scale): a 4th would be silently rounded, so stored ≠ signed. */
const hasMilliKgPrecision = (kg: number): boolean => Number(kg.toFixed(3)) === kg;

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
  weightKg: z
    .number()
    .positive()
    .max(MAX_WEIGHT_KG)
    .refine(hasMilliKgPrecision, 'weightKg has more than 3 decimals')
    .refine((kg) => kg >= 0.001, 'weightKg is below the 1 g minimum'),
  rateId: z.uuid(),
  rateFiatMinor: z.number().int().nonnegative(),
  exchangeRate: z.number().positive(),
  indicativeSats: z.number().int().nonnegative(),
  photoSha256: z.string().regex(/^[0-9a-f]{64}$/),
  geo: geoSchema,
  registrationType: z.enum(['tap', 'walk_in', 'pending_self_serve']),
  /**
   * Weight provenance (D-27). Optional so an event queued before these fields existed still
   * verifies — they are hashed exactly as received, and absent means `manual`.
   */
  weightSource: z.enum(WEIGHT_SOURCES).optional(),
  scaleId: z.string().trim().min(1).max(64).optional(),
  scaleReadingRaw: z.string().trim().min(1).max(64).optional(),
  /** The exact ISO string the device hashed. */
  recordedAt: z.string().min(20),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type SyncEventInput = z.infer<typeof syncEventInputSchema>;

/**
 * The batch ENVELOPE only. Each event is validated on its own (`parseSyncEvent`), so one
 * malformed event comes back as a `needs_attention` result instead of failing the request —
 * the client retries any non-OK response, so a single bad event would otherwise block every
 * event queued behind it, forever.
 */
export const syncEventsBodySchema = z.object({
  events: z.array(z.unknown()).min(1).max(200),
});

/** Why an event needs a human — a stable code for the UI to translate; `reason` is English detail. */
export type AttentionCode =
  | 'content_hash_mismatch'
  | 'invalid_timestamp'
  | 'collector_not_found'
  | 'collector_not_authorized'
  | 'no_rate'
  | 'rate_mismatch'
  | 'supervisor_not_assigned'
  | 'event_not_yours'
  | 'invalid_event'
  | 'session_not_found'
  | 'outside_session_window'
  | 'future_timestamp'
  | 'invalid_data';

export type SyncResult =
  | { readonly id: string; readonly status: 'confirmed'; readonly seq: number }
  | {
      readonly id: string;
      readonly status: 'needs_attention';
      readonly code: AttentionCode;
      readonly reason: string;
    };

const attention = (id: string, code: AttentionCode, reason: string): SyncResult => ({
  id,
  status: 'needs_attention',
  code,
  reason,
});

/**
 * Validate one raw event from a batch. A malformed event becomes a `needs_attention` result
 * (never an exception, never a failed request); the reason names the field, not its value.
 */
export function parseSyncEvent(
  raw: unknown,
):
  | { readonly ok: true; readonly input: SyncEventInput }
  | { readonly ok: false; readonly result: SyncResult } {
  const parsed = syncEventInputSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, input: parsed.data };
  }
  const claimedId = (raw as { id?: unknown } | null)?.id;
  const id =
    typeof claimedId === 'string' && z.uuid().safeParse(claimedId).success ? claimedId : '';
  const issue = parsed.error.issues[0];
  const where = issue?.path.join('.') || 'event';
  return {
    ok: false,
    result: attention(id, 'invalid_event', `${where}: ${issue?.message ?? 'invalid'}`),
  };
}

/** The rejection for a collector who may not be weighed (D-25), or `null` if they may. */
function collectorGate(id: string, status: string | undefined): SyncResult | null {
  if (status === undefined) {
    return attention(id, 'collector_not_found', 'collector does not exist');
  }
  return status === 'active'
    ? null
    : attention(id, 'collector_not_authorized', `collector is not authorized (status: ${status})`);
}

/** The stored result for an already-ingested id, or null. */
async function existingResult(db: Database, id: string): Promise<SyncResult | null> {
  const [row] = await db
    .select({ seq: ledgerEntries.seq })
    .from(collectionEvents)
    .innerJoin(ledgerEntries, eq(ledgerEntries.id, collectionEvents.ledgerEntryId))
    .where(eq(collectionEvents.id, id));
  return row ? { id, status: 'confirmed', seq: row.seq } : null;
}

/** Called with the new payout's id once its event is committed (e.g. to enqueue the payout job). */
export type OnPayoutCreated = (payoutId: string) => Promise<void>;

export async function ingestCollectionEvent(
  db: Database,
  input: SyncEventInput,
  onPayoutCreated?: OnPayoutCreated,
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
      weightSource: input.weightSource as never,
      scaleId: input.scaleId as never,
      scaleReadingRaw: input.scaleReadingRaw as never,
    }),
  );
  if (recomputed !== input.contentHash) {
    return attention(
      input.id,
      'content_hash_mismatch',
      'content_hash does not match the submitted fields',
    );
  }

  const recordedAt = new Date(input.recordedAt);
  if (Number.isNaN(recordedAt.getTime())) {
    return attention(input.id, 'invalid_timestamp', 'recorded_at is not a valid timestamp');
  }

  // 1b. Only an authorized collector may be weighed (D-25). The offline cache lists only
  // `active` collectors, so this is the server-side backstop — e.g. revoked after the cache.
  const [collector] = await db
    .select({ status: collectors.status })
    .from(collectors)
    .where(eq(collectors.id, input.collectorId));
  const gated = collectorGate(input.id, collector?.status);
  if (gated) {
    return gated;
  }

  // 1c. The signed `recordedAt` picks which rate applies (below) and is the supervisor's own
  // clock, so it is bounded: the session must exist, and the capture time must fall inside its
  // window (± the configured grace) and not be in the future. Without this a supervisor could
  // sign an old timestamp together with that period's higher rate and be paid at it.
  const [session] = await db
    .select({ start: sessions.scheduledStart, end: sessions.scheduledEnd })
    .from(sessions)
    .where(eq(sessions.id, input.sessionId));
  if (!session) {
    return attention(input.id, 'session_not_found', 'session does not exist');
  }
  const graceMs = getSettings().anomaly.off_hours_grace_minutes * 60_000;
  if (recordedAt.getTime() > Date.now() + graceMs) {
    return attention(input.id, 'future_timestamp', 'recorded_at is in the future');
  }
  if (
    recordedAt.getTime() < session.start.getTime() - graceMs ||
    recordedAt.getTime() > session.end.getTime() + graceMs
  ) {
    return attention(
      input.id,
      'outside_session_window',
      'recorded_at is outside the session window',
    );
  }

  // 2. The rate must be the one that was active for that material at capture.
  const rate = await rateActiveAt(db, input.material, recordedAt);
  if (!rate) {
    return attention(
      input.id,
      'no_rate',
      `no "${input.material}" rate was active at ${input.recordedAt}`,
    );
  }
  if (rate.id !== input.rateId) {
    return attention(
      input.id,
      'rate_mismatch',
      'rate_id is not the rate that was active at recorded_at',
    );
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
    return attention(
      input.id,
      'supervisor_not_assigned',
      'supervisor is not assigned to this session',
    );
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
    const outcome = await db.transaction(async (tx) => {
      // The authoritative check, under a lock: a revoke committed since the read above must not
      // slip an event through. Share-locks the collector row FIRST, then the ledger — the same
      // collector → ledger order `decideCollectorAuthorization` uses, so the two cannot deadlock.
      const [locked] = await tx
        .select({ status: collectors.status })
        .from(collectors)
        .where(eq(collectors.id, input.collectorId))
        .for('share');
      const rejected = collectorGate(input.id, locked?.status);
      if (rejected) {
        return { rejected } as const;
      }

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
        weightSource: input.weightSource ?? 'manual',
        ...(input.scaleId ? { scaleId: input.scaleId } : {}),
        ...(input.scaleReadingRaw ? { scaleReadingRaw: input.scaleReadingRaw } : {}),
      });
      const payout = await createPayoutForEvent(tx, input.id);
      return {
        result: { id: input.id, status: 'confirmed', seq: entry.seq } satisfies SyncResult,
        payoutId: payout.id,
      };
    });
    if ('rejected' in outcome) {
      return outcome.rejected;
    }
    const { result, payoutId } = outcome;
    if (onPayoutCreated) {
      try {
        await onPayoutCreated(payoutId);
      } catch (error) {
        // The sweeper picks the payout up; a queue outage must not fail the sync.
        console.error(
          '[sync] could not enqueue the payout job',
          error instanceof Error ? error.name : typeof error,
        );
      }
    }
    // Anomaly detectors only ever WRITE flags for a human (ADR-0006); whatever they do, the
    // event is already confirmed and stays so.
    try {
      await runEventDetectors(db, input.id);
    } catch (error) {
      console.error(
        '[sync] anomaly detectors failed',
        error instanceof Error ? error.name : typeof error,
      );
    }
    return result;
  } catch (error) {
    // A concurrent submit of the same id won the race — return its result.
    if (isUniqueViolation(error)) {
      const now = await existingResult(db, input.id);
      if (now) {
        return now;
      }
    }
    // A DATA error (Postgres class 22 — e.g. a value that overflows its column — or class 23,
    // an integrity violation) will fail identically every time this event is resent. Report it
    // so a human can see it; rethrowing would 500, and the client retries a 500 forever,
    // blocking every event behind this one. Infrastructure errors still throw (retry is right).
    const code = pgErrorCode(error) ?? '';
    if (code.startsWith('22') || code.startsWith('23')) {
      return attention(
        input.id,
        'invalid_data',
        `the event could not be stored (database error ${code})`,
      );
    }
    throw error;
  }
}

/** Ingest a batch, one result per event in submitted order. Each event is its own transaction. */
export async function ingestCollectionEvents(
  db: Database,
  events: readonly SyncEventInput[],
  onPayoutCreated?: OnPayoutCreated,
): Promise<SyncResult[]> {
  const results: SyncResult[] = [];
  for (const event of events) {
    results.push(await ingestCollectionEvent(db, event, onPayoutCreated));
  }
  return results;
}
