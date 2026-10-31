-- Polls and DMs (#24 part B, ADR 0018, ADR 0020): polls + poll_votes (votes after a restart still count; WhatsApp's
-- messageSecret is kept with the poll) and dm_context (which Group a person's DM is about). activity.source gains
-- 'dm', which is text without a check constraint: nothing to change there. Idempotent.
CREATE TABLE IF NOT EXISTS "dm_context" (
	"member_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dm_context_member_id_kind_pk" PRIMARY KEY("member_id","kind")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "polls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"channel" text NOT NULL,
	"external_id" text,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"multi" boolean DEFAULT false NOT NULL,
	"about" jsonb NOT NULL,
	"secret" bytea,
	"resolves_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "poll_votes" (
	"poll_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"option_ids" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "poll_votes_poll_id_member_id_pk" PRIMARY KEY("poll_id","member_id")
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dm_context_member_id_members_id_fk') THEN
		ALTER TABLE "dm_context" ADD CONSTRAINT "dm_context_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'dm_context_group_id_groups_id_fk') THEN
		ALTER TABLE "dm_context" ADD CONSTRAINT "dm_context_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'poll_votes_poll_id_polls_id_fk') THEN
		ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'poll_votes_member_id_members_id_fk') THEN
		ALTER TABLE "poll_votes" ADD CONSTRAINT "poll_votes_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'polls_group_id_groups_id_fk') THEN
		ALTER TABLE "polls" ADD CONSTRAINT "polls_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'polls_created_by_members_id_fk') THEN
		ALTER TABLE "polls" ADD CONSTRAINT "polls_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "polls_channel_external_id" ON "polls" USING btree ("channel","external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "polls_open" ON "polls" USING btree ("group_id","created_at") WHERE "polls"."resolved_at" is null;
