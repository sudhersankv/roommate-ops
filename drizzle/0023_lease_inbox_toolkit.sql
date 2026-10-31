-- Lease Inbox Toolkit (#27): a lease or notice Document's text, so ask_lease answers from it. Idempotent.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "text" text;
