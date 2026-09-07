CREATE TABLE "ledger_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"through_seq" bigint NOT NULL,
	"entry_hash" text NOT NULL,
	"signature" text NOT NULL,
	"nostr_event_id" text,
	"opentimestamps" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seq" bigint NOT NULL,
	"entry_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"prev_entry_hash" text,
	"entry_hash" text NOT NULL,
	"references_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_recorded_at" timestamp with time zone,
	CONSTRAINT "ledger_entries_seq_unique" UNIQUE("seq"),
	CONSTRAINT "ledger_entries_entry_type_check" CHECK ("ledger_entries"."entry_type" in ('collection_event', 'payout', 'correction', 'treasury_topup', 'rate_change', 'tag_revocation')),
	CONSTRAINT "ledger_entries_seq_check" CHECK ("ledger_entries"."seq" > 0)
);
--> statement-breakpoint
CREATE INDEX "ledger_entries_references_idx" ON "ledger_entries" USING btree ("references_id");--> statement-breakpoint
-- ledger_entries is append-only (D-13, REQUIREMENTS §11.1). A trigger blocks
-- UPDATE/DELETE regardless of role — enforceable on managed Postgres too.
-- Operators should ALSO `REVOKE UPDATE, DELETE ON ledger_entries FROM <app_role>`
-- for defence in depth where the app does not connect as the table owner.
CREATE OR REPLACE FUNCTION ledger_entries_immutable() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'ledger_entries is append-only: % is not permitted', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_update BEFORE UPDATE ON "ledger_entries"
	FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_immutable();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_no_delete BEFORE DELETE ON "ledger_entries"
	FOR EACH STATEMENT EXECUTE FUNCTION ledger_entries_immutable();
