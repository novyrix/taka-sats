// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drizzle schema — the one source of truth for the database shape (D-08).
 *
 * Empty at M0 by design: this milestone only stands up the migration harness.
 * Table clusters arrive with their milestones (REQUIREMENTS §9):
 *   - M1: `collectors`, `tag_history`
 *   - M2: `supervisors`, `sessions`, `material_rates`, `partners`, …
 *   - M4: `ledger_entries` (+ DB-level UPDATE/DELETE revoked), `ledger_checkpoints`
 *   - M5: `payouts`, `treasury_snapshots`, `treasury_topups`
 *
 * Conventions (Code Style Guide §8): `snake_case` columns; money as `bigint`
 * (sats) or `numeric` (weights, fiat minor units), never `float`/`double`;
 * foreign keys enforced at the DB level; every generated migration keeps a
 * hand-written `down`. Zero framework imports (D-04).
 */

export {};
