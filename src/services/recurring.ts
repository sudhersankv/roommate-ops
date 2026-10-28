// Recurring Expenses: the scheduler copies a monthly or weekly Expense on each due day, with the same Payers and
// Shares. A copy points at its parent (recurring_parent_id) and the (parent, day) pair is unique, so running the job
// twice, or after a copy was deleted, never makes a second copy for the same period.
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Recurrence } from "@/db/enums";
import { localDay } from "@/lib/dates";
import { record } from "./activity";
import { insertExpenseRows, listExpenses } from "./money";
import { dollars } from "./types";

const { expenses, groups } = schema;

const at = (day: string) => new Date(`${day}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The most recent day a copy is due: after `start`, on or before `today`. Monthly repeats on the start's day of the
 * month, clamped to 28 so every month has it; weekly on the same weekday. Null when nothing is due yet.
 */
export function latestOccurrence(start: string, rule: Recurrence, today: string): string | null {
  if (today <= start) return null;
  if (rule === "weekly") {
    const days = Math.round((at(today).getTime() - at(start).getTime()) / 86_400_000);
    if (days < 7) return null;
    const d = at(start);
    d.setUTCDate(d.getUTCDate() + 7 * Math.floor(days / 7));
    return iso(d);
  }
  const dom = Math.min(Number(start.slice(8, 10)), 28);
  const t = at(today);
  let y = t.getUTCFullYear();
  let m = t.getUTCMonth();
  if (t.getUTCDate() < dom) m -= 1;
  if (m < 0) {
    m += 12;
    y -= 1;
  }
  const candidate = iso(new Date(Date.UTC(y, m, dom, 12)));
  return candidate > start ? candidate : null;
}

/** Make today's copies of every due recurring Expense. Returns how many were made. */
export async function runRecurring(now = new Date()): Promise<number> {
  const parents = await db
    .select({ id: expenses.id, groupId: expenses.groupId, occurredOn: expenses.occurredOn, recurring: expenses.recurring, createdBy: expenses.createdBy, tz: groups.timezone })
    .from(expenses)
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .where(and(isNotNull(expenses.recurring), isNull(expenses.deletedAt), isNull(expenses.recurringParentId)));
  let made = 0;
  for (const p of parents) {
    const day = latestOccurrence(p.occurredOn, p.recurring!, localDay(now, p.tz));
    if (!day) continue;
    const [e] = await listExpenses({ groupId: p.groupId }, 1, { expenseId: p.id });
    if (!e?.payers?.length || !e.splits?.length) continue;
    const id = await insertExpenseRows(p.groupId, p.createdBy, {
      cents: e.cents,
      description: e.description,
      method: e.method ?? "equal",
      payers: e.payers.map((x) => ({ memberId: x.memberId, cents: x.cents })),
      rows: e.splits.map((s) => ({ memberId: s.memberId, cents: s.cents })),
      weights: new Map(e.splits.filter((s) => s.weight != null).map((s) => [s.memberId, Number(s.weight)])),
      category: e.category ?? "other",
      note: e.note ?? null,
      occurredOn: day,
      recurring: null,
      receiptUrl: null,
      source: "recurring",
      recurringParentId: p.id,
    });
    if (!id) continue;
    made++;
    await record(p.groupId, null, "expense.repeated", `added ${e.description}, ${dollars(e.cents)} (repeats ${p.recurring})`, { table: "expenses", id });
    const { enqueueSplitwisePush } = await import("./outbox");
    await enqueueSplitwisePush(p.groupId, id, "upsert");
  }
  return made;
}
