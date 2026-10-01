-- Down migration for 0010_reconciliation_and_anomalies (Code Style Guide §8).
-- Drops every recycler sale and reconciliation report, and the anomaly flags of the new types.
-- `recycler_sale` entries already on the ledger are NOT removed (the ledger is append-only,
-- migration 0006), so the narrower entry_type CHECK is re-added NOT VALID: it guards new rows
-- without re-checking the history it can no longer delete.
DROP TABLE IF EXISTS "recycler_sales";
DROP TABLE IF EXISTS "reconciliation_reports";
DELETE FROM "anomaly_flags" WHERE "flag_type" IN ('duplicate_photo', 'weight_outlier', 'mass_balance_variance');
DROP INDEX IF EXISTS "anomaly_flags_type_event_uniq";
DROP INDEX IF EXISTS "anomaly_flags_review_idx";
ALTER TABLE "anomaly_flags" DROP CONSTRAINT "anomaly_flags_flag_type_check";
ALTER TABLE "anomaly_flags" DROP CONSTRAINT "anomaly_flags_collection_event_id_collection_events_id_fk";
ALTER TABLE "anomaly_flags" DROP CONSTRAINT "anomaly_flags_collector_id_collectors_id_fk";
ALTER TABLE "anomaly_flags" DROP CONSTRAINT "anomaly_flags_supervisor_id_supervisors_id_fk";
ALTER TABLE "anomaly_flags" DROP CONSTRAINT "anomaly_flags_session_id_sessions_id_fk";
ALTER TABLE "anomaly_flags" DROP COLUMN "collector_id", DROP COLUMN "supervisor_id", DROP COLUMN "session_id", DROP COLUMN "reviewed_at", DROP COLUMN "review_note";
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_flag_type_check" CHECK ("flag_type" in ('identical_weight_repeat', 'payout_concentration', 'off_hours', 'revoked_tag_tap', 'gps_outlier', 'rate_change_during_queue', 'payout_uncertain'));
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_entry_type_check";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_entry_type_check" CHECK ("entry_type" in ('collection_event', 'payout', 'correction', 'treasury_topup', 'rate_change', 'tag_revocation', 'collector_authorization')) NOT VALID;
