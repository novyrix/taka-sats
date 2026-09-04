CREATE TABLE "collectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"alias" text NOT NULL,
	"nfc_tag_id" text,
	"address_source" text DEFAULT 'byo' NOT NULL,
	"lightning_address" text,
	"lnurl_pay_raw" text,
	"lnbits_wallet_id" text,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	CONSTRAINT "collectors_nfc_tag_id_unique" UNIQUE("nfc_tag_id"),
	CONSTRAINT "collectors_address_source_check" CHECK ("collectors"."address_source" in ('byo', 'provisioned')),
	CONSTRAINT "collectors_status_check" CHECK ("collectors"."status" in ('active', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "tag_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_id" uuid NOT NULL,
	"tag_id" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tag_history" ADD CONSTRAINT "tag_history_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_history_active_tag_id_idx" ON "tag_history" USING btree ("tag_id") WHERE "tag_history"."revoked_at" is null;