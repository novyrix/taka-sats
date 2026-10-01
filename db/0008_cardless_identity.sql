CREATE SEQUENCE "public"."collector_public_code_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "collector_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"reason" text,
	"ledger_entry_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collector_authorizations_ledger_entry_id_unique" UNIQUE("ledger_entry_id"),
	CONSTRAINT "collector_authorizations_decision_check" CHECK ("collector_authorizations"."decision" in ('authorized', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "collector_payment_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_id" uuid NOT NULL,
	"type" text NOT NULL,
	"address" text NOT NULL,
	"provider_hint" text,
	"status" text NOT NULL,
	"validation_error" text,
	"verified_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	CONSTRAINT "collector_destinations_type_check" CHECK ("collector_payment_destinations"."type" in ('lightning_address', 'lnurl_pay')),
	CONSTRAINT "collector_destinations_status_check" CHECK ("collector_payment_destinations"."status" in ('pending_validation', 'verified', 'invalid', 'revoked'))
);
--> statement-breakpoint
ALTER TABLE "collectors" DROP CONSTRAINT "collectors_status_check";--> statement-breakpoint
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_entry_type_check";--> statement-breakpoint
ALTER TABLE "collectors" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "collection_events" ADD COLUMN "weight_source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_events" ADD COLUMN "scale_id" text;--> statement-breakpoint
ALTER TABLE "collection_events" ADD COLUMN "scale_reading_raw" text;--> statement-breakpoint
ALTER TABLE "collection_events" ADD COLUMN "verification_level" text DEFAULT 'V0' NOT NULL;--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "public_code" text;--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "registered_by" uuid;--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "authorized_by" uuid;--> statement-breakpoint
ALTER TABLE "collectors" ADD COLUMN "authorized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "collector_authorizations" ADD CONSTRAINT "collector_authorizations_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_authorizations" ADD CONSTRAINT "collector_authorizations_decided_by_supervisors_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_authorizations" ADD CONSTRAINT "collector_authorizations_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_payment_destinations" ADD CONSTRAINT "collector_payment_destinations_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "public"."collectors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_payment_destinations" ADD CONSTRAINT "collector_payment_destinations_created_by_supervisors_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collector_payment_destinations" ADD CONSTRAINT "collector_payment_destinations_revoked_by_supervisors_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "collector_authorizations_collector_idx" ON "collector_authorizations" USING btree ("collector_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collector_destinations_live_collector_idx" ON "collector_payment_destinations" USING btree ("collector_id") WHERE "collector_payment_destinations"."status" in ('pending_validation', 'verified');--> statement-breakpoint
CREATE UNIQUE INDEX "collector_destinations_live_address_idx" ON "collector_payment_destinations" USING btree ("address") WHERE "collector_payment_destinations"."status" in ('pending_validation', 'verified');--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_registered_by_supervisors_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_authorized_by_supervisors_id_fk" FOREIGN KEY ("authorized_by") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_weight_source_check" CHECK ("collection_events"."weight_source" in ('manual', 'ble_scale', 'serial_scale', 'industrial_scale'));--> statement-breakpoint
ALTER TABLE "collection_events" ADD CONSTRAINT "collection_events_verification_level_check" CHECK ("collection_events"."verification_level" in ('V0', 'V1', 'V2', 'V3', 'V4'));--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_status_check" CHECK ("collectors"."status" in ('pending', 'active', 'revoked'));--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_entry_type_check" CHECK ("ledger_entries"."entry_type" in ('collection_event', 'payout', 'correction', 'treasury_topup', 'rate_change', 'tag_revocation', 'collector_authorization'));--> statement-breakpoint

-- Hand-written data steps (everything above is drizzle-kit output).
-- 1. Give every pre-existing collector a public code, in enrolment order, with the default
--    prefix; then keep the sequence ahead of them and enforce NOT NULL + UNIQUE.
UPDATE "collectors" c SET "public_code" = 'TS-' || lpad(n.rn::text, 4, '0')
FROM (SELECT "id", row_number() OVER (ORDER BY "enrolled_at", "id") AS rn FROM "collectors") n
WHERE c."id" = n."id";--> statement-breakpoint
SELECT setval('collector_public_code_seq', GREATEST((SELECT count(*) FROM "collectors"), 1), (SELECT count(*) > 0 FROM "collectors"));--> statement-breakpoint
ALTER TABLE "collectors" ALTER COLUMN "public_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "collectors" ADD CONSTRAINT "collectors_public_code_unique" UNIQUE("public_code");--> statement-breakpoint

-- 2. Grandfather: collectors enrolled before the gate existed are authorized as of enrolment
--    (authorized_by stays NULL — there was no authorizer).
UPDATE "collectors" SET "authorized_at" = "enrolled_at" WHERE "status" = 'active';--> statement-breakpoint

-- 3. Carry each existing collector's validated address into the destinations table. Duplicate
--    addresses keep only the earliest collector's row (the live-address index would reject the
--    rest); every collector keeps its denormalised collectors.lightning_address regardless.
INSERT INTO "collector_payment_destinations" ("collector_id", "type", "address", "status", "verified_at")
SELECT DISTINCT ON (lower("lightning_address")) "id", 'lightning_address', lower("lightning_address"), 'verified', now()
FROM "collectors"
WHERE "lightning_address" IS NOT NULL AND "status" <> 'revoked'
ORDER BY lower("lightning_address"), "enrolled_at"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "collector_payment_destinations" ("collector_id", "type", "address", "status", "verified_at")
SELECT DISTINCT ON (lower("lnurl_pay_raw")) "id", 'lnurl_pay', lower("lnurl_pay_raw"), 'verified', now()
FROM "collectors"
WHERE "lightning_address" IS NULL AND "status" <> 'revoked' AND "lnurl_pay_raw" ~* '^lnurl1[02-9ac-hj-np-z]+$'
ORDER BY lower("lnurl_pay_raw"), "enrolled_at"
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- 3b. Anything that did NOT get a live destination above (the later of two collectors sharing an
--     address, or a raw https LNURL rather than a bech32 one) must not stay "payable" through the
--     denormalised copy on the collector row, and must not silently wait forever: record it as an
--     `invalid` destination (not live, so it blocks nothing) for staff to resolve, then clear the copy.
INSERT INTO "collector_payment_destinations" ("collector_id", "type", "address", "status", "validation_error")
SELECT c."id",
       CASE WHEN c."lightning_address" IS NOT NULL THEN 'lightning_address' ELSE 'lnurl_pay' END,
       lower(coalesce(c."lightning_address", c."lnurl_pay_raw")),
       'invalid',
       'legacy_not_migrated'
FROM "collectors" c
WHERE (c."lightning_address" IS NOT NULL OR c."lnurl_pay_raw" IS NOT NULL)
  AND c."status" <> 'revoked'
  AND NOT EXISTS (
    SELECT 1 FROM "collector_payment_destinations" d
    WHERE d."collector_id" = c."id" AND d."status" IN ('pending_validation', 'verified')
  );--> statement-breakpoint
UPDATE "collectors" c SET "lightning_address" = NULL, "lnurl_pay_raw" = NULL
WHERE (c."lightning_address" IS NOT NULL OR c."lnurl_pay_raw" IS NOT NULL)
  AND c."status" <> 'revoked'
  AND NOT EXISTS (
    SELECT 1 FROM "collector_payment_destinations" d
    WHERE d."collector_id" = c."id" AND d."status" IN ('pending_validation', 'verified')
  );
