-- Receipts saved before Documents (0015) pointed at /uploads/... on the machine's own disk (relative, or under APP_URL
-- from chat), which every deploy wipes: the files are gone, so the links go too. Hand-written, idempotent (a second
-- run matches nothing).
UPDATE "expenses" SET "receipt_url" = NULL WHERE "receipt_url" LIKE '/uploads/%' OR "receipt_url" ~ '^https?://[^/]+/uploads/';
