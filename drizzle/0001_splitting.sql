CREATE TABLE "expense_external_refs" (
	"expense_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_payers" (
	"expense_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"cents" integer NOT NULL,
	CONSTRAINT "expense_payers_expense_id_member_id_pk" PRIMARY KEY("expense_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement_external_refs" (
	"settlement_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "splitwise_links" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"connected_by" uuid,
	"splitwise_group_id" text,
	"splitwise_group_name" text,
	"mode" text,
	"member_map" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_splits" ADD COLUMN "weight" numeric;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "category" text DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "occurred_on" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "split_method" text DEFAULT 'equal' NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurring" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "recurring_parent_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "receipt_url" text;--> statement-breakpoint
ALTER TABLE "expense_external_refs" ADD CONSTRAINT "expense_external_refs_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payers" ADD CONSTRAINT "expense_payers_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_payers" ADD CONSTRAINT "expense_payers_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_jobs" ADD CONSTRAINT "outbox_jobs_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_external_refs" ADD CONSTRAINT "settlement_external_refs_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "splitwise_links" ADD CONSTRAINT "splitwise_links_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "splitwise_links" ADD CONSTRAINT "splitwise_links_connected_by_members_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_external_refs_external" ON "expense_external_refs" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_external_refs_expense" ON "expense_external_refs" USING btree ("expense_id","provider");--> statement-breakpoint
CREATE INDEX "outbox_jobs_due" ON "outbox_jobs" USING btree ("run_after") WHERE "outbox_jobs"."done_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_external_refs_external" ON "settlement_external_refs" USING btree ("provider","external_id");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recurring_parent_id_expenses_id_fk" FOREIGN KEY ("recurring_parent_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurring_copy" ON "expenses" USING btree ("recurring_parent_id","occurred_on") WHERE "expenses"."recurring_parent_id" is not null;--> statement-breakpoint
-- Backfill (step 5): every existing Expense had one Payer who paid all of it.
INSERT INTO "expense_payers" ("expense_id", "member_id", "cents") SELECT "id", "payer_id", "cents" FROM "expenses" ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "expenses" e SET "occurred_on" = (e."created_at" AT TIME ZONE g."timezone")::date FROM "groups" g WHERE g."id" = e."group_id";--> statement-breakpoint
UPDATE "expenses" SET "split_method" = 'exact' WHERE "source" = 'cart';--> statement-breakpoint
UPDATE "expenses" SET "category" = CASE
  WHEN "source" = 'cart' OR "description" ~* 'grocer|costco|trader|market|ingredient|milk|eggs' THEN 'groceries'
  WHEN "description" ~* '\mrent\M' THEN 'rent'
  WHEN "description" ~* 'internet|wifi|electric|power|water|utilit|gas bill|phone' THEN 'utilities'
  WHEN "description" ~* 'pizza|brunch|dinner|lunch|breakfast|restaurant|taco|sushi|takeout|coffee|food' THEN 'food'
  WHEN "description" ~* 'clean|towel|soap|toilet|detergent|supplies|trash bag|furniture' THEN 'household'
  WHEN "description" ~* 'ticket|movie|concert|game|snack|party|\mbar\M' THEN 'entertainment'
  WHEN "description" ~* 'uber|lyft|taxi|\mcab\M|train|\mbus\M|parking|\mgas\M' THEN 'transport'
  WHEN "description" ~* 'flight|hotel|airbnb' THEN 'travel'
  WHEN "description" ~* 'pharmacy|doctor|medic' THEN 'health'
  ELSE 'other' END;