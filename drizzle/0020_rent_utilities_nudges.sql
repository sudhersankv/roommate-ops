-- #25: variable recurring Expenses (utilities) and the amounts asked of their Payer. Safe to re-run.
CREATE TABLE IF NOT EXISTS "pending_amounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"period" text NOT NULL,
	"due_on" date NOT NULL,
	"asked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"asks" integer DEFAULT 1 NOT NULL,
	"prefill_cents" integer,
	"resolved_expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "variable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pending_amounts" ADD CONSTRAINT "pending_amounts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pending_amounts" ADD CONSTRAINT "pending_amounts_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "pending_amounts" ADD CONSTRAINT "pending_amounts_resolved_expense_id_expenses_id_fk" FOREIGN KEY ("resolved_expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pending_amounts_expense_period" ON "pending_amounts" USING btree ("expense_id","period");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pending_amounts_group" ON "pending_amounts" USING btree ("group_id");
