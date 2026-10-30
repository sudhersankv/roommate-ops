ALTER TABLE "chats" ADD COLUMN "participant_count" integer;--> statement-breakpoint
ALTER TABLE "chats" ADD COLUMN "participant_count_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "join_code" text;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "join_code_rotated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "join_policy" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "wants_seat_id" uuid;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_join_code_unique" UNIQUE("join_code");