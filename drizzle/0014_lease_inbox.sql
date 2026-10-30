CREATE TABLE "group_inboxes" (
	"group_id" uuid PRIMARY KEY NOT NULL,
	"inbox_id" text NOT NULL,
	"address" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_inboxes_inbox_id_unique" UNIQUE("inbox_id"),
	CONSTRAINT "group_inboxes_address_unique" UNIQUE("address")
);
--> statement-breakpoint
CREATE TABLE "landlord_senders" (
	"group_id" uuid NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "landlord_senders_group_id_value_pk" PRIMARY KEY("group_id","value")
);
--> statement-breakpoint
CREATE TABLE "mail_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"inbox_id" text NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"from_header" text NOT NULL,
	"from_address" text NOT NULL,
	"original_from" text,
	"forwarded_by" uuid,
	"to" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"html" text,
	"received_at" timestamp with time zone NOT NULL,
	"class" text,
	"trusted" boolean DEFAULT false NOT NULL,
	"summary" text,
	"notice_date" text,
	"amount_cents" integer,
	"utility" text,
	"document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sent_mail" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"member_id" uuid,
	"intent" text NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"instruction" text NOT NULL,
	"summary" text NOT NULL,
	"message_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"work_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"title" text NOT NULL,
	"reported_by" uuid,
	"thread_id" text NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"scheduled_for" text,
	"last_reply" text,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "group_inboxes" ADD CONSTRAINT "group_inboxes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "landlord_senders" ADD CONSTRAINT "landlord_senders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_events" ADD CONSTRAINT "mail_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_messages" ADD CONSTRAINT "mail_messages_forwarded_by_members_id_fk" FOREIGN KEY ("forwarded_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_mail" ADD CONSTRAINT "sent_mail_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_mail" ADD CONSTRAINT "sent_mail_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sent_mail" ADD CONSTRAINT "sent_mail_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_reported_by_members_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_messages_group_message" ON "mail_messages" USING btree ("group_id","message_id");--> statement-breakpoint
CREATE INDEX "mail_messages_group_thread" ON "mail_messages" USING btree ("group_id","thread_id");--> statement-breakpoint
CREATE INDEX "sent_mail_group_thread" ON "sent_mail" USING btree ("group_id","thread_id");--> statement-breakpoint
CREATE INDEX "work_orders_group_thread" ON "work_orders" USING btree ("group_id","thread_id");