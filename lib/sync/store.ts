// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The offline store (M3-2). A thin, typed `idb` wrapper around four object
 * stores:
 *
 *  - `events`       — assembled {@link CollectionEvent}s, each with a
 *                      {@link SyncStatus}. The source of truth until the server
 *                      confirms them (M4).
 *  - `collectors`   — collector rows cached for offline lookup (M3-3).
 *  - `sessionConfig` — the active session + its rate/exchange snapshot.
 *  - `outbox`       — items awaiting delivery, drained by M4's sync loop.
 *
 * Every write completes before the UI shows success (Code Style Guide §6).
 * Framework-free apart from `idb` (D-04). Browser/worker only —
 * callers on the server must not import this.
 */

import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type {
  CachedCollector,
  CachedSessionConfig,
  CollectionEvent,
  OutboxEntry,
  SyncStatus,
} from '@/types/domain';

export const SYNC_DB_NAME = 'takasats-sync';
export const SYNC_DB_VERSION = 2;

/** An event as persisted: the assembled event plus its local sync state. */
export type StoredEvent = CollectionEvent & { readonly syncStatus: SyncStatus };

/** A captured photo held until the upload queue (M3-10) drains it to storage. */
export type StoredPhoto = {
  /** The `events` id this photo belongs to. */
  readonly eventId: string;
  readonly blob: Blob;
  readonly sha256: string;
  readonly contentType: string;
};

interface SyncDb extends DBSchema {
  events: {
    key: string;
    value: StoredEvent;
    indexes: { by_session: string; by_sync_state: string };
  };
  collectors: {
    key: string;
    value: CachedCollector;
    indexes: { by_tag: string };
  };
  sessionConfig: { key: string; value: CachedSessionConfig };
  outbox: {
    key: string;
    value: OutboxEntry;
    indexes: { by_kind: string };
  };
  photos: { key: string; value: StoredPhoto };
}

export type SyncDatabase = IDBPDatabase<SyncDb>;

let dbPromise: Promise<SyncDatabase> | null = null;

export function openSyncDb(): Promise<SyncDatabase> {
  dbPromise ??= openDB<SyncDb>(SYNC_DB_NAME, SYNC_DB_VERSION, {
    upgrade(db, oldVersion) {
      // Upgrades are keyed on `oldVersion` and never rewrite existing rows
      // destructively.
      if (oldVersion < 1) {
        const events = db.createObjectStore('events', { keyPath: 'id' });
        events.createIndex('by_session', 'sessionId');
        events.createIndex('by_sync_state', 'syncStatus.state');

        const collectors = db.createObjectStore('collectors', { keyPath: 'id' });
        collectors.createIndex('by_tag', 'nfcTagId');

        db.createObjectStore('sessionConfig', { keyPath: 'sessionId' });

        const outbox = db.createObjectStore('outbox', { keyPath: 'id' });
        outbox.createIndex('by_kind', 'kind');
      }
      if (oldVersion < 2) {
        // v2 — hold the photo bytes locally until the upload queue drains them.
        db.createObjectStore('photos', { keyPath: 'eventId' });
      }
    },
  });
  return dbPromise;
}

/** Close and forget the cached handle — tests call this between cases. */
export async function closeSyncDb(): Promise<void> {
  if (dbPromise) {
    (await dbPromise).close();
    dbPromise = null;
  }
}

// ── events ──────────────────────────────────────────────────────────────────

/** Persist a freshly assembled event as `queued`. Resolves only once written. */
export async function putEvent(
  event: CollectionEvent,
  syncStatus: SyncStatus = { state: 'queued' },
): Promise<StoredEvent> {
  const db = await openSyncDb();
  const stored: StoredEvent = { ...event, syncStatus };
  await db.put('events', stored);
  return stored;
}

export async function getEvent(id: string): Promise<StoredEvent | undefined> {
  return (await openSyncDb()).get('events', id);
}

export async function listEvents(sessionId?: string): Promise<StoredEvent[]> {
  const db = await openSyncDb();
  const rows = sessionId
    ? await db.getAllFromIndex('events', 'by_session', sessionId)
    : await db.getAll('events');
  return rows.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1)); // newest first
}

export async function setEventSyncStatus(id: string, syncStatus: SyncStatus): Promise<StoredEvent> {
  const db = await openSyncDb();
  const existing = await db.get('events', id);
  if (!existing) {
    throw new Error(`setEventSyncStatus: no event ${id}`);
  }
  const updated: StoredEvent = { ...existing, syncStatus };
  await db.put('events', updated);
  return updated;
}

/**
 * Put a `needs_attention` (or `failed`) event back in the queue after its cause was fixed
 * (an admin authorized the collector, the session window was widened). The server re-validates
 * it on the next drain, so this cannot get a bad event accepted.
 */
export async function requeueEvent(id: string): Promise<StoredEvent | undefined> {
  const existing = await getEvent(id);
  if (!existing || existing.syncStatus.state === 'confirmed') {
    return existing;
  }
  const updated = await setEventSyncStatus(id, { state: 'queued' });
  await enqueueOutbox({ id, kind: 'collection_event', refId: id });
  return updated;
}

export async function countEventsByState(state: SyncStatus['state']): Promise<number> {
  return (await openSyncDb()).countFromIndex('events', 'by_sync_state', state);
}

// ── outbox ──────────────────────────────────────────────────────────────────

/** Add (or replace) an outbox entry for `refId`. Idempotent on the entry id. */
export async function enqueueOutbox(
  entry: Pick<OutboxEntry, 'id' | 'kind' | 'refId'>,
): Promise<OutboxEntry> {
  const db = await openSyncDb();
  const existing = await db.get('outbox', entry.id);
  const full: OutboxEntry = existing ?? {
    ...entry,
    attempts: 0,
    createdAt: new Date().toISOString() as OutboxEntry['createdAt'],
    lastAttemptAt: null,
  };
  await db.put('outbox', full);
  return full;
}

export async function listOutbox(kind?: OutboxEntry['kind']): Promise<OutboxEntry[]> {
  const db = await openSyncDb();
  const rows = kind
    ? await db.getAllFromIndex('outbox', 'by_kind', kind)
    : await db.getAll('outbox');
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)); // FIFO
}

export async function markOutboxAttempt(id: string): Promise<OutboxEntry | undefined> {
  const db = await openSyncDb();
  const existing = await db.get('outbox', id);
  if (!existing) {
    return undefined;
  }
  const updated: OutboxEntry = {
    ...existing,
    attempts: existing.attempts + 1,
    lastAttemptAt: new Date().toISOString() as OutboxEntry['lastAttemptAt'],
  };
  await db.put('outbox', updated);
  return updated;
}

export async function removeOutbox(id: string): Promise<void> {
  await (await openSyncDb()).delete('outbox', id);
}

// ── cached collectors (M3-3) ────────────────────────────────────────────────

/** Replace the cached collector list wholesale (a fresh pull while online). */
export async function cacheCollectors(collectors: readonly CachedCollector[]): Promise<void> {
  const db = await openSyncDb();
  const tx = db.transaction('collectors', 'readwrite');
  await tx.store.clear();
  await Promise.all(collectors.map((c) => tx.store.put(c)));
  await tx.done;
}

export async function getCachedCollector(id: string): Promise<CachedCollector | undefined> {
  return (await openSyncDb()).get('collectors', id);
}

export async function getCachedCollectorByTag(
  nfcTagId: string,
): Promise<CachedCollector | undefined> {
  return (await openSyncDb()).getFromIndex('collectors', 'by_tag', nfcTagId);
}

/** A small alphabetical directory for the cardless collector picker. */
export async function listCachedCollectors(limit = 20): Promise<CachedCollector[]> {
  const all = await (await openSyncDb()).getAll('collectors');
  return all.sort((a, b) => a.alias.localeCompare(b.alias)).slice(0, Math.max(1, limit));
}

/** Case-insensitive alias/public-code substring match over the cached list (D-24, offline). */
export async function searchCachedCollectors(
  query: string,
  limit = 20,
): Promise<CachedCollector[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  const all = await (await openSyncDb()).getAll('collectors');
  return all
    .filter(
      (c) =>
        c.alias.toLowerCase().includes(needle) ||
        (c.publicCode?.toLowerCase().includes(needle) ?? false),
    )
    .slice(0, Math.max(1, limit));
}

// ── session config ──────────────────────────────────────────────────────────

export async function putSessionConfig(config: CachedSessionConfig): Promise<void> {
  await (await openSyncDb()).put('sessionConfig', config);
}

export async function getSessionConfig(
  sessionId: string,
): Promise<CachedSessionConfig | undefined> {
  return (await openSyncDb()).get('sessionConfig', sessionId);
}

export async function getAnySessionConfig(): Promise<CachedSessionConfig | undefined> {
  const all = await (await openSyncDb()).getAll('sessionConfig');
  return all.sort((a, b) => (a.cachedAt < b.cachedAt ? 1 : -1))[0];
}

// ── photos (M3-10) ──────────────────────────────────────────────────────────

export async function putPhoto(photo: StoredPhoto): Promise<void> {
  await (await openSyncDb()).put('photos', photo);
}

export async function getPhoto(eventId: string): Promise<StoredPhoto | undefined> {
  return (await openSyncDb()).get('photos', eventId);
}

export async function deletePhoto(eventId: string): Promise<void> {
  await (await openSyncDb()).delete('photos', eventId);
}
