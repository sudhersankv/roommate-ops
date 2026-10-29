CREATE TABLE "beta_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"group_size" text NOT NULL,
	"purpose" text NOT NULL,
	"phone" text,
	"notes" text,
	"status" text DEFAULT 'new' NOT NULL,
	"user_agent" text,
	"ip_hash" text
);
--> statement-breakpoint
CREATE INDEX "beta_requests_created_at" ON "beta_requests" USING btree ("created_at");