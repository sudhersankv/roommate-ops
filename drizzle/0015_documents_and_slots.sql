-- Core slots (#24A, ADR 0017 / 0018): Documents (rows here, bytes in object storage), the receipt's Document on an
-- Expense, pending_posts (what quiet hours held back), and the Bundle's scheduled_posts kind ("chores.nudge" ->
-- "bundle"). Nothing is backfilled: the old public/uploads files don't survive a deploy, so old Expenses keep their
-- receipt_url (now dead) and no Document. Idempotent: every statement can run twice.
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"source" jsonb,
	"uploaded_by" uuid,
	"filed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pending_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"member_id" uuid,
	"text" text NOT NULL,
	"buttons" jsonb,
	"due_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "receipt_document_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_members_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pending_posts" ADD CONSTRAINT "pending_posts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "pending_posts" ADD CONSTRAINT "pending_posts_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_group_created_at" ON "documents" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_posts_due_at" ON "pending_posts" USING btree ("due_at");--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_document_id_documents_id_fk" FOREIGN KEY ("receipt_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
-- The Bundle grew out of the chores nudge and claimed its kind; now it has its own (a day already claimed stays claimed).
UPDATE "scheduled_posts" SET "kind" = 'bundle' WHERE "kind" = 'chores.nudge'
  AND NOT EXISTS (SELECT 1 FROM "scheduled_posts" b WHERE b.group_id = "scheduled_posts".group_id AND b.kind = 'bundle' AND b.period = "scheduled_posts".period);--> statement-breakpoint
DELETE FROM "scheduled_posts" WHERE "kind" = 'chores.nudge';
