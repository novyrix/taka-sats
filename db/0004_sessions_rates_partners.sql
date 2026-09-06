CREATE TABLE "material_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"material" text NOT NULL,
	"rate_fiat_minor" bigint NOT NULL,
	"fiat_currency" text DEFAULT 'KES' NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	CONSTRAINT "material_rates_rate_check" CHECK ("material_rates"."rate_fiat_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"login_email" text,
	"password_hash" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "partners_login_email_unique" UNIQUE("login_email")
);
--> statement-breakpoint
CREATE TABLE "session_supervisors" (
	"session_id" uuid NOT NULL,
	"supervisor_id" uuid NOT NULL,
	CONSTRAINT "session_supervisors_session_id_supervisor_id_pk" PRIMARY KEY("session_id","supervisor_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location" text NOT NULL,
	"geo_bounds" jsonb,
	"scheduled_start" timestamp with time zone NOT NULL,
	"scheduled_end" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"sponsor_partner_id" uuid,
	CONSTRAINT "sessions_status_check" CHECK ("sessions"."status" in ('scheduled', 'active', 'closed')),
	CONSTRAINT "sessions_window_check" CHECK ("sessions"."scheduled_end" > "sessions"."scheduled_start")
);
--> statement-breakpoint
CREATE TABLE "supervisor_rotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"supervisor_id" uuid NOT NULL,
	"location" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"window_end" timestamp with time zone NOT NULL,
	CONSTRAINT "supervisor_rotations_window_check" CHECK ("supervisor_rotations"."window_end" > "supervisor_rotations"."window_start")
);
--> statement-breakpoint
ALTER TABLE "session_supervisors" ADD CONSTRAINT "session_supervisors_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_supervisors" ADD CONSTRAINT "session_supervisors_supervisor_id_supervisors_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_sponsor_partner_id_partners_id_fk" FOREIGN KEY ("sponsor_partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supervisor_rotations" ADD CONSTRAINT "supervisor_rotations_supervisor_id_supervisors_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."supervisors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "material_rates_active_material_idx" ON "material_rates" USING btree ("material") WHERE "material_rates"."effective_to" is null;