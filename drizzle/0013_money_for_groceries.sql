-- Groceries requires Money (ADR 0015, #23): a Group that has Groceries on and Money switched off explicitly gets Money
-- back on, so "I paid 84" never writes an Expense nobody can see. A missing Money row already means on (its default).
-- Idempotent.
UPDATE "group_toolkits" m
SET "enabled" = true
WHERE m."toolkit" = 'splitting'
  AND m."enabled" = false
  AND EXISTS (
    SELECT 1 FROM "group_toolkits" g
    WHERE g."group_id" = m."group_id" AND g."toolkit" = 'groceries' AND g."enabled" = true
  );
