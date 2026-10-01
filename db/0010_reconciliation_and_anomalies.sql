CREATE TABLE "reconciliation_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"material" text NOT NULL,
	"collected_kg" numeric(12, 3) NOT NULL,
	"paid_kg" numeric(12, 3) NOT NULL,
	"recycler_kg" numeric(12, 3) NOT NULL,
	"variance_kg" numeric(12, 3) NOT NULL,
	"variance_pct" numeric(12, 3) NOT NULL,
	"tolerance_pct" numeric(7, 3) NOT NULL,
	"status" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_reports_status_check" CHECK ("reconciliation_reports"."status" in ('within_tolerance', 'flagged', 'no_recycler_data')),
	CONSTRAINT "reconciliation_reports_period_check" CHECK ("reconciliation_reports"."period_end" > "reconciliation_reports"."period_start")
);
--> statement-breakpoint
CREATE TABLE "recycler_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material" text NOT NULL,
	"gross_kg" numeric(9, 3) NOT NULL,
	"tare_kg" numeric(9, 3) DEFAULT '0' NOT NULL,
	"weight_kg" numeric(9, 3) NOT NULL,
	"buyer" text NOT NULL,
	"price_per_kg_fiat_minor" bigint,
	"total_fiat_minor" bigint,
	"sold_at" timestamp with time zone NOT NULL,
	"receipt_sha256" text,
	"entered_by" uuid NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recycler_sales_ledger_entry_id_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "recycler_sales_gross_check" CHECK ("recycler_sales"."gross_kg" > 0),
	CONSTRAINT "recycler_sales_tare_check" CHECK ("recycler_sales"."tare_kg" >= 0),
	CONSTRAINT "recycler_sales_net_check" CHECK ("recycler_sales"."weight_kg" >= 0 and "recycler_sales"."weight_kg" = "recycler_sales"."gross_kg" - "recycler_sales"."tare_kg"),
	CONSTRAINT "recycler_sales_receipt_check" CHECK ("recycler_sales"."receipt_sha256" is null or "recycler_sales"."receipt_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "anomaly_flags" DROP CONSTRAINT "anomaly_flags_flag_type_check";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_entry_type_check";--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD COLUMN "collector_id" uuid;--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD COLUMN "supervisor_id" uuid;--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD COLUMN "session_id" uuid;--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_created_by_supervisors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recycler_sales" ADD CONSTRAINT "recycler_sales_entered_by_supervisors_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recycler_sales" ADD CONSTRAINT "recycler_sales_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_reports_created_idx" ON "reconciliation_reports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "recycler_sales_sold_at_idx" ON "recycler_sales" USING btree ("sold_at");--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_collection_event_id_collection_events_id_fk" FOREIGN KEY ("collection_event_id") REFERENCES "public"."collection_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_supervisor_id_supervisors_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anomaly_flags_type_event_uniq" ON "anomaly_flags" USING btree ("flag_type","collection_event_id") WHERE "anomaly_flags"."collection_event_id" is not null;--> statement-breakpoint
CREATE INDEX "anomaly_flags_review_idx" ON "anomaly_flags" USING btree ("review_outcome","detected_at");--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_flag_type_check" CHECK ("anomaly_flags"."flag_type" in ('identical_weight_repeat', 'payout_concentration', 'off_hours', 'revoked_tag_tap', 'gps_outlier', 'rate_change_during_queue', 'payout_uncertain', 'duplicate_photo', 'weight_outlier', 'mass_balance_variance'));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_entry_type_check" CHECK ("ledger_entries"."entry_type" in ('collection_event', 'payout', 'correction', 'treasury_topup', 'rate_change', 'tag_revocation', 'collector_authorization', 'recycler_sale'));