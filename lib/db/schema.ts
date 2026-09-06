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
import {
  boolean,
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

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

/**
 * A staff user (§3.1): supervisor, hub_lead, or admin. Authenticates via
 * Auth.js credentials (M2-1, pulled forward to unblock M1-4's RBAC-gated
 * routes). `phone` is the login identifier. Long-lived JWT sessions (no
 * `sessions` table — see `lib/auth/`) are what let the PWA stay usable
 * through an extended offline period (§3.1, ADR-0002).
 */
export const supervisors = pgTable(
  'supervisors',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    phone: text('phone').notNull().unique(),
    /** 'supervisor' | 'hub_lead' | 'admin' (§3.2, lib/auth/permissions.ts Role). */
    role: text('role').notNull().default('supervisor'),
    /** `scrypt` hash, `salt:hash` hex (lib/auth/password.ts). Never logged. */
    passwordHash: text('password_hash').notNull(),
    locale: text('locale').notNull().default('en'),
    active: boolean('active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  },
  (table) => [
    check('supervisors_role_check', sql`${table.role} in ('supervisor', 'hub_lead', 'admin')`),
  ],
);

/**
 * Anomaly flags (REQUIREMENTS §9). Written by fraud detectors (M6-4) and by
 * the revoked-tag-tap handler (M1-9). A flag never auto-blocks anything —
 * it is queued for human review (ADR-0006 spirit).
 *
 * Minimal here for M1-9: `collection_event_id` is a plain column (its FK to
 * `collection_events` is added with that table in M3/M4). `context` (jsonb)
 * is a §9 extension — investigation detail, e.g. the tapped `tag_id`.
 */
export const anomalyFlags = pgTable(
  'anomaly_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** nullable — a revoked-tap flag has no event; FK added with `collection_events`. */
    collectionEventId: uuid('collection_event_id'),
    flagType: text('flag_type').notNull(),
    context: jsonb('context'),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedBy: uuid('reviewed_by').references(() => supervisors.id),
    /** 'confirmed' | 'dismissed' (null until reviewed). */
    reviewOutcome: text('review_outcome'),
  },
  (table) => [
    check(
      'anomaly_flags_flag_type_check',
      sql`${table.flagType} in ('identical_weight_repeat', 'payout_concentration', 'off_hours', 'revoked_tag_tap', 'gps_outlier', 'rate_change_during_queue')`,
    ),
    check(
      'anomaly_flags_review_outcome_check',
      sql`${table.reviewOutcome} is null or ${table.reviewOutcome} in ('confirmed', 'dismissed')`,
    ),
  ],
);
