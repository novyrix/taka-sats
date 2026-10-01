CREATE TABLE "treasury_topup_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topup_id" uuid NOT NULL,
	"supervisor_id" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_topup_signoffs_ledger_entry_id_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "treasury_topup_signoffs_once" UNIQUE("topup_id","supervisor_id")
);
--> statement-breakpoint
CREATE TABLE "treasury_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"amount_sats" bigint NOT NULL,
	"note" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"approvals_required" integer NOT NULL,
	"float_baseline_sats" bigint,
	"float_baseline_at" timestamp with time zone,
	"transfer_reference" text,
	"transferred_by" uuid,
	"transferred_at" timestamp with time zone,
	"transfer_ledger_entry_id" uuid,
	"outcome_at" timestamp with time zone,
	"outcome_by" uuid,
	"outcome_reason" text,
	"outcome_ledger_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "treasury_topups_ledger_entry_id_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "treasury_topups_transfer_reference_unique" UNIQUE("transfer_reference"),
	CONSTRAINT "treasury_topups_transfer_ledger_entry_id_unique" UNIQUE("transfer_ledger_entry_id"),
	CONSTRAINT "treasury_topups_outcome_ledger_entry_id_unique" UNIQUE("outcome_ledger_entry_id"),
	CONSTRAINT "treasury_topups_status_check" CHECK ("treasury_topups"."status" in ('proposed', 'approved', 'transferred', 'confirmed', 'rejected', 'cancelled')),
	CONSTRAINT "treasury_topups_amount_check" CHECK ("treasury_topups"."amount_sats" > 0),
	CONSTRAINT "treasury_topups_approvals_check" CHECK ("treasury_topups"."approvals_required" >= 1),
	CONSTRAINT "treasury_topups_transfer_check" CHECK (("treasury_topups"."status" in ('transferred', 'confirmed')) = ("treasury_topups"."transfer_reference" is not null and "treasury_topups"."transfer_ledger_entry_id" is not null)),
	CONSTRAINT "treasury_topups_outcome_check" CHECK (("treasury_topups"."status" in ('confirmed', 'rejected', 'cancelled')) = ("treasury_topups"."outcome_at" is not null and "treasury_topups"."outcome_ledger_entry_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "treasury_topup_signoffs" ADD CONSTRAINT "treasury_topup_signoffs_topup_id_treasury_topups_id_fk" FOREIGN KEY ("topup_id") REFERENCES "public"."treasury_topups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_topup_signoffs" ADD CONSTRAINT "treasury_topup_signoffs_supervisor_id_supervisors_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_topup_signoffs" ADD CONSTRAINT "treasury_topup_signoffs_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_topups" ADD CONSTRAINT "treasury_topups_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_topups" ADD CONSTRAINT "treasury_topups_proposed_by_supervisors_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_topups" ADD CONSTRAINT "treasury_topups_transferred_by_supervisors_id_fk" FOREIGN KEY ("transferred_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_topups" ADD CONSTRAINT "treasury_topups_transfer_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("transfer_ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_topups" ADD CONSTRAINT "treasury_topups_outcome_by_supervisors_id_fk" FOREIGN KEY ("outcome_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_topups" ADD CONSTRAINT "treasury_topups_outcome_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("outcome_ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "treasury_topups_status_idx" ON "treasury_topups" USING btree ("status");--> statement-breakpoint
-- Separation of duties, enforced by the database as well as by lib/treasury (ADR-0020 §3):
-- a proposer can never approve their own proposal, and only an open (`proposed`) proposal
-- can collect approvals. A trigger, not a CHECK, because the rule reads another table.
CREATE OR REPLACE FUNCTION treasury_topup_signoff_guard() RETURNS trigger AS $$
DECLARE
	topup RECORD;
BEGIN
	SELECT proposed_by, status INTO topup FROM treasury_topups WHERE id = NEW.topup_id;
	IF topup.proposed_by = NEW.supervisor_id THEN
		RAISE EXCEPTION 'a proposer cannot approve their own top-up'
			USING ERRCODE = 'check_violation';
	END IF;
	IF topup.status <> 'proposed' THEN
		RAISE EXCEPTION 'a top-up in status % cannot be approved', topup.status
			USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER treasury_topup_signoffs_guard BEFORE INSERT ON "treasury_topup_signoffs"
	FOR EACH ROW EXECUTE FUNCTION treasury_topup_signoff_guard();
--> statement-breakpoint
-- Approvals are evidence of who agreed. Like the ledger, they are never edited or removed
-- (TRUNCATE stays open for operator reset and test isolation).
CREATE OR REPLACE FUNCTION treasury_topup_signoffs_immutable() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'treasury_topup_signoffs is append-only: % is not permitted', TG_OP
		USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER treasury_topup_signoffs_no_update BEFORE UPDATE ON "treasury_topup_signoffs"
	FOR EACH STATEMENT EXECUTE FUNCTION treasury_topup_signoffs_immutable();
--> statement-breakpoint
CREATE TRIGGER treasury_topup_signoffs_no_delete BEFORE DELETE ON "treasury_topup_signoffs"
	FOR EACH STATEMENT EXECUTE FUNCTION treasury_topup_signoffs_immutable();
