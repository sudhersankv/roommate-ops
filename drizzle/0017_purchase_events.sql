-- Restock (#26): purchase_events. Idempotent.
CREATE TABLE IF NOT EXISTS "purchase_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"item" text NOT NULL,
	"member_id" uuid,
	"occurred_on" date NOT NULL,
	"source" text NOT NULL,
	"source_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_events_group_id_groups_id_fk') THEN
    ALTER TABLE "purchase_events" ADD CONSTRAINT "purchase_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'purchase_events_member_id_members_id_fk') THEN
    ALTER TABLE "purchase_events" ADD CONSTRAINT "purchase_events_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_events_group_item_day" ON "purchase_events" USING btree ("group_id","item","occurred_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "purchase_events_source" ON "purchase_events" USING btree ("source_id");