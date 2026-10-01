-- Down migration for 0012_payout_resolutions (Code Style Guide §8).
-- Drops every recorded resolution. The `payout` / `correction` ledger entries they wrote are NOT
-- removed (the ledger is append-only, migration 0006), and a payout a person marked paid stays paid.
DROP TRIGGER IF EXISTS payout_resolutions_no_delete ON "payout_resolutions";
DROP TRIGGER IF EXISTS payout_resolutions_no_update ON "payout_resolutions";
DROP FUNCTION IF EXISTS payout_resolutions_immutable();
DROP TABLE IF EXISTS "payout_resolutions";
