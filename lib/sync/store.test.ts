// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CachedCollector, CollectionEventDraft } from '@/types/domain';
import { captureCollectionEvent } from './capture';
import { assembleCollectionEvent } from './events';
import {
  cacheCollectors,
  closeSyncDb,
  countEventsByState,
  enqueueOutbox,
  getCachedCollectorByTag,
  getEvent,
  listEvents,
  listOutbox,
  markOutboxAttempt,
  putEvent,
  removeOutbox,
  searchCachedCollectors,
  setEventSyncStatus,
} from './store';

const HEX64 = 'b'.repeat(64);

function draft(over: Partial<CollectionEventDraft> = {}): CollectionEventDraft {
  return {
    collectorId: '11111111-1111-4111-8111-111111111111',
    supervisorId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
    material: 'PET',
    weightKg: 2.5,
    rateId: '44444444-4444-4444-8444-444444444444',
    rateFiatMinor: 2200,
    exchangeRate: 5_000_000,
    photoSha256: HEX64,
    geo: { kind: 'unavailable', reason: 'no signal' },
    registrationType: 'tap',
    ...over,
  };
}

beforeEach(async () => {
  await closeSyncDb();
  globalThis.indexedDB = new IDBFactory(); // a fresh in-memory DB per test
});
afterEach(async () => {
  await closeSyncDb();
});

describe('events store', () => {
  it('putEvent stores as queued and getEvent round-trips', async () => {
    const event = await assembleCollectionEvent(draft(), { id: 'e1' });
    const stored = await putEvent(event);
    expect(stored.syncStatus).toEqual({ state: 'queued' });

    const back = await getEvent('e1');
    expect(back?.id).toBe('e1');
    expect(back?.contentHash).toBe(event.contentHash);
  });

  it('listEvents filters by session and returns newest first', async () => {
    await putEvent(
      await assembleCollectionEvent(draft(), {
        id: 'older',
        recordedAt: new Date('2026-06-01T08:00:00Z'),
      }),
    );
    await putEvent(
      await assembleCollectionEvent(draft(), {
        id: 'newer',
        recordedAt: new Date('2026-06-01T10:00:00Z'),
      }),
    );
    await putEvent(
      await assembleCollectionEvent(draft({ sessionId: '99999999-9999-4999-8999-999999999999' }), {
        id: 'other',
      }),
    );

    const list = await listEvents('33333333-3333-4333-8333-333333333333');
    expect(list.map((e) => e.id)).toEqual(['newer', 'older']);
    expect(await listEvents('no-such-session')).toEqual([]);
  });

  it('setEventSyncStatus updates and countEventsByState reflects it', async () => {
    await putEvent(await assembleCollectionEvent(draft(), { id: 'a' }));
    await putEvent(await assembleCollectionEvent(draft(), { id: 'b' }));
    expect(await countEventsByState('queued')).toBe(2);

    await setEventSyncStatus('a', { state: 'syncing' });
    expect(await countEventsByState('queued')).toBe(1);
    expect(await countEventsByState('syncing')).toBe(1);

    await expect(setEventSyncStatus('ghost', { state: 'syncing' })).rejects.toThrow();
  });
});

describe('outbox', () => {
  it('enqueue is idempotent, attempts increment, remove clears', async () => {
    await enqueueOutbox({ id: 'x', kind: 'collection_event', refId: 'x' });
    await enqueueOutbox({ id: 'x', kind: 'collection_event', refId: 'x' });

    let outbox = await listOutbox('collection_event');
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.attempts).toBe(0);
    expect(outbox[0]?.lastAttemptAt).toBeNull();

    await markOutboxAttempt('x');
    outbox = await listOutbox();
    expect(outbox[0]?.attempts).toBe(1);
    expect(outbox[0]?.lastAttemptAt).not.toBeNull();

    expect(await markOutboxAttempt('ghost')).toBeUndefined();

    await removeOutbox('x');
    expect(await listOutbox()).toEqual([]);
  });

  it('listOutbox is FIFO by createdAt', async () => {
    await enqueueOutbox({ id: 'first', kind: 'collection_event', refId: 'first' });
    await new Promise((r) => setTimeout(r, 2));
    await enqueueOutbox({ id: 'second', kind: 'photo', refId: 'p' });
    expect((await listOutbox()).map((e) => e.id)).toEqual(['first', 'second']);
  });
});

describe('captureCollectionEvent (write path, M3-8)', () => {
  it('writes the event AND an outbox entry before resolving', async () => {
    const stored = await captureCollectionEvent(
      draft({ weightKg: 1.2, registrationType: 'walk_in' }),
    );

    expect(stored.syncStatus).toEqual({ state: 'queued' });
    expect((await getEvent(stored.id))?.id).toBe(stored.id);

    const outbox = await listOutbox();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ id: stored.id, kind: 'collection_event', refId: stored.id });
  });
});

describe('cached collectors (M3-3)', () => {
  const rows: CachedCollector[] = [
    { id: 'c1', alias: 'Amina Otieno', nfcTagId: 'TAG-1', status: 'active' },
    { id: 'c2', alias: 'Brian Kamau', nfcTagId: null, status: 'active' },
    { id: 'c3', alias: 'Aminata', nfcTagId: 'TAG-3', status: 'active' },
  ];

  it('cacheCollectors replaces wholesale; lookup by tag + alias search', async () => {
    await cacheCollectors(rows);
    await cacheCollectors(rows); // wholesale replace — still 3, no dupes

    expect((await getCachedCollectorByTag('TAG-3'))?.id).toBe('c3');
    const hits = await searchCachedCollectors('amin');
    expect(hits.map((c) => c.id).sort()).toEqual(['c1', 'c3']);
    expect(await searchCachedCollectors('   ')).toEqual([]);
  });
});
