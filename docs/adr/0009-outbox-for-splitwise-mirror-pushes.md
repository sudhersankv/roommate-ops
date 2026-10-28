# Splitwise mirror pushes go through an outbox table, run by the scheduler

With the live mirror on, every Expense added, changed or deleted in Roomie is copied to the linked Splitwise group. That copy can't happen inside the request: Composio and Splitwise are slow and sometimes down, and a chat reply or a dashboard save must not wait on them or fail because of them. Next's `after()` would run the push after the response, but only in the request's process and with no retry, so a failed or interrupted push is simply lost.

So `money.ts` writes a row to `outbox_jobs` (`kind = splitwise.push`, the Expense id) in the same call that changes the Expense, and the scheduler's 60-second tick runs due jobs (`services/splitwise.ts runSplitwiseOutbox`). A push reads the Expense as it is now, so a job is idempotent: create when there's no `expense_external_refs` row, update when there is, delete in Splitwise when the Expense is deleted here. A failure records the error and retries with backoff (1, 2, 4... minutes, six attempts); the Settings card shows how many changes are waiting.

## Consequences

- Mirror pushes need the scheduler (`npm run dev`, or anything that calls `tick()`); with `DISABLE_SCHEDULER=1` they wait in the table.
- The outbox is generic enough for other "do this outside the request" work later, but today only Splitwise uses it.
- Pushes are one-way. Changes made in Splitwise never come back (ADR 0004: no two-way sync).
