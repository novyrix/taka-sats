// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drizzle schema — the one source of truth for the database shape (D-08).
 *
 * Table clusters arrive with their milestones (REQUIREMENTS §9):
 *   - M1: `collectors`, `tag_history` (this file, so far)
 *   - M2: `supervisors`, `sessions`, `material_rates`, `partners`, …
 *   - M4: `ledger_entries` (+ DB-level UPDATE/DELETE revoked), `ledger_checkpoints`
 *   - M5: `payouts`, `treasury_snapshots`, `treasury_topups`
 *
 * Conventions (Code Style Guide §8): `snake_case` columns; money as `bigint`
 * (sats) or `numeric` (weights, fiat minor units), never `float`/`double`;
 * foreign keys enforced at the DB level; every generated migration keeps a
 * hand-written `down`. Zero framework imports (D-04).
 */

import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * A collector: alias-only identity (§7.1). Requires no ID, phone, or address.
 * `nfc_tag_id` denormalises the *current* active tag for a fast lookup; the
 * full history — including revoked mappings — lives in {@link tagHistory}.
 */
export const collectors = pgTable(
  'collectors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alias: text('alias').notNull(),
    /** The current active tag id, if any. Denormalised copy of the latest tag_history row. */
    nfcTagId: text('nfc_tag_id').unique(),
    /** 'byo' | 'provisioned' (D-05/D-22). */
    addressSource: text('address_source').notNull().default('byo'),
    /** Nullable until scanned (BYO) or provisioned. */
    lightningAddress: text('lightning_address'),
    /** BYO only: the original scanned payload, kept for re-write/audit. */
    lnurlPayRaw: text('lnurl_pay_raw'),
    /** Set only when address_source = 'provisioned'. */
    lnbitsWalletId: text('lnbits_wallet_id'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    /** 'active' | 'revoked'. */
    status: text('status').notNull().default('active'),
  },
  (table) => [
    check('collectors_address_source_check', sql`${table.addressSource} in ('byo', 'provisioned')`),
    check('collectors_status_check', sql`${table.status} in ('active', 'revoked')`),
  ],
);

/**
 * The physical-tag lifecycle for a collector (§7.2–7.3). Reissue = a new row
 * mapping a new tag to the same `collector_id`; the collector's earnings
 * history is untouched. Revoke sets `revoked_at`; a subsequent tap of that
 * tag is rejected by the PWA and the API (`anomaly_flags.revoked_tag_tap`).
 */
export const tagHistory = pgTable(
  'tag_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    tagId: text('tag_id').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => [
    // At most one *active* (non-revoked) mapping per physical tag id at a
    // time — a revoked tag id may later be reissued to a different collector.
    uniqueIndex('tag_history_active_tag_id_idx')
      .on(table.tagId)
      .where(sql`${table.revokedAt} is null`),
  ],
);
