// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The offline-first sync package (M3-2/M3-7/M3-8, M4). IndexedDB store
 * wrappers, event assembly + the content hash, the capture write path, and
 * (M4) the idempotent batch sync loop. Framework-free apart from `idb` (D-04);
 * `./store` and `./capture` are browser/worker only.
 */

export { canonicalize, contentHash, sha256Hex, sha256HexBytes } from './contentHash';
export type { Canonicalizable } from './contentHash';
export {
  assembleCollectionEvent,
  collectionEventPayload,
  EventAssemblyError,
  indicativeSats,
  type AssembleOptions,
} from './events';
export { captureCollectionEvent, type CapturePhoto } from './capture';
export { drainPhotoQueue, type PhotoDrainResult } from './photoQueue';
export { drainEventQueue, type SyncDrainResult } from './syncLoop';
export { primeWeighCache, type PrimeResult } from './prime';
export { sessionSummary, type SessionSummary } from './summary';
export {
  cacheCollectors,
  closeSyncDb,
  countEventsByState,
  deletePhoto,
  enqueueOutbox,
  getAnySessionConfig,
  getCachedCollector,
  getCachedCollectorByTag,
  getEvent,
  getPhoto,
  getSessionConfig,
  listEvents,
  listCachedCollectors,
  listOutbox,
  markOutboxAttempt,
  openSyncDb,
  putEvent,
  putPhoto,
  putSessionConfig,
  removeOutbox,
  searchCachedCollectors,
  setEventSyncStatus,
  type StoredEvent,
  type StoredPhoto,
  SYNC_DB_NAME,
  SYNC_DB_VERSION,
  type SyncDatabase,
} from './store';
