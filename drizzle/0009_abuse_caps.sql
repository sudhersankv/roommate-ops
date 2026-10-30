CREATE TABLE IF NOT EXISTS "rate_counters" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_counters_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS "paused_at" timestamp with time zone;
