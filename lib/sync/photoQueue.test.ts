// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CollectionEventDraft } from '@/types/domain';
import { captureCollectionEvent } from './capture';
import { drainPhotoQueue } from './photoQueue';
import { closeSyncDb, enqueueOutbox, getEvent, getPhoto, listOutbox } from './store';

const HEX64 = 'd'.repeat(64);

function draft(over: Partial<CollectionEventDraft> = {}): CollectionEventDraft {
  return {
    collectorId: '11111111-1111-4111-8111-111111111111',
    supervisorId: '22222222-2222-4222-8222-222222222222',
    sessionId: '33333333-3333-4333-8333-333333333333',
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

const photo = () => ({
  blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
  sha256: HEX64,
  contentType: 'image/jpeg',
});

function okResponse(url = 'https://minio/taka-sats/photos/x'): Response {
  return new Response(JSON.stringify({ photoUrl: url }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(async () => {
  await closeSyncDb();
  globalThis.indexedDB = new IDBFactory();
});
afterEach(async () => {
  await closeSyncDb();
});

describe('captureCollectionEvent with a photo', () => {
  it('persists the blob and enqueues a `photo` outbox entry alongside the event entry', async () => {
    const stored = await captureCollectionEvent(draft(), photo());

    expect((await getPhoto(stored.id))?.contentType).toBe('image/jpeg');
    const kinds = (await listOutbox()).map((e) => e.kind).sort();
    expect(kinds).toEqual(['collection_event', 'photo']);
  });
});

describe('drainPhotoQueue', () => {
  it('uploads, sets the event photoUrl, and clears the entry + blob', async () => {
    const stored = await captureCollectionEvent(draft(), photo());

    const seen: { sha?: string | null; type?: string | null } = {};
    const result = await drainPhotoQueue(async (_url, init) => {
      const headers = new Headers(init?.headers);
      seen.sha = headers.get('x-photo-sha256');
      seen.type = headers.get('content-type');
      return okResponse();
    });

    expect(result).toEqual({ uploaded: 1, failed: 0, skipped: 0 });
    expect(seen).toEqual({ sha: HEX64, type: 'image/jpeg' });
    expect((await getEvent(stored.id))?.photoUrl).toBe('https://minio/taka-sats/photos/x');
    expect(await getPhoto(stored.id)).toBeUndefined();
    expect((await listOutbox('photo')).length).toBe(0);
  });

  it('leaves the entry and bumps attempts on a non-OK response', async () => {
    await captureCollectionEvent(draft(), photo());
    const result = await drainPhotoQueue(async () => new Response('nope', { status: 500 }));
    expect(result).toEqual({ uploaded: 0, failed: 1, skipped: 0 });

    const [entry] = await listOutbox('photo');
    expect(entry?.attempts).toBe(1);
  });

  it('clears a stale `photo` entry whose blob is gone', async () => {
    await enqueueOutbox({ id: 'photo:ghost', kind: 'photo', refId: 'ghost' });
    const result = await drainPhotoQueue(async () => okResponse());
    expect(result).toEqual({ uploaded: 0, failed: 0, skipped: 1 });
    expect(await listOutbox('photo')).toEqual([]);
  });
});
