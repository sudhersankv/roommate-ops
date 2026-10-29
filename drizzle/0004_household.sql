CREATE TABLE "scheduled_posts" (
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"period" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduled_posts_group_id_kind_period_pk" PRIMARY KEY("group_id","kind","period")
);
--> statement-breakpoint
ALTER TABLE "chore_logs" ADD COLUMN "skipped" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chores" ADD COLUMN "rotation" jsonb;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "reminders" ADD COLUMN "created_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "scheduled_posts" ADD CONSTRAINT "scheduled_posts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_created_by_members_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;