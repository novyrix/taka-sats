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
  bigint,
  boolean,
  check,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
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

// ── SESSIONS, RATES & PARTNERS (M2) ──────────────────────────────────────

/**
 * A sponsoring partner (Trezor / Blink / Fedi …). Reads are scoped to the
 * sessions they sponsor and are aggregate-only (§3.1, NFR 7.4). Login is
 * `login_email` + password (M2-1).
 */
export const partners = pgTable('partners', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  contact: text('contact'),
  loginEmail: text('login_email').unique(),
  /** `scrypt` hash (lib/auth/password.ts); null until a login is set up. Never logged. */
  passwordHash: text('password_hash'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A collection session: a place + time window with assigned supervisors and
 * an active rate set (FR-8.1). `status` moves scheduled → active → closed.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    location: text('location').notNull(),
    /** Optional polygon for geo scope (FR-6.1). GeoJSON-ish; shape validated in `lib/`. */
    geoBounds: jsonb('geo_bounds'),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }).notNull(),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('scheduled'),
    sponsorPartnerId: uuid('sponsor_partner_id').references(() => partners.id),
  },
  (table) => [
    check('sessions_status_check', sql`${table.status} in ('scheduled', 'active', 'closed')`),
    check('sessions_window_check', sql`${table.scheduledEnd} > ${table.scheduledStart}`),
  ],
);

/** Which supervisors may act in which session (FR-6.1). */
export const sessionSupervisors = pgTable(
  'session_supervisors',
  {
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    supervisorId: uuid('supervisor_id')
      .notNull()
      .references(() => supervisors.id),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.supervisorId] })],
);

/**
 * The versioned rate table (D-14, §8.3). Never overwritten: a rate change
 * inserts a new row and closes the prior one's `effective_to`. Fiat minor
 * units per kg — sats are computed at payout time, never stored here.
 * Seeded from `[rates].seed` on the first apply (M2-4).
 */
export const materialRates = pgTable(
  'material_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    material: text('material').notNull(),
    /** e.g. KES cents per kg. `bigint` (never float) — Code Style Guide §8. */
    rateFiatMinor: bigint('rate_fiat_minor', { mode: 'number' }).notNull(),
    fiatCurrency: text('fiat_currency').notNull().default('KES'),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull(),
    /** NULL = currently active. */
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
  },
  (table) => [
    check('material_rates_rate_check', sql`${table.rateFiatMinor} >= 0`),
    // At most one open (active) rate per material at a time.
    uniqueIndex('material_rates_active_material_idx')
      .on(table.material)
      .where(sql`${table.effectiveTo} is null`),
  ],
);

/**
 * Standing supervisor→location rotations (FR-3.7). Future session assignment
 * reflects these (M2-8).
 */
export const supervisorRotations = pgTable(
  'supervisor_rotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    supervisorId: uuid('supervisor_id')
      .notNull()
      .references(() => supervisors.id),
    location: text('location').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  },
  (table) => [
    check('supervisor_rotations_window_check', sql`${table.windowEnd} > ${table.windowStart}`),
  ],
);

/**
 * A point-in-time BTC↔fiat rate (US-7.3, D-18, ROADMAP M2-9). A payout will
 * not run against a snapshot older than `settings.money.rate_staleness_ttl_seconds`.
 * `rate` is `quote` units per 1 `base` (e.g. KES per BTC); `numeric` (never
 * float) — Code Style Guide §8. `sources` records each feed's raw reading.
 */
export const exchangeRateSnapshots = pgTable(
  'exchange_rate_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: numeric('rate').notNull(),
    /** `[{ source, rate }]` — the individual feed readings this snapshot aggregates. */
    sources: jsonb('sources').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('exchange_rate_snapshots_rate_check', sql`${table.rate} > 0`),
    index('exchange_rate_snapshots_pair_time_idx').on(table.base, table.quote, table.fetchedAt),
  ],
);

// ── LEDGER (the canonical append-only hash chain, D-13, M4) ──────────────────

/**
 * One global append-only chain of money- or trust-relevant facts (§11.1). The
 * server assigns `seq` (monotonic, under an advisory lock — see `lib/ledger`),
 * sets `prev_entry_hash` to the previous row's `entry_hash`, and computes
 * `entry_hash`. `UPDATE`/`DELETE` are blocked by a trigger (migration 0006) —
 * a correction is a new `entry_type = 'correction'` row whose `references_id`
 * points at the entry it supersedes.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    /** = the detail row's client UUID where applicable (collection events); else random. */
    id: uuid('id').primaryKey().defaultRandom(),
    /** Server-assigned monotonic order. App-assigned under an advisory lock; UNIQUE is the backstop. */
    seq: bigint('seq', { mode: 'number' }).notNull().unique(),
    entryType: text('entry_type').notNull(),
    /** sha256 of the canonical payload — the client's `content_hash` for offline-origin facts. */
    payloadHash: text('payload_hash').notNull(),
    /** `entry_hash` of `seq - 1`; NULL only at genesis (`seq = 1`). */
    prevEntryHash: text('prev_entry_hash'),
    /** sha256(seq | entry_type | payload_hash | prev_entry_hash) — see `lib/ledger`. */
    entryHash: text('entry_hash').notNull(),
    /** For a correction: the entry being superseded. */
    referencesId: uuid('references_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Original device-local capture time for an offline-origin fact. */
    deviceRecordedAt: timestamp('device_recorded_at', { withTimezone: true }),
  },
  (table) => [
    check(
      'ledger_entries_entry_type_check',
      sql`${table.entryType} in ('collection_event', 'payout', 'correction', 'treasury_topup', 'rate_change', 'tag_revocation')`,
    ),
    check('ledger_entries_seq_check', sql`${table.seq} > 0`),
    index('ledger_entries_references_idx').on(table.referencesId),
  ],
);

/**
 * A periodically signed `(through_seq, entry_hash)` anchor for external
 * verification (D-19, §11.2). Written by the checkpoint worker job (M4-7).
 */
export const ledgerCheckpoints = pgTable('ledger_checkpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  throughSeq: bigint('through_seq', { mode: 'number' }).notNull(),
  /** `entry_hash` at `through_seq`. */
  entryHash: text('entry_hash').notNull(),
  /** Programme-key signature over `(through_seq | entry_hash)`. */
  signature: text('signature').notNull(),
  nostrEventId: text('nostr_event_id'),
  opentimestamps: text('opentimestamps'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── COLLECTION EVENTS (detail rows behind the ledger, M4-3) ─────────────────

/**
 * The detail row for one weighed collection (§8.2, §9). The canonical fact is
 * its `ledger_entries` row (`ledger_entry_id`); this table holds the queryable
 * columns. `id` is the client-generated UUID (the idempotency key — a resent
 * event upserts). `photo_url` is nullable here (deviation from §9's `NOT NULL`)
 * because the photo uploads on its own queue (M3-10) and is back-filled.
 */
export const collectionEvents = pgTable(
  'collection_events',
  {
    id: uuid('id').primaryKey(),
    ledgerEntryId: uuid('ledger_entry_id')
      .notNull()
      .unique()
      .references(() => ledgerEntries.id),
    collectorId: uuid('collector_id')
      .notNull()
      .references(() => collectors.id),
    supervisorId: uuid('supervisor_id')
      .notNull()
      .references(() => supervisors.id),
    sessionId: uuid('session_id').references(() => sessions.id),
    material: text('material').notNull(),
    weightKg: numeric('weight_kg', { precision: 6, scale: 3 }).notNull(),
    rateId: uuid('rate_id')
      .notNull()
      .references(() => materialRates.id),
    /** `rate_fiat_minor × weight_kg` at the cached exchange rate — display only (§8.3). */
    indicativeSats: bigint('indicative_sats', { mode: 'number' }).notNull(),
    /** Filled once the photo upload queue drains (M3-10); null until then. */
    photoUrl: text('photo_url'),
    /** On-device SHA-256 of the photo bytes (D-12) — part of the content hash. */
    photoSha256: text('photo_sha256').notNull(),
    gpsLat: numeric('gps_lat'),
    gpsLng: numeric('gps_lng'),
    gpsAccuracyM: numeric('gps_accuracy_m'),
    gpsUnavailableReason: text('gps_unavailable_reason'),
    /** Device-local capture time. */
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    /** Server ingestion time. */
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    registrationType: text('registration_type').notNull().default('tap'),
    verificationStatus: text('verification_status').notNull().default('verified'),
  },
  (table) => [
    check('collection_events_weight_check', sql`${table.weightKg} > 0`),
    check(
      'collection_events_registration_type_check',
      sql`${table.registrationType} in ('tap', 'walk_in', 'pending_self_serve')`,
    ),
    check(
      'collection_events_verification_status_check',
      sql`${table.verificationStatus} in ('verified', 'pending_supervisor_review')`,
    ),
    index('collection_events_session_idx').on(table.sessionId),
    index('collection_events_collector_idx').on(table.collectorId),
  ],
);
