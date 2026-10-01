-- Down migration for 0008_cardless_identity (Code Style Guide §8).
-- Fails on purpose if any `collector_authorization` ledger entry exists: the ledger is
-- append-only (migration 0006), so those rows cannot be removed. Collectors that are still
-- `pending` become `revoked` — never silently authorized — before the old CHECK returns.
DROP TABLE IF EXISTS "collector_payment_destinations";
DROP TABLE IF EXISTS "collector_authorizations";
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_entry_type_check";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_entry_type_check" CHECK ("entry_type" in ('collection_event', 'payout', 'correction', 'treasury_topup', 'rate_change', 'tag_revocation'));
ALTER TABLE "collection_events" DROP CONSTRAINT "collection_events_verification_level_check";
ALTER TABLE "collection_events" DROP CONSTRAINT "collection_events_weight_source_check";
ALTER TABLE "collection_events" DROP COLUMN "verification_level";
ALTER TABLE "collection_events" DROP COLUMN "scale_reading_raw";
ALTER TABLE "collection_events" DROP COLUMN "scale_id";
ALTER TABLE "collection_events" DROP COLUMN "weight_source";
ALTER TABLE "collectors" DROP CONSTRAINT "collectors_status_check";
UPDATE "collectors" SET "status" = 'revoked' WHERE "status" = 'pending';
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_status_check" CHECK ("status" in ('active', 'revoked'));
ALTER TABLE "collectors" ALTER COLUMN "status" SET DEFAULT 'active';
ALTER TABLE "collectors" DROP COLUMN "authorized_at";
ALTER TABLE "collectors" DROP COLUMN "authorized_by";
ALTER TABLE "collectors" DROP COLUMN "registered_by";
ALTER TABLE "collectors" DROP COLUMN "public_code";
DROP SEQUENCE IF EXISTS "collector_public_code_seq";
