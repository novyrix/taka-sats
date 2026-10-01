// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The client sync loop (FR-4.2, US-4.2, ROADMAP M4-4). Drains the
 * `collection_event` outbox to `POST /api/v1/sync/events` in batches:
 *
 *   queued → syncing → confirmed (+ seq, drop the outbox entry)
 *                    ↘ needs_attention (+ reason, drop the entry — a human
 *                       must fix it; the event stays visible in the queue)
 *
 * The server is idempotent by client UUID, so a re-run after an interrupted
 * drain re-POSTs the same events and gets their stored results — no
 * duplicates. Only one drain runs at a time; a re-entrant call is a no-op.
 * Browser only.
 */

import type { Iso8601 } from '@/types/domain';
import {
  getEvent,
  listOutbox,
  markOutboxAttempt,
  removeOutbox,
  setEventSyncStatus,
  type StoredEvent,
} from './store';

export type SyncDrainResult = {
  /** Events the server accepted into the ledger this run. */
  readonly confirmed: number;
  /** Events the server rejected with a reason (left for a human). */
  readonly needsAttention: number;
  /** Events left `queued` because the POST failed (network/server) — retried next run. */
  readonly retryable: number;
  /** Outbox entries whose event was gone. */
  readonly skipped: number;
};

type ServerResult =
  | { readonly id: string; readonly status: 'confirmed'; readonly seq: number }
  | { readonly id: string; readonly status: 'needs_attention'; readonly reason: string };

const BATCH = 50;

/** The wire shape — a `StoredEvent` minus `syncStatus` / `photoUrl`. */
function toInput(e: StoredEvent): Record<string, unknown> {
  return {
    id: e.id,
    collectorId: e.collectorId,
    supervisorId: e.supervisorId,
    sessionId: e.sessionId,
    material: e.material,
    weightKg: e.weightKg,
    rateId: e.rateId,
    rateFiatMinor: e.rateFiatMinor,
    exchangeRate: e.exchangeRate,
    indicativeSats: e.indicativeSats,
    photoSha256: e.photoSha256,
    geo: e.geo,
    registrationType: e.registrationType,
    recordedAt: e.recordedAt,
    weightSource: e.weightSource,
    scaleId: e.scaleId,
    scaleReadingRaw: e.scaleReadingRaw,
    contentHash: e.contentHash,
  };
}

let running = false;

/** @param fetchImpl injectable for tests. */
export async function drainEventQueue(fetchImpl: typeof fetch = fetch): Promise<SyncDrainResult> {
  const total = { confirmed: 0, needsAttention: 0, retryable: 0, skipped: 0 };
  if (running) {
    return total;
  }
  running = true;
  try {
    for (;;) {
      const entries = (await listOutbox('collection_event')).slice(0, BATCH);
      if (entries.length === 0) {
        break;
      }

      const events: StoredEvent[] = [];
      for (const entry of entries) {
        const event = await getEvent(entry.refId);
        if (event) {
          events.push(event);
        } else {
          await removeOutbox(entry.id);
          total.skipped += 1;
        }
      }
      if (events.length === 0) {
        continue;
      }

      for (const event of events) {
        await setEventSyncStatus(event.id, { state: 'syncing' });
      }

      let results: ServerResult[];
      try {
        const res = await fetchImpl('/api/v1/sync/events', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ events: events.map(toInput) }),
        });
        if (!res.ok) {
          throw new Error(`sync HTTP ${res.status}`);
        }
        results = ((await res.json()) as { results: ServerResult[] }).results;
      } catch {
        // Network or server unavailable — put them back and stop; a later
        // trigger retries the whole batch.
        for (const event of events) {
          await setEventSyncStatus(event.id, { state: 'queued' });
          await markOutboxAttempt(event.id);
        }
        total.retryable += events.length;
        break;
      }

      const now = new Date().toISOString() as Iso8601;
      const seen = new Set<string>();
      for (const result of results) {
        seen.add(result.id);
        if (result.status === 'confirmed') {
          await setEventSyncStatus(result.id, {
            state: 'confirmed',
            syncedAt: now,
            seq: result.seq,
          });
          await removeOutbox(result.id);
          total.confirmed += 1;
        } else {
          await setEventSyncStatus(result.id, { state: 'needs_attention', reason: result.reason });
          await removeOutbox(result.id);
          total.needsAttention += 1;
        }
      }
      // Any event with no result line (shouldn't happen) is left `syncing` and
      // its outbox entry stays — the next drain re-POSTs it.
      for (const event of events) {
        if (!seen.has(event.id)) {
          await setEventSyncStatus(event.id, { state: 'queued' });
        }
      }
    }
    return total;
  } finally {
    running = false;
  }
}
