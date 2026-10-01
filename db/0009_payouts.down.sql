-- Down migration for 0009_payouts (Code Style Guide §8).
-- Drops every payout row. Any `payout` ledger entries already on the chain are NOT removed (the
-- ledger is append-only, migration 0006) — they simply no longer have a detail row. `payout_uncertain`
-- anomaly flags are deleted so the narrower CHECK can return.
DROP TABLE IF EXISTS "payouts";
DELETE FROM "anomaly_flags" WHERE "flag_type" = 'payout_uncertain';
ALTER TABLE "anomaly_flags" DROP CONSTRAINT "anomaly_flags_flag_type_check";
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_flag_type_check" CHECK ("flag_type" in ('identical_weight_repeat', 'payout_concentration', 'off_hours', 'revoked_tag_tap', 'gps_outlier', 'rate_change_during_queue'));
