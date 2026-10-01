-- Down migration for 0011_treasury_topups (Code Style Guide §8).
-- Drops every funding proposal and approval. The `treasury_topup` ledger entries they wrote are
-- NOT removed (the ledger is append-only, migration 0006): the chain stays valid, it just no
-- longer has detail rows behind those entries.
DROP TRIGGER IF EXISTS treasury_topup_signoffs_no_delete ON "treasury_topup_signoffs";
DROP TRIGGER IF EXISTS treasury_topup_signoffs_no_update ON "treasury_topup_signoffs";
DROP TRIGGER IF EXISTS treasury_topup_signoffs_guard ON "treasury_topup_signoffs";
DROP FUNCTION IF EXISTS treasury_topup_signoffs_immutable();
DROP FUNCTION IF EXISTS treasury_topup_signoff_guard();
DROP TABLE IF EXISTS "treasury_topup_signoffs";
DROP TABLE IF EXISTS "treasury_topups";
