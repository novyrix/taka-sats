CREATE TABLE "exchange_rate_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"base" text NOT NULL,
	"quote" text NOT NULL,
	"rate" numeric NOT NULL,
	"sources" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exchange_rate_snapshots_rate_check" CHECK ("exchange_rate_snapshots"."rate" > 0)
);
--> statement-breakpoint
CREATE INDEX "exchange_rate_snapshots_pair_time_idx" ON "exchange_rate_snapshots" USING btree ("base","quote","fetched_at");