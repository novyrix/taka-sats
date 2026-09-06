CREATE TABLE "anomaly_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_event_id" uuid,
	"flag_type" text NOT NULL,
	"context" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by" uuid,
	"review_outcome" text,
	CONSTRAINT "anomaly_flags_flag_type_check" CHECK ("anomaly_flags"."flag_type" in ('identical_weight_repeat', 'payout_concentration', 'off_hours', 'revoked_tag_tap', 'gps_outlier', 'rate_change_during_queue')),
	CONSTRAINT "anomaly_flags_review_outcome_check" CHECK ("anomaly_flags"."review_outcome" is null or "anomaly_flags"."review_outcome" in ('confirmed', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "anomaly_flags" ADD CONSTRAINT "anomaly_flags_reviewed_by_supervisors_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;