// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The offline-first sync package (M3-2/M3-7/M3-8, M4). IndexedDB store
 * wrappers, event assembly + the content hash, the capture write path, and
 * (M4) the idempotent batch sync loop. Framework-free apart from `idb` (D-04);
 * `./store` and `./capture` are browser/worker only.
 */

export { canonicalize, contentHash, sha256Hex } from './contentHash';
export type { Canonicalizable } from './contentHash';
export {
  assembleCollectionEvent,
  EventAssemblyError,
  indicativeSats,
  type AssembleOptions,
} from './events';
export { captureCollectionEvent } from './capture';
export {
  cacheCollectors,
  closeSyncDb,
  countEventsByState,
  enqueueOutbox,
  getAnySessionConfig,
  getCachedCollector,
  getCachedCollectorByTag,
  getEvent,
  getSessionConfig,
  listEvents,
  listOutbox,
  markOutboxAttempt,
  openSyncDb,
  putEvent,
  putSessionConfig,
  removeOutbox,
  searchCachedCollectors,
  setEventSyncStatus,
  type StoredEvent,
  SYNC_DB_NAME,
  SYNC_DB_VERSION,
  type SyncDatabase,
} from './store';
