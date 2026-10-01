CREATE TABLE "payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_event_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"destination_id" uuid,
	"ledger_entry_id" uuid,
	"amount_sats" bigint,
	"amount_fiat_minor" bigint,
	"fiat_currency" text NOT NULL,
	"exchange_snapshot_id" uuid,
	"status" text DEFAULT 'awaiting_rate' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"provider" text,
	"provider_payment_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "payouts_collection_event_id_unique" UNIQUE("collection_event_id"),
	CONSTRAINT "payouts_ledger_entry_id_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "payouts_status_check" CHECK ("payouts"."status" in ('awaiting_rate', 'awaiting_destination', 'pending_approval', 'pending_float', 'queued', 'sending', 'paid', 'failed')),
	CONSTRAINT "payouts_priced_check" CHECK ("payouts"."status" in ('awaiting_rate', 'awaiting_destination', 'failed') or ("payouts"."amount_sats" is not null and "payouts"."amount_fiat_minor" is not null and "payouts"."exchange_snapshot_id" is not null)),
	CONSTRAINT "payouts_amounts_positive_check" CHECK (("payouts"."amount_sats" is null or "payouts"."amount_sats" > 0) and ("payouts"."amount_fiat_minor" is null or "payouts"."amount_fiat_minor" > 0)),
	CONSTRAINT "payouts_paid_check" CHECK ("payouts"."status" <> 'paid' or ("payouts"."ledger_entry_id" is not null and "payouts"."provider_payment_ref" is not null and "payouts"."settled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "anomaly_flags" DROP CONSTRAINT "anomaly_flags_flag_type_check";--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_collection_event_id_collection_events_id_fk" FOREIGN KEY ("collection_event_id") REFERENCES "public"."collection_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_destination_id_collector_payment_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."collector_payment_destinations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_exchange_snapshot_id_exchange_rate_snapshots_id_fk" FOREIGN KEY ("exchange_snapshot_id") REFERENCES "public"."exchange_rate_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_approved_by_supervisors_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payouts_status_idx" ON "payouts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payouts_collector_idx" ON "payouts" USING btree ("collector_id");--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_flag_type_check" CHECK ("anomaly_flags"."flag_type" in ('identical_weight_repeat', 'payout_concentration', 'off_hours', 'revoked_tag_tap', 'gps_outlier', 'rate_change_during_queue', 'payout_uncertain'));