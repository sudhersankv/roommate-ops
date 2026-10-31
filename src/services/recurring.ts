// Recurring Expenses: the scheduler copies a monthly or weekly Expense on each due day, with the same Payers and
// Shares. A copy points at its parent (recurring_parent_id) and the (parent, day) pair is unique, so running the job
// twice, or after a copy was deleted, never makes a second copy for the same period.
//
// A variable parent (utilities, #25) isn't copied: on its due day it writes a pending_amounts row for the month and
// DMs its Payer "How much was the electric bill?", once more the next day, then waits for next month. The answer
// (answerAmount) logs that month as its own Expense, split like the parent. The ask rules are pure (recurring.test.ts).
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ExpenseCategory, Recurrence } from "@/db/enums";
import { localDay } from "@/lib/dates";
import { daysBetweenDays } from "@/lib/time";
import { record } from "./activity";
import { NotAllowedError, requireActive } from "./authz";
import { getExpense, insertExpenseRows, listExpenses, logExpense, todayIn, type Expense, type ExpenseInput } from "./money";
import { mayPost, nextDueOnOrAfter, sendDms, shortMoney } from "./rent";
import { dollars, type Ctx } from "./types";

const { expenses, groups, pendingAmounts } = schema;
type Deliver = Parameters<typeof sendDms>[1];

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

/* ---------- variable Expenses: pure ---------- */

export type AskRow = { asks: number; askedDay: string; resolved: boolean };

/**
 * What a variable monthly parent (first month = `start`) needs today: ask its Payer on the due day (the parent's own
 * day included: it's a template, never charged itself), once more the day after, else nothing. A row with asks 0 was
 * only prefilled (the Lease Inbox read the bill) and still needs its ask. A due day the job missed is asked the next
 * day; later than that the month waits.
 */
export function variableAsk(start: string, today: string, row: AskRow | null): { kind: "ask" | "reask"; dueOn: string } | null {
  if (today < start) return null;
  const dueOn = latestOccurrence(start, "monthly", today) ?? start;
  const late = daysBetweenDays(dueOn, today);
  if (late > 1 || row?.resolved) return null;
  if (!row || row.asks === 0) return { kind: "ask", dueOn };
  if (row.asks >= 2 || row.askedDay === today || late === 0) return null;
  return { kind: "reask", dueOn };
}

const billName = (description: string) => description.trim().replace(/\s+bill$/i, "").toLowerCase();

/** The DM to the Payer. With a prefill: the amount from the bill, to confirm. */
export function amountAskText(description: string, prefillCents: number | null): string {
  const ask = `How much was the ${billName(description)} bill?`;
  return prefillCents ? `${ask} Looks like ${shortMoney(prefillCents)} (from the bill). Right?` : ask;
}

/* ---------- variable Expenses: DB ---------- */

export type VariableInput = Pick<ExpenseInput, "method" | "splitAmong" | "percents" | "shares" | "payerId"> & {
  description: string;
  /** Day of the month the bill is due (past the 28th means the 28th). */
  dueDay: number;
  category?: ExpenseCategory;
};

/** An Expense needs some cents; a variable parent's are a placeholder that Balances skip. */
const PLACEHOLDER_CENTS = 100;

/** "Electric varies, due the 20th, Dev pays": a monthly parent whose amount is asked of its Payer each month. */
export async function setVariableExpense(ctx: Ctx, input: VariableInput): Promise<Expense> {
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 31) throw new Error("Which day of the month is the bill due (1 to 31)?");
  return logExpense(ctx, {
    cents: PLACEHOLDER_CENTS,
    description: input.description,
    category: input.category ?? "utilities",
    recurring: "monthly",
    variable: true,
    occurredOn: nextDueOnOrAfter(input.dueDay, await todayIn(ctx.groupId)),
    ...(input.payerId ? { payerId: input.payerId } : {}),
    ...(input.method ? { method: input.method } : {}),
    ...(input.splitAmong ? { splitAmong: input.splitAmong } : {}),
    ...(input.percents ? { percents: input.percents } : {}),
    ...(input.shares ? { shares: input.shares } : {}),
  });
}

type Parent = { id: string; groupId: string; occurredOn: string; tz: string };

/** Ask (or re-ask) a variable parent's Payer for this month's amount. True when a DM went out. */
async function askVariable(p: Parent, now: Date, deliver?: Deliver): Promise<boolean> {
  const today = localDay(now, p.tz);
  if (today < p.occurredOn) return false;
  const period = (latestOccurrence(p.occurredOn, "monthly", today) ?? p.occurredOn).slice(0, 7);
  const [row] = await db.select().from(pendingAmounts).where(and(eq(pendingAmounts.expenseId, p.id), eq(pendingAmounts.period, period)));
  const next = variableAsk(p.occurredOn, today, row ? { asks: row.asks, askedDay: localDay(row.askedAt, p.tz), resolved: !!row.resolvedExpenseId } : null);
  if (!next || !(await mayPost(p.groupId))) return false;
  const e = await getExpense({ groupId: p.groupId }, p.id);
  const payer = e?.payers?.[0];
  if (!e || !payer) return false;
  // Claim the ask before sending: another process, or the next tick, finds it taken.
  const claimed =
    next.kind === "ask"
      ? await db
          .insert(pendingAmounts)
          .values({ groupId: p.groupId, expenseId: p.id, period, dueOn: next.dueOn, askedAt: now, asks: 1 })
          .onConflictDoUpdate({ target: [pendingAmounts.expenseId, pendingAmounts.period], set: { asks: 1, askedAt: now }, setWhere: sql`${pendingAmounts.asks} = 0` })
          .returning({ prefill: pendingAmounts.prefillCents })
      : await db
          .update(pendingAmounts)
          .set({ asks: 2, askedAt: now })
          .where(and(eq(pendingAmounts.id, row!.id), eq(pendingAmounts.asks, 1), isNull(pendingAmounts.resolvedExpenseId)))
          .returning({ prefill: pendingAmounts.prefillCents });
  if (!claimed.length) return false;
  return (await sendDms([{ memberId: payer.memberId, text: amountAskText(e.description, claimed[0].prefill), buttons: [] }], deliver)) > 0;
}

/** The parent's split, to log a month of it with a new amount. */
function splitIntentOf(parent: Expense): Partial<ExpenseInput> {
  const rows = parent.splits ?? [];
  if (parent.method === "percent") return { method: "percent", percents: rows.map((s) => ({ memberId: s.memberId, percent: Number(s.weight ?? 0) })) };
  if (parent.method === "shares") return { method: "shares", shares: rows.map((s) => ({ memberId: s.memberId, shares: Number(s.weight ?? 0) })) };
  return { method: "equal", splitAmong: rows.map((s) => s.memberId) };
}

/**
 * "92" in reply to the ask (or "roomie electric was 92"): logs the month as its own Expense, split like the parent,
 * paid by the parent's Payer, on the due day. The Payer or an Admin; once per month (a second answer is refused).
 * `expenseId` picks the bill when several are waiting.
 */
export async function answerAmount(ctx: Ctx, input: { expenseId?: string; cents: number }): Promise<{ expense: Expense; parent: Expense }> {
  const actor = await requireActive(ctx);
  if (!Number.isInteger(input.cents) || input.cents <= 0) throw new Error("The amount must be more than $0.00.");
  const rows = await db
    .select({ row: pendingAmounts, description: expenses.description, payerId: expenses.payerId })
    .from(pendingAmounts)
    .innerJoin(expenses, eq(expenses.id, pendingAmounts.expenseId))
    .where(and(eq(pendingAmounts.groupId, ctx.groupId), isNull(expenses.deletedAt), input.expenseId ? eq(pendingAmounts.expenseId, input.expenseId) : undefined))
    .orderBy(desc(pendingAmounts.dueOn));
  const open = rows.filter((r) => !r.row.resolvedExpenseId);
  if (!open.length) {
    const done = rows.find((r) => r.row.resolvedExpenseId);
    if (done) {
      const logged = await getExpense(ctx, done.row.resolvedExpenseId!);
      throw new Error(`The ${billName(done.description)} bill for ${done.row.period} is already logged${logged ? ` (${dollars(logged.cents)})` : ""}.`);
    }
    throw new Error("No bill is waiting for an amount right now.");
  }
  const mine = open.filter((r) => actor.role === "admin" || r.payerId === actor.id);
  if (!mine.length) {
    const parent = await getExpense(ctx, open[0].row.expenseId);
    throw new NotAllowedError(`Only ${parent?.payerName ?? "whoever pays it"} (who pays the ${billName(open[0].description)} bill) or an admin can say how much it was.`, "not-yours");
  }
  const bills = [...new Set(mine.map((r) => r.row.expenseId))];
  if (bills.length > 1) throw new Error(`Which bill? ${[...new Set(mine.map((r) => billName(r.description)))].join(" or ")}?`);
  const { row } = mine[0];
  const parent = (await getExpense(ctx, row.expenseId))!;
  let expense: Expense;
  try {
    expense = await logExpense(ctx, {
      cents: input.cents,
      description: parent.description,
      category: parent.category,
      occurredOn: row.dueOn,
      payerId: parent.payers?.[0]?.memberId ?? parent.payerId,
      recurringParentId: parent.id,
      source: "recurring",
      ...splitIntentOf(parent),
    });
  } catch (e) {
    if (e instanceof Error && /already logged/.test(e.message)) throw new Error(`The ${billName(parent.description)} bill for ${row.period} is already logged.`);
    throw e;
  }
  await db.update(pendingAmounts).set({ resolvedExpenseId: expense.id }).where(and(eq(pendingAmounts.id, row.id), isNull(pendingAmounts.resolvedExpenseId)));
  return { expense, parent };
}

/**
 * The Lease Inbox read a bill: the variable parent whose description matches `matchText` (case-insensitive, either
 * way round: "electric" or "ComEd electric bill") gets the amount as its month's prefill, so the ask only confirms.
 * A month already waiting first; else the next due month (a row with asks 0). Returns the parent, or null when none
 * matches.
 */
export async function prefillAmount(groupId: string, matchText: string, cents: number): Promise<Expense | null> {
  const text = billName(matchText);
  if (!Number.isInteger(cents) || cents <= 0 || !text) return null;
  const parents = await db
    .select({ id: expenses.id, description: expenses.description, occurredOn: expenses.occurredOn, tz: groups.timezone })
    .from(expenses)
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .where(and(eq(expenses.groupId, groupId), eq(expenses.variable, true), isNull(expenses.deletedAt), isNull(expenses.recurringParentId)));
  const hit =
    parents.find((p) => billName(p.description) === text) ??
    parents.find((p) => text.includes(billName(p.description))) ??
    parents.find((p) => billName(p.description).includes(text));
  if (!hit) return null;
  const [waiting] = await db
    .select({ id: pendingAmounts.id })
    .from(pendingAmounts)
    .where(and(eq(pendingAmounts.expenseId, hit.id), isNull(pendingAmounts.resolvedExpenseId)))
    .orderBy(desc(pendingAmounts.dueOn))
    .limit(1);
  if (waiting) await db.update(pendingAmounts).set({ prefillCents: cents }).where(eq(pendingAmounts.id, waiting.id));
  else {
    const today = localDay(new Date(), hit.tz);
    const dueOn = nextDueOnOrAfter(Number(hit.occurredOn.slice(8, 10)), today > hit.occurredOn ? today : hit.occurredOn);
    await db
      .insert(pendingAmounts)
      .values({ groupId, expenseId: hit.id, period: dueOn.slice(0, 7), dueOn, asks: 0, prefillCents: cents })
      .onConflictDoUpdate({ target: [pendingAmounts.expenseId, pendingAmounts.period], set: { prefillCents: cents }, setWhere: isNull(pendingAmounts.resolvedExpenseId) });
  }
  return (await getExpense({ groupId }, hit.id)) ?? null;
}

/** Variable bills asked and not answered yet (the dashboard's marker). */
export async function waitingAmounts(groupId: string): Promise<{ expenseId: string; period: string; dueOn: string }[]> {
  return db
    .select({ expenseId: pendingAmounts.expenseId, period: pendingAmounts.period, dueOn: pendingAmounts.dueOn })
    .from(pendingAmounts)
    .where(and(eq(pendingAmounts.groupId, groupId), isNull(pendingAmounts.resolvedExpenseId), sql`${pendingAmounts.asks} > 0`));
}

/* ---------- the job ---------- */

/**
 * Make today's copies of every due recurring Expense, and ask for the variable ones' amounts. Returns how many copies
 * were made. `deliver` is for tests (default: the Member's Channel).
 */
export async function runRecurring(now = new Date(), deliver?: Deliver): Promise<number> {
  const parents = await db
    .select({ id: expenses.id, groupId: expenses.groupId, occurredOn: expenses.occurredOn, recurring: expenses.recurring, variable: expenses.variable, createdBy: expenses.createdBy, tz: groups.timezone })
    .from(expenses)
    .innerJoin(groups, eq(groups.id, expenses.groupId))
    .where(and(isNotNull(expenses.recurring), isNull(expenses.deletedAt), isNull(expenses.recurringParentId)));
  let made = 0;
  for (const p of parents) {
    if (p.variable) {
      await askVariable(p, now, deliver).catch((e) => console.error(`[recurring] asking for ${p.id} failed`, e));
      continue;
    }
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
