// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CollectionEventDraft } from '@/types/domain';
import { assembleCollectionEvent } from './events';
import { closeSyncDb, putEvent, setEventSyncStatus } from './store';
import { sessionSummary } from './summary';

const HEX64 = 'c'.repeat(64);
const SESSION = '33333333-3333-4333-8333-333333333333';

function draft(over: Partial<CollectionEventDraft> = {}): CollectionEventDraft {
  return {
    collectorId: '11111111-1111-4111-8111-111111111111',
    supervisorId: '22222222-2222-4222-8222-222222222222',
    sessionId: SESSION,
    material: 'PET',
    weightKg: 2,
    rateId: '44444444-4444-4444-8444-444444444444',
    rateFiatMinor: 2200,
    exchangeRate: 5_000_000,
    photoSha256: HEX64,
    geo: { kind: 'unavailable', reason: 'x' },
    registrationType: 'tap',
    ...over,
  };
}

beforeEach(async () => {
  await closeSyncDb();
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await closeSyncDb();
});

describe('sessionSummary', () => {
  it('is all-zero for an empty store', async () => {
    const s = await sessionSummary(SESSION);
    expect(s).toMatchObject({ count: 0, totalKg: 0, totalIndicativeSats: 0, walkInCount: 0 });
    expect(s.byState).toEqual({
      queued: 0,
      syncing: 0,
      confirmed: 0,
      needs_attention: 0,
      failed: 0,
    });
  });

  it('totals weight + indicative sats, counts walk-ins, and buckets by sync state', async () => {
    const a = await assembleCollectionEvent(draft({ weightKg: 2.5 }), {
      id: 'a',
      recordedAt: new Date('2026-06-10T09:00:00Z'),
    });
    const b = await assembleCollectionEvent(
      draft({ weightKg: 1.25, registrationType: 'walk_in' }),
      { id: 'b', recordedAt: new Date('2026-06-10T10:00:00Z') },
    );
    const c = await assembleCollectionEvent(draft({ weightKg: 3, sessionId: 'other-session' }), {
      id: 'c',
      recordedAt: new Date('2026-06-10T11:00:00Z'),
    });
    await putEvent(a);
    await putEvent(b);
    await putEvent(c);
    await setEventSyncStatus('b', { state: 'syncing' });

    const s = await sessionSummary(SESSION);
    expect(s.count).toBe(2); // c is a different session
    expect(s.totalKg).toBe(3.75);
    expect(s.totalIndicativeSats).toBe(a.indicativeSats + b.indicativeSats);
    expect(s.walkInCount).toBe(1);
    expect(s.byState.queued).toBe(1);
    expect(s.byState.syncing).toBe(1);
    expect(s.events.map((e) => e.id)).toEqual(['b', 'a']); // newest first
  });
});
