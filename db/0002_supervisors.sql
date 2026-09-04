CREATE TABLE "supervisors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"role" text DEFAULT 'supervisor' NOT NULL,
	"password_hash" text NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "supervisors_phone_unique" UNIQUE("phone"),
	CONSTRAINT "supervisors_role_check" CHECK ("supervisors"."role" in ('supervisor', 'hub_lead', 'admin'))
);
