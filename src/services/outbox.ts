// The outbox (ADR 0009): writes that must reach another system later. money.ts enqueues a Splitwise push when the
// Group mirrors to Splitwise; the scheduler tick runs due jobs (services/splitwise.ts runSplitwiseOutbox).
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { outboxJobs, splitwiseLinks } = schema;

export const MAX_ATTEMPTS = 6;
export type OutboxJob = typeof outboxJobs.$inferSelect;

/** Queue a push of this Expense to the Group's Splitwise group, if the Group has the live mirror on. */
export async function enqueueSplitwisePush(groupId: string, expenseId: string, op: "upsert" | "delete"): Promise<boolean> {
  const [link] = await db.select({ mode: splitwiseLinks.mode }).from(splitwiseLinks).where(eq(splitwiseLinks.groupId, groupId));
  if (link?.mode !== "mirror") return false;
  await db.insert(outboxJobs).values({ groupId, kind: "splitwise.push", payload: { expenseId, op } });
  return true;
}

/** Due jobs, oldest first. */
export async function dueJobs(now = new Date(), limit = 20): Promise<OutboxJob[]> {
  return db
    .select()
    .from(outboxJobs)
    .where(and(isNull(outboxJobs.doneAt), lte(outboxJobs.runAfter, now), sql`${outboxJobs.attempts} < ${MAX_ATTEMPTS}`))
    .orderBy(asc(outboxJobs.createdAt))
    .limit(limit);
}

export async function markDone(id: string): Promise<void> {
  await db.update(outboxJobs).set({ doneAt: new Date(), lastError: null }).where(eq(outboxJobs.id, id));
}

/** Exponential backoff: 1, 2, 4, 8... minutes. */
export async function markFailed(job: OutboxJob, error: string, now = new Date()): Promise<void> {
  const attempts = job.attempts + 1;
  await db
    .update(outboxJobs)
    .set({ attempts, lastError: error.slice(0, 500), runAfter: new Date(now.getTime() + 60_000 * 2 ** (attempts - 1)) })
    .where(eq(outboxJobs.id, job.id));
}

export async function pendingCount(groupId: string): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(outboxJobs)
    .where(and(eq(outboxJobs.groupId, groupId), isNull(outboxJobs.doneAt), sql`${outboxJobs.attempts} < ${MAX_ATTEMPTS}`));
  return Number(r?.n ?? 0);
}
