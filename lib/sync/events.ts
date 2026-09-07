// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Collection-event assembly (M3-7). Turns a {@link CollectionEventDraft} the
 * PWA captured into a {@link CollectionEvent}: a client UUID v4, the
 * device-local capture time, the indicative sats figure, and the content hash
 * are fixed here and never change afterwards.
 *
 * IMPORTANT: `indicativeSats` is a **display** figure (§8.3). The binding
 * payout amount is computed only by `lib/money.ts:computePayout` at payout
 * time, against the exchange snapshot chosen then — never from this value.
 *
 * Framework-free (D-04).
 */

import type {
  CollectionEvent,
  CollectionEventDraft,
  GeoFix,
  Iso8601,
  ClientUuid,
} from '@/types/domain';
import { type Canonicalizable, contentHash } from './contentHash';

export class EventAssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EventAssemblyError';
  }
}

/**
 * `rate_fiat_minor` (minor units per kg) × `weightKg`, converted to sats at
 * `exchangeRate` (quote major units per 1 BTC). Floored — an indicative figure
 * should never over-promise. Not the binding amount (§8.3).
 */
export function indicativeSats(
  rateFiatMinor: number,
  weightKg: number,
  exchangeRate: number,
): number {
  if (!Number.isFinite(rateFiatMinor) || rateFiatMinor < 0) {
    throw new EventAssemblyError(`indicativeSats: bad rateFiatMinor (${rateFiatMinor})`);
  }
  if (!Number.isFinite(weightKg) || weightKg < 0) {
    throw new EventAssemblyError(`indicativeSats: bad weightKg (${weightKg})`);
  }
  if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
    throw new EventAssemblyError(`indicativeSats: bad exchangeRate (${exchangeRate})`);
  }
  // sats = fiatMinorTotal / 100 (→ major) / exchangeRate (→ BTC) × 1e8
  //      = rateFiatMinor × weightKg × 1_000_000 / exchangeRate
  return Math.floor((rateFiatMinor * weightKg * 1_000_000) / exchangeRate);
}

/**
 * The exact facts the `content_hash` covers, as a canonicalizable object
 * (key order is irrelevant — `canonicalize` sorts). Exported so the server's
 * sync-ingest path (M4-3) recomputes the hash from the *same* shape — the two
 * must never diverge (REQUIREMENTS §11 risk note).
 */
export function collectionEventPayload(
  event: Omit<CollectionEvent, 'contentHash' | 'photoUrl'>,
): Canonicalizable {
  const geo: Canonicalizable =
    event.geo.kind === 'fix'
      ? { kind: 'fix', lat: event.geo.lat, lng: event.geo.lng, accuracyM: event.geo.accuracyM }
      : { kind: 'unavailable', reason: event.geo.reason };
  return {
    id: event.id,
    collectorId: event.collectorId,
    supervisorId: event.supervisorId,
    sessionId: event.sessionId,
    material: event.material,
    weightKg: event.weightKg,
    rateId: event.rateId,
    rateFiatMinor: event.rateFiatMinor,
    exchangeRate: event.exchangeRate,
    indicativeSats: event.indicativeSats,
    photoSha256: event.photoSha256,
    geo,
    registrationType: event.registrationType,
    recordedAt: event.recordedAt,
  };
}

export type AssembleOptions = {
  /** Override identity/time for tests. Both default to a fresh value. */
  readonly id?: string;
  readonly recordedAt?: Date;
};

/**
 * @throws {EventAssemblyError} the draft is internally inconsistent (bad
 *   numbers, an empty photo hash, a fix with no coordinates).
 */
export async function assembleCollectionEvent(
  draft: CollectionEventDraft,
  options: AssembleOptions = {},
): Promise<CollectionEvent> {
  assertDraft(draft);

  const id = (options.id ?? crypto.randomUUID()) as ClientUuid;
  const recordedAt = (options.recordedAt ?? new Date()).toISOString() as Iso8601;
  const sats = indicativeSats(draft.rateFiatMinor, draft.weightKg, draft.exchangeRate);

  const base = { ...draft, id, recordedAt, indicativeSats: sats };
  const hash = await contentHash(collectionEventPayload(base));

  return { ...base, contentHash: hash, photoUrl: null };
}

function assertDraft(draft: CollectionEventDraft): void {
  if (!draft.photoSha256 || !/^[0-9a-f]{64}$/.test(draft.photoSha256)) {
    throw new EventAssemblyError(
      'assembleCollectionEvent: photoSha256 must be 64 hex chars (D-12)',
    );
  }
  if (!draft.collectorId || !draft.supervisorId || !draft.sessionId) {
    throw new EventAssemblyError(
      'assembleCollectionEvent: collector, supervisor and session are required',
    );
  }
  if (!draft.material || !draft.rateId) {
    throw new EventAssemblyError('assembleCollectionEvent: material and rateId are required');
  }
  assertGeo(draft.geo);
}

function assertGeo(geo: GeoFix): void {
  if (geo.kind === 'fix') {
    for (const [k, v] of [
      ['lat', geo.lat],
      ['lng', geo.lng],
      ['accuracyM', geo.accuracyM],
    ] as const) {
      if (!Number.isFinite(v)) {
        throw new EventAssemblyError(`assembleCollectionEvent: geo.${k} must be finite`);
      }
    }
  } else if (!geo.reason.trim()) {
    throw new EventAssemblyError(
      'assembleCollectionEvent: gps_unavailable_reason is required (US-2.3)',
    );
  }
}
