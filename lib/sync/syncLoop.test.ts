// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectionEventDraft } from '@/types/domain';
import { captureCollectionEvent } from './capture';
import { closeSyncDb, getEvent, listOutbox, requeueEvent } from './store';
import { drainEventQueue } from './syncLoop';

const HEX64 = 'c'.repeat(64);

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

async function queueOne(over: Partial<CollectionEventDraft> = {}): Promise<string> {
  const stored = await captureCollectionEvent(draft(over), {
    blob: new Blob(['x']),
    sha256: HEX64,
    contentType: 'image/jpeg',
  });
  return stored.id;
}

const reply = (status: number, body: unknown): typeof fetch =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

beforeEach(async () => {
  await closeSyncDb();
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await closeSyncDb();
});

describe('drainEventQueue', () => {
  it('confirms an accepted event, stores its ledger seq and clears the outbox entry', async () => {
    const id = await queueOne();
    const result = await drainEventQueue(
      reply(200, { results: [{ id, status: 'confirmed', seq: 17 }] }),
    );
    expect(result).toMatchObject({ confirmed: 1, needsAttention: 0, signedOut: false });
    expect((await getEvent(id))?.syncStatus).toMatchObject({ state: 'confirmed', seq: 17 });
    expect(await listOutbox('collection_event')).toHaveLength(0);
  });

  it('keeps the stable reason code of a rejected event so the UI can translate it', async () => {
    const id = await queueOne();
    const result = await drainEventQueue(
      reply(200, {
        results: [
          {
            id,
            status: 'needs_attention',
            code: 'collector_not_authorized',
            reason: 'collector is not authorized (status: pending)',
          },
        ],
      }),
    );
    expect(result.needsAttention).toBe(1);
    expect((await getEvent(id))?.syncStatus).toMatchObject({
      state: 'needs_attention',
      code: 'collector_not_authorized',
    });
  });

  it('a 401 keeps every queued event, stops, and reports signedOut (never discards)', async () => {
    const a = await queueOne();
    const b = await queueOne({ weightKg: 3 });
    const fetchImpl = reply(401, { error: { code: 'unauthorized', message: 'no session' } });
    const result = await drainEventQueue(fetchImpl);

    expect(result.signedOut).toBe(true);
    expect(result.confirmed).toBe(0);
    expect((await getEvent(a))?.syncStatus).toEqual({ state: 'queued' });
    expect((await getEvent(b))?.syncStatus).toEqual({ state: 'queued' });
    expect(await listOutbox('collection_event')).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('after signing in again the same events drain and confirm', async () => {
    const id = await queueOne();
    await drainEventQueue(reply(401, { error: { code: 'unauthorized', message: '' } }));
    const result = await drainEventQueue(
      reply(200, { results: [{ id, status: 'confirmed', seq: 3 }] }),
    );
    expect(result).toMatchObject({ confirmed: 1, signedOut: false });
    expect((await getEvent(id))?.syncStatus.state).toBe('confirmed');
  });

  it('a network failure or 5xx leaves the events queued for a later run', async () => {
    const id = await queueOne();
    const down = vi.fn(async () => {
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect((await drainEventQueue(down)).retryable).toBe(1);
    expect((await getEvent(id))?.syncStatus).toEqual({ state: 'queued' });

    expect((await drainEventQueue(reply(503, {}))).retryable).toBe(1);
    expect((await getEvent(id))?.syncStatus).toEqual({ state: 'queued' });
    expect(await listOutbox('collection_event')).toHaveLength(1);
  });

  it('a needs_attention event can be re-queued once its cause is fixed, and confirms', async () => {
    const id = await queueOne();
    await drainEventQueue(
      reply(200, {
        results: [{ id, status: 'needs_attention', code: 'outside_session_window', reason: 'x' }],
      }),
    );
    expect(await listOutbox('collection_event')).toHaveLength(0);

    await requeueEvent(id);
    expect((await getEvent(id))?.syncStatus).toEqual({ state: 'queued' });
    expect(await listOutbox('collection_event')).toHaveLength(1);

    await drainEventQueue(reply(200, { results: [{ id, status: 'confirmed', seq: 9 }] }));
    expect((await getEvent(id))?.syncStatus.state).toBe('confirmed');
  });

  it('never re-queues an event that is already confirmed', async () => {
    const id = await queueOne();
    await drainEventQueue(reply(200, { results: [{ id, status: 'confirmed', seq: 1 }] }));
    await requeueEvent(id);
    expect((await getEvent(id))?.syncStatus.state).toBe('confirmed');
    expect(await listOutbox('collection_event')).toHaveLength(0);
  });
});
