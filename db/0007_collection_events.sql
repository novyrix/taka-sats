CREATE TABLE "collection_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"ledger_entry_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"supervisor_id" uuid NOT NULL,
	"session_id" uuid,
	"material" text NOT NULL,
	"weight_kg" numeric(6, 3) NOT NULL,
	"rate_id" uuid NOT NULL,
	"indicative_sats" bigint NOT NULL,
	"photo_url" text,
	"photo_sha256" text NOT NULL,
	"gps_lat" numeric,
	"gps_lng" numeric,
	"gps_accuracy_m" numeric,
	"gps_unavailable_reason" text,
	"recorded_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"registration_type" text DEFAULT 'tap' NOT NULL,
	"verification_status" text DEFAULT 'verified' NOT NULL,
	CONSTRAINT "collection_events_ledger_entry_id_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "collection_events_weight_check" CHECK ("collection_events"."weight_kg" > 0),
	CONSTRAINT "collection_events_registration_type_check" CHECK ("collection_events"."registration_type" in ('tap', 'walk_in', 'pending_self_serve')),
	CONSTRAINT "collection_events_verification_status_check" CHECK ("collection_events"."verification_status" in ('verified', 'pending_supervisor_review'))
);
--> statement-breakpoint
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_supervisor_id_supervisors_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_rate_id_material_rates_id_fk" FOREIGN KEY ("rate_id") REFERENCES "public"."material_rates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collection_events_session_idx" ON "collection_events" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "collection_events_collector_idx" ON "collection_events" USING btree ("collector_id");