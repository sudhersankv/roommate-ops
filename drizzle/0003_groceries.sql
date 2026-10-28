CREATE TABLE "cart_checkouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"created_by" uuid,
	"items_snapshot" jsonb NOT NULL,
	"est_cents" integer DEFAULT 0 NOT NULL,
	"instacart_url" text,
	"expense_id" uuid,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"title" text NOT NULL,
	"servings" integer NOT NULL,
	"cooking_time_minutes" integer,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text DEFAULT 'roomie' NOT NULL,
	"created_by" uuid,
	"planned_for" date,
	"instacart_url" text,
	"instacart_url_at" timestamp with time zone,
	"instacart_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "quantity" numeric;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "unit" text;--> statement-breakpoint
ALTER TABLE "cart_items" ADD COLUMN "recipe_id" uuid;--> statement-breakpoint
ALTER TABLE "cart_checkouts" ADD CONSTRAINT "cart_checkouts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_checkouts" ADD CONSTRAINT "cart_checkouts_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_checkouts" ADD CONSTRAINT "cart_checkouts_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_checkouts_group_created_at" ON "cart_checkouts" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "recipes_group_created_at" ON "recipes" USING btree ("group_id","created_at");--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE set null ON UPDATE no action;