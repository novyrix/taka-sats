// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cross-cutting domain types shared between `lib/`, the API layer, and the PWA.
 * Keep framework types out of this file (D-04).
 *
 * The collection-event + sync types below are the offline spine (M3-2, M3-7):
 * what a supervisor captures, how it is queued, and how its sync state is
 * represented. Server-authoritative fields (`seq`, `entryHash`, `syncedAt`)
 * are absent until the event comes back from ingestion (M4).
 */

export type Iso8601 = string & { readonly __brand: 'Iso8601' };

/** A client-generated idempotency key (UUID v4) for offline-first writes. */
export type ClientUuid = string & { readonly __brand: 'ClientUuid' };

/** `tap` = NFC/looked-up collector; `walk_in` = no tag yet; `pending_self_serve` = review. */
export type RegistrationType = 'tap' | 'walk_in' | 'pending_self_serve';

/**
 * How the kilograms were captured (D-27, ADR-0019) — signed into the content hash.
 * OCR agreement is NOT a source; it is a later, derived verification result.
 */
export const WEIGHT_SOURCES = ['manual', 'ble_scale', 'serial_scale', 'industrial_scale'] as const;
export type WeightSource = (typeof WEIGHT_SOURCES)[number];

/** GPS fix, or an explicit recorded reason it is missing (US-2.3). */
export type GeoFix =
  | { readonly kind: 'fix'; readonly lat: number; readonly lng: number; readonly accuracyM: number }
  | { readonly kind: 'unavailable'; readonly reason: string };

/**
 * Everything the PWA captures for one collection before assembly (M3-4/5/6).
 * `photoSha256` is computed on-device from the image bytes (D-12) before the
 * photo is uploaded; `photoUrl` is filled by the upload queue (M3-10) later.
 */
export type CollectionEventDraft = {
  readonly collectorId: string;
  readonly supervisorId: string;
  readonly sessionId: string;
  readonly material: string;
  readonly weightKg: number;
  /** The `material_rates` row active at capture (its versioned id + minor-unit rate). */
  readonly rateId: string;
  readonly rateFiatMinor: number;
  /** Latest cached BTC→fiat rate (quote units per 1 BTC) used for the indicative figure. */
  readonly exchangeRate: number;
  readonly photoSha256: string;
  readonly geo: GeoFix;
  readonly registrationType: RegistrationType;
  /** How the weight was captured. Defaults to `manual` at assembly. */
  readonly weightSource?: WeightSource;
  /** The connected scale that produced the reading, when there is one. */
  readonly scaleId?: string;
  /** The scale's raw reading string, kept verbatim for audit. */
  readonly scaleReadingRaw?: string;
};

/**
 * A draft after {@link assembleCollectionEvent}: identity, capture time, the
 * indicative (non-binding) sats figure, and the content hash are now fixed.
 * This is the object that goes into IndexedDB and, later, to the sync API.
 */
export type CollectionEvent = CollectionEventDraft & {
  readonly id: ClientUuid;
  /** Always set after assembly (`manual` unless a scale supplied the reading). */
  readonly weightSource: WeightSource;
  /** Device-local capture time (honest about the clock — server orders by ingestion). */
  readonly recordedAt: Iso8601;
  /** `rateFiatMinor × weightKg`, converted at `exchangeRate`. Display only — the
   * binding amount is computed by `lib/money.ts:computePayout` at payout time (§8.3). */
  readonly indicativeSats: number;
  /** SHA-256 over the canonical serialisation of the captured facts (§11.1). */
  readonly contentHash: string;
  /** Filled by the photo upload queue (M3-10) once the image is in object storage. */
  readonly photoUrl: string | null;
};

/** Discriminated sync state for one queued item (Code Style Guide §6). */
export type SyncStatus =
  | { readonly state: 'queued' }
  | { readonly state: 'syncing' }
  | { readonly state: 'confirmed'; readonly syncedAt: Iso8601; readonly seq: number }
  | { readonly state: 'needs_attention'; readonly reason: string; readonly code?: string }
  | { readonly state: 'failed'; readonly reason: string; readonly attempts: number };

/** A collector row cached in IndexedDB for offline lookup (M3-3). */
export type CachedCollector = {
  readonly id: string;
  readonly alias: string;
  /** `TS-KBR-0042` (D-24) — searchable offline. Absent in a cache primed before it existed. */
  readonly publicCode?: string;
  readonly nfcTagId: string | null;
  readonly status: string;
};

/** The active session + the rate/exchange snapshot the weigh flow needs offline. */
export type CachedSessionConfig = {
  readonly sessionId: string;
  readonly location: string;
  readonly scheduledStart: Iso8601;
  readonly scheduledEnd: Iso8601;
  readonly rates: readonly {
    readonly rateId: string;
    readonly material: string;
    readonly rateFiatMinor: number;
    readonly fiatCurrency: string;
  }[];
  readonly exchangeRate: number;
  readonly cachedAt: Iso8601;
};

/** One item awaiting delivery to the server (M3-8, drained by M4's sync loop). */
export type OutboxEntry = {
  readonly id: string;
  readonly kind: 'collection_event' | 'photo';
  /** The `events` (or photo) record this entry delivers. */
  readonly refId: string;
  readonly attempts: number;
  readonly createdAt: Iso8601;
  readonly lastAttemptAt: Iso8601 | null;
};
