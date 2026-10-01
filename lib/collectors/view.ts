// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The API shapes for a collector and a payment destination — a deliberate
 * projection of the DB rows, so internal columns (e.g. the provisioned wallet id)
 * never reach a client and the response is the documented contract
 * (`docs/BACKEND.md`). Dates are ISO strings on the wire.
 */

import { roleHasScope } from '@/lib/auth/permissions';
import { getSettings } from '@/lib/config';
import { collectorRefUrl, formatCollectorRef } from './reference';
import type { CollectorActor, CollectorRecord, DestinationRecord } from './types';

export type CollectorView = {
  readonly id: string;
  readonly alias: string;
  readonly publicCode: string;
  /** `pending` (awaiting authorization) | `active` (authorized) | `revoked`. */
  readonly status: CollectorRecord['status'];
  /** What a QR code or NFC tag for this collector carries — identity only (D-24). */
  readonly reference: { readonly payload: string; readonly url: string };
  readonly nfcTagId: string | null;
  readonly addressSource: CollectorRecord['addressSource'];
  /** The live destination's address, if any. @deprecated read `destination` from `GET /collectors/:id`. */
  readonly lightningAddress: string | null;
  /** @deprecated kept for the current enrol screen; equals the live destination address. */
  readonly lnurlPayRaw: string | null;
  readonly enrolledAt: Date;
  readonly registeredBy: string | null;
  readonly authorizedBy: string | null;
  readonly authorizedAt: Date | null;
};

export type DestinationView = Pick<
  DestinationRecord,
  | 'id'
  | 'type'
  | 'providerHint'
  | 'status'
  | 'validationError'
  | 'verifiedAt'
  | 'createdAt'
  | 'revokedAt'
> & {
  /** The wallet address. `null` when the viewer may know that a wallet exists but not whose it is. */
  readonly address: string | null;
};

/** Staff, and the supervisor who registered the collector, may see the collector's wallet address. */
export function canSeeAddress(
  actor: CollectorActor,
  collector: Pick<CollectorRecord, 'registeredBy'>,
): boolean {
  return roleHasScope(actor.role, 'collector:authorize') || collector.registeredBy === actor.id;
}

export function toCollectorView(
  row: CollectorRecord,
  { withAddress = true }: { readonly withAddress?: boolean } = {},
): CollectorView {
  return {
    id: row.id,
    alias: row.alias,
    publicCode: row.publicCode,
    status: row.status as CollectorRecord['status'],
    reference: {
      payload: formatCollectorRef(row.publicCode),
      url: collectorRefUrl(getSettings().programme.public_base_url, row.publicCode),
    },
    nfcTagId: row.nfcTagId,
    addressSource: row.addressSource,
    lightningAddress: withAddress ? row.lightningAddress : null,
    lnurlPayRaw: withAddress ? row.lnurlPayRaw : null,
    enrolledAt: row.enrolledAt,
    registeredBy: row.registeredBy,
    authorizedBy: row.authorizedBy,
    authorizedAt: row.authorizedAt,
  };
}

/**
 * `withAddress: false` hides the address (a wallet address is personal data): a supervisor
 * sees the status and provider label of anyone's wallet, but the address only of collectors
 * they registered — staff see everything.
 */
export function toDestinationView(
  row: DestinationRecord,
  { withAddress = true }: { readonly withAddress?: boolean } = {},
): DestinationView {
  return {
    id: row.id,
    type: row.type,
    address: withAddress ? row.address : null,
    providerHint: row.providerHint,
    status: row.status,
    validationError: row.validationError,
    verifiedAt: row.verifiedAt,
    createdAt: row.createdAt,
    revokedAt: row.revokedAt,
  };
}
