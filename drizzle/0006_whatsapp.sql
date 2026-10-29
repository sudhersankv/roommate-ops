CREATE TABLE "wa_contacts" (
	"lid" text PRIMARY KEY NOT NULL,
	"pn" text,
	"name" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_sessions" (
	"id" text DEFAULT 'default' NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_sessions_id_key_pk" PRIMARY KEY("id","key")
);
