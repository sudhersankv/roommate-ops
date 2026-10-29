CREATE TABLE "trick_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trick_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_hash" text
);
--> statement-breakpoint
CREATE INDEX "trick_votes_trick_id" ON "trick_votes" USING btree ("trick_id");