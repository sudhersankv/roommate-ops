-- Grocery usuals (#36, combined with #62): only what someone told Roomie; the rest is derived from Cart history.
-- Idempotent, and brings dev's earlier grocery_usuals (brand / source / last_used_at) to this shape.
CREATE TABLE IF NOT EXISTS "grocery_usuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"item" text NOT NULL,
	"member_id" uuid,
	"name" text NOT NULL,
	"qty" text NOT NULL,
	"quantity" numeric,
	"unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Rows learned from purchases are history now (cart-usuals.ts), not something anyone said.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'grocery_usuals' AND column_name = 'source') THEN
    DELETE FROM "grocery_usuals" WHERE "source" = 'purchase';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "grocery_usuals" DROP COLUMN IF EXISTS "brand";--> statement-breakpoint
ALTER TABLE "grocery_usuals" DROP COLUMN IF EXISTS "source";--> statement-breakpoint
ALTER TABLE "grocery_usuals" DROP COLUMN IF EXISTS "last_used_at";--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grocery_usuals_group_id_groups_id_fk') THEN
    ALTER TABLE "grocery_usuals" ADD CONSTRAINT "grocery_usuals_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grocery_usuals_member_id_members_id_fk') THEN
    ALTER TABLE "grocery_usuals" ADD CONSTRAINT "grocery_usuals_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "grocery_usuals_one" ON "grocery_usuals" USING btree ("group_id","item",coalesce("member_id", '00000000-0000-0000-0000-000000000000'::uuid));
