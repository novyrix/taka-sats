// SPDX-License-Identifier: AGPL-3.0-only

/**
 * End-of-session rollup (ROADMAP M3-9). Pure aggregation over the local
 * `events` store — a supervisor sees their session's totals and the state of
 * every queued item without the network. Browser only (imports `./store`).
 */

import type { SyncStatus } from '@/types/domain';
import { listEvents, type StoredEvent } from './store';

export type SessionSummary = {
  readonly count: number;
  readonly totalKg: number;
  readonly totalIndicativeSats: number;
  readonly walkInCount: number;
  /** How many events sit in each sync state. */
  readonly byState: Readonly<Record<SyncStatus['state'], number>>;
  /** Every event for the session, newest first (as `listEvents` returns them). */
  readonly events: readonly StoredEvent[];
};

const ZERO_BY_STATE: Record<SyncStatus['state'], number> = {
  queued: 0,
  syncing: 0,
  confirmed: 0,
  needs_attention: 0,
  failed: 0,
};

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export async function sessionSummary(sessionId?: string): Promise<SessionSummary> {
  const events = await listEvents(sessionId);
  const byState = { ...ZERO_BY_STATE };
  let totalKg = 0;
  let totalIndicativeSats = 0;
  let walkInCount = 0;

  for (const e of events) {
    byState[e.syncStatus.state] += 1;
    totalKg += e.weightKg;
    totalIndicativeSats += e.indicativeSats;
    if (e.registrationType === 'walk_in') {
      walkInCount += 1;
    }
  }

  return {
    count: events.length,
    totalKg: round3(totalKg),
    totalIndicativeSats,
    walkInCount,
    byState,
    events,
  };
}
