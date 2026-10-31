-- The dashboard dock's two Tricks per Member (#46): null = the first two learned by nav order. Idempotent.
ALTER TABLE "members" ADD COLUMN IF NOT EXISTS "dock" text[];