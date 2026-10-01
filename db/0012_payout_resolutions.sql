CREATE TABLE "payout_resolutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payout_id" uuid NOT NULL,
	"attempt" integer NOT NULL,
	"outcome" text NOT NULL,
	"reference" text,
	"note" text,
	"provider_state" text NOT NULL,
	"resolved_by" uuid NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	CONSTRAINT "payout_resolutions_reference_unique" UNIQUE("reference"),
	CONSTRAINT "payout_resolutions_ledger_entry_id_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "payout_resolutions_attempt_once" UNIQUE("payout_id","attempt"),
	CONSTRAINT "payout_resolutions_outcome_check" CHECK ("payout_resolutions"."outcome" in ('paid', 'failed')),
	CONSTRAINT "payout_resolutions_reference_check" CHECK ("payout_resolutions"."outcome" <> 'paid' or "payout_resolutions"."reference" is not null)
);
--> statement-breakpoint
ALTER TABLE "payout_resolutions" ADD CONSTRAINT "payout_resolutions_payout_id_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_resolutions" ADD CONSTRAINT "payout_resolutions_resolved_by_supervisors_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_resolutions" ADD CONSTRAINT "payout_resolutions_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- A resolution is evidence of who decided what about a stuck payment. Like the ledger it is never
-- edited or removed (TRUNCATE stays open for operator reset and test isolation).
CREATE OR REPLACE FUNCTION payout_resolutions_immutable() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'payout_resolutions is append-only: % is not permitted', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER payout_resolutions_no_update BEFORE UPDATE ON "payout_resolutions"
	FOR EACH STATEMENT EXECUTE FUNCTION payout_resolutions_immutable();
--> statement-breakpoint
CREATE TRIGGER payout_resolutions_no_delete BEFORE DELETE ON "payout_resolutions"
	FOR EACH STATEMENT EXECUTE FUNCTION payout_resolutions_immutable();
