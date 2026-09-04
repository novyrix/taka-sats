// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Cross-cutting domain types shared between `lib/`, the API layer, and the PWA.
 *
 * Placeholder for M0 — the real entities (Collector, Session, CollectionEvent,
 * Payout, LedgerEntry, …) are introduced with their migrations from M1 onward
 * (REQUIREMENTS §9). Keep framework types out of this file (D-04).
 */

export type Iso8601 = string & { readonly __brand: 'Iso8601' };

/** A client-generated idempotency key (UUID v4) for offline-first writes. */
export type ClientUuid = string & { readonly __brand: 'ClientUuid' };
