-- Lease Inbox and Restock fixes (PR #30 review). Idempotent.
-- mail_events: received vs processed. Events already there were handled under the old rule, so they count as processed.
ALTER TABLE "mail_events" ADD COLUMN IF NOT EXISTS "processed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "mail_events" SET "processed_at" = "created_at" WHERE "processed_at" IS NULL;--> statement-breakpoint
-- mail_messages.reply_to: a forward's original sender, where replies go. New rows get it on insert; older forwards
-- already have the parsed sender in original_from.
ALTER TABLE "mail_messages" ADD COLUMN IF NOT EXISTS "reply_to" text;--> statement-breakpoint
UPDATE "mail_messages" SET "reply_to" = "original_from" WHERE "reply_to" IS NULL AND "original_from" IS NOT NULL;--> statement-breakpoint
-- purchase_events: one per source row, item and scope. Duplicates a retried receipt wrote go first (the oldest stays).
DELETE FROM "purchase_events" p USING "purchase_events" q
  WHERE p."source" = q."source" AND p."source_id" = q."source_id" AND p."item" = q."item"
    AND coalesce(p."member_id", '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(q."member_id", '00000000-0000-0000-0000-000000000000'::uuid)
    AND (p."created_at", p."id") > (q."created_at", q."id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchase_events_once" ON "purchase_events" USING btree ("source","source_id","item",coalesce("member_id", '00000000-0000-0000-0000-000000000000'::uuid));
