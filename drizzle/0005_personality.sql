CREATE TABLE "pet_moments" (
	"group_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pet_moments_group_id_kind_key_pk" PRIMARY KEY("group_id","kind","key")
);
--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "personality" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pet_moments" ADD CONSTRAINT "pet_moments_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;