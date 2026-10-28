// Money: Expenses, Shares, Balances, settling up. Integer cents everywhere (ADR 0007).
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { record } from "./activity";
import { canChangeExpense, NotAllowedError, requireActive } from "./authz";
import { listMembers } from "./members";
import { splitEvenly, type SplitRow } from "./split";
import { dollars, type Ctx, type GroupCtx } from "./types";

const { expenses, expenseSplits, settlements, members } = schema;

export type Balance = { memberId: string; name: string; cents: number }; // + = is owed, - = owes
export type Transfer = { fromId: string; fromName: string; toId: string; toName: string; cents: number };
export type ExpenseSplit = { memberId: string; name: string; cents: number };
export type Expense = {
  id: string;
  payerName: string;
  cents: number;
  description: string;
  createdAt: Date;
  payerId?: string;
  createdBy?: string | null;
  source?: "chat" | "ui" | "cart";
  splits?: ExpenseSplit[];
};
export { splitEvenly, type SplitRow } from "./split";

/* ---------- pure helpers (unit-tested in money.test.ts) ---------- */

/**
 * Minimal-ish set of transfers that zeroes all balances. Greedy: the biggest debtor pays the
 * biggest creditor min(debt, credit), repeat. Balances are integer cents, so "< 1 cent" means zero
 * and is skipped. Ties break by name so the output is deterministic.
 */
export function computeSettlePlan(balances: Balance[]): Transfer[] {
  const byName = (a: Balance, b: Balance) => a.name.localeCompare(b.name);
  const debtors = balances
    .filter((b) => b.cents <= -1)
    .map((b) => ({ ...b, cents: -b.cents }))
    .sort((a, b) => b.cents - a.cents || byName(a, b));
  const creditors = balances
    .filter((b) => b.cents >= 1)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.cents - a.cents || byName(a, b));

  const plan: Transfer[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const d = debtors[i];
    const c = creditors[j];
    const cents = Math.min(d.cents, c.cents);
    plan.push({ fromId: d.memberId, fromName: d.name, toId: c.memberId, toName: c.name, cents });
    d.cents -= cents;
    c.cents -= cents;
    if (d.cents === 0) i++;
    if (c.cents === 0) j++;
    // Re-sort the remaining tails so we always pair the current biggest with the current biggest.
    // (Each side is already sorted and only its head shrank, so a bubble-down is enough.)
    bubbleDown(debtors, i);
    bubbleDown(creditors, j);
  }
  return plan;
}

function bubbleDown(arr: { cents: number; name: string }[], from: number) {
  for (let k = from; k + 1 < arr.length && arr[k].cents < arr[k + 1].cents; k++) {
    [arr[k], arr[k + 1]] = [arr[k + 1], arr[k]];
  }
}

/* ---------- services ---------- */

function assertWholeCents(cents: number, what = "Amount") {
  if (!Number.isInteger(cents)) throw new Error(`${what} must be whole cents (got ${cents}).`);
  if (cents <= 0) throw new Error(`${what} must be more than $0.00.`);
}

type ExpenseInput = { payerId?: string; cents: number; description: string; splitAmong?: string[]; splits?: SplitRow[]; source?: "ui" | "chat" | "cart" };

/** Validates an Expense against the Group's active Members and returns its Share rows. */
async function shareRows(ctx: Ctx, input: ExpenseInput) {
  assertWholeCents(input.cents);
  const description = input.description?.trim();
  if (!description) throw new Error("What was it for? Give the expense a description.");

  const people = await listMembers(ctx);
  const byId = new Map(people.map((m) => [m.id, m]));
  const payerId = input.payerId ?? ctx.memberId;
  const payer = byId.get(payerId);
  if (!payer) throw new Error("I don't know who paid. The payer isn't an active member of this group.");

  let rows: SplitRow[];
  if (input.splits) {
    rows = input.splits;
    if (rows.length === 0) throw new Error("Splits can't be empty. Who shares this?");
    const seen = new Set<string>();
    for (const r of rows) {
      if (!byId.has(r.memberId)) throw new Error(`Can't split with ${r.memberId}: not an active member here.`);
      if (seen.has(r.memberId)) throw new Error(`${byId.get(r.memberId)!.displayName} appears twice in the split.`);
      seen.add(r.memberId);
      if (!Number.isInteger(r.cents) || r.cents < 0) throw new Error(`Bad split for ${byId.get(r.memberId)!.displayName}: ${r.cents} cents.`);
    }
    const sum = rows.reduce((s, r) => s + r.cents, 0);
    if (sum !== input.cents) {
      throw new Error(`Splits add up to ${dollars(sum)} but the expense is ${dollars(input.cents)}. They have to match.`);
    }
  } else {
    const among = input.splitAmong ?? people.map((m) => m.id);
    if (among.length === 0) throw new Error("Nobody to split with. Add some members first.");
    const unknown = among.find((id) => !byId.has(id));
    if (unknown) throw new Error(`Can't split with ${unknown}: not an active member here.`);
    rows = splitEvenly(input.cents, among, payerId);
  }
  return { rows, payerId, payer, description, byId };
}

/**
 * Record a shared Expense. payerId defaults to ctx.memberId.
 * - `splits` (explicit rows) wins when provided; they must sum to `cents`. cart.ts uses this for weighted splits.
 * - Otherwise `splitAmong` (member ids; default = everyone active) is split evenly, remainder cents to the payer first.
 */
export async function logExpense(ctx: Ctx, input: ExpenseInput): Promise<Expense> {
  await requireActive(ctx);
  const { rows, payerId, payer, description, byId } = await shareRows(ctx, input);
  const source = input.source ?? (ctx.source === "ui" ? "ui" : "chat");
  const created = await db.transaction(async (tx) => {
    const [e] = await tx
      .insert(expenses)
      .values({ groupId: ctx.groupId, payerId, cents: input.cents, description, source, createdBy: ctx.memberId })
      .returning();
    await tx.insert(expenseSplits).values(rows.map((r) => ({ expenseId: e.id, memberId: r.memberId, cents: r.cents })));
    return e;
  });
  await record(ctx.groupId, ctx.memberId, "expense.added", `added ${description}, ${dollars(input.cents)}`, { table: "expenses", id: created.id });

  return {
    id: created.id,
    payerId,
    payerName: payer.displayName,
    cents: created.cents,
    description: created.description,
    createdAt: created.createdAt,
    createdBy: created.createdBy,
    source: created.source,
    splits: rows.map((r) => ({ memberId: r.memberId, name: byId.get(r.memberId)!.displayName, cents: r.cents })),
  };
}

/** The Expense plus the ownership check: added it, paid it, has a Share in it, or Admin. */
async function changeable(ctx: Ctx, expenseId: string, opts: { deleted?: boolean } = {}) {
  const actor = await requireActive(ctx);
  const [e] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, ctx.groupId), opts.deleted ? sql`${expenses.deletedAt} is not null` : isNull(expenses.deletedAt)));
  if (!e) throw new Error("That expense isn't here anymore.");
  const participants = await db.select({ id: expenseSplits.memberId }).from(expenseSplits).where(eq(expenseSplits.expenseId, e.id));
  if (!canChangeExpense(actor, { createdBy: e.createdBy, payerId: e.payerId, participantIds: participants.map((p) => p.id) })) {
    throw new NotAllowedError(`Only someone in "${e.description}" (or an admin) can change it.`, "not-yours");
  }
  return e;
}

/** Change an Expense's amount, description, payer or (equal) split. Same rules as logExpense. */
export async function updateExpense(ctx: Ctx, input: { expenseId: string } & ExpenseInput): Promise<Expense> {
  const before = await changeable(ctx, input.expenseId);
  const { rows, payerId, payer, description, byId } = await shareRows(ctx, input);
  await db.transaction(async (tx) => {
    await tx.update(expenses).set({ payerId, cents: input.cents, description }).where(eq(expenses.id, before.id));
    await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, before.id));
    await tx.insert(expenseSplits).values(rows.map((r) => ({ expenseId: before.id, memberId: r.memberId, cents: r.cents })));
  });
  await record(ctx.groupId, ctx.memberId, "expense.changed", `changed ${description}`, { table: "expenses", id: before.id });
  return {
    id: before.id,
    payerId,
    payerName: payer.displayName,
    cents: input.cents,
    description,
    createdAt: before.createdAt,
    createdBy: before.createdBy,
    source: before.source,
    splits: rows.map((r) => ({ memberId: r.memberId, name: byId.get(r.memberId)!.displayName, cents: r.cents })),
  };
}

/** Soft delete, so undo can bring it back. */
export async function deleteExpense(ctx: Ctx, input: { expenseId: string }): Promise<void> {
  const e = await changeable(ctx, input.expenseId);
  await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, e.id));
  await record(ctx.groupId, ctx.memberId, "expense.deleted", `deleted ${e.description}`, { table: "expenses", id: e.id });
}

export async function restoreExpense(ctx: Ctx, input: { expenseId: string }): Promise<void> {
  const e = await changeable(ctx, input.expenseId, { deleted: true });
  await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, e.id));
  await record(ctx.groupId, ctx.memberId, "expense.restored", `restored ${e.description}`, { table: "expenses", id: e.id });
}

/**
 * Per Member: paid - owed + settlements sent - settlements received. Positive = is owed.
 * Active Members are always listed (zero included); anyone removed stays while they still owe or are owed, so
 * balances always net to zero. Sorted by balance descending, then by name.
 */
export async function getBalances(ctx: GroupCtx): Promise<Balance[]> {
  const gid = ctx.groupId;
  const live = and(eq(expenses.groupId, gid), isNull(expenses.deletedAt));
  const [paid, owed, sent, received, everyone] = await Promise.all([
    db.select({ id: expenses.payerId, cents: sql<number>`coalesce(sum(${expenses.cents}), 0)::int` }).from(expenses).where(live).groupBy(expenses.payerId),
    db
      .select({ id: expenseSplits.memberId, cents: sql<number>`coalesce(sum(${expenseSplits.cents}), 0)::int` })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
      .where(live)
      .groupBy(expenseSplits.memberId),
    db
      .select({ id: settlements.fromId, cents: sql<number>`coalesce(sum(${settlements.cents}), 0)::int` })
      .from(settlements)
      .where(eq(settlements.groupId, gid))
      .groupBy(settlements.fromId),
    db
      .select({ id: settlements.toId, cents: sql<number>`coalesce(sum(${settlements.cents}), 0)::int` })
      .from(settlements)
      .where(eq(settlements.groupId, gid))
      .groupBy(settlements.toId),
    db.select({ id: members.id, name: members.displayName, status: members.status }).from(members).where(eq(members.groupId, gid)),
  ]);

  const tally = new Map<string, number>();
  const add = (rows: { id: string; cents: number }[], sign: 1 | -1) => {
    for (const r of rows) tally.set(r.id, (tally.get(r.id) ?? 0) + sign * Number(r.cents));
  };
  add(paid, 1);
  add(owed, -1);
  add(sent, 1);
  add(received, -1);

  return everyone
    .filter((m) => m.status === "active" || (tally.get(m.id) ?? 0) !== 0)
    .map((m) => ({ memberId: m.id, name: m.status === "removed" ? `${m.name} (moved out)` : m.name, cents: tally.get(m.id) ?? 0 }))
    .sort((a, b) => b.cents - a.cents || a.name.localeCompare(b.name));
}

export async function getSettlePlan(ctx: GroupCtx): Promise<Transfer[]> {
  return computeSettlePlan(await getBalances(ctx));
}

/** Record that `from` paid `to` back. fromId defaults to ctx.memberId. */
export async function settleUp(ctx: Ctx, input: { fromId?: string; toId: string; cents: number }): Promise<void> {
  await requireActive(ctx);
  assertWholeCents(input.cents, "Payment");
  const fromId = input.fromId ?? ctx.memberId;
  if (fromId === input.toId) throw new Error("Paying yourself back doesn't count.");
  const people = await listMembers(ctx);
  const byId = new Map(people.map((m) => [m.id, m.displayName]));
  if (!byId.has(fromId)) throw new Error("The payer isn't an active member of this group.");
  if (!byId.has(input.toId)) throw new Error("The person being paid isn't an active member of this group.");
  const [s] = await db.insert(settlements).values({ groupId: ctx.groupId, fromId, toId: input.toId, cents: input.cents }).returning();
  const summary = fromId === ctx.memberId ? `paid ${byId.get(input.toId)} ${dollars(input.cents)}` : `recorded ${byId.get(fromId)} paying ${byId.get(input.toId)} ${dollars(input.cents)}`;
  await record(ctx.groupId, ctx.memberId, "settlement.added", summary, { table: "settlements", id: s.id });
}

/** Newest first, with payer name and per-person splits. Deleted Expenses are left out. */
export async function listExpenses(ctx: GroupCtx, limit = 50, opts: { expenseId?: string } = {}): Promise<Expense[]> {
  const rows = await db
    .select({
      id: expenses.id,
      payerId: expenses.payerId,
      payerName: members.displayName,
      cents: expenses.cents,
      description: expenses.description,
      createdAt: expenses.createdAt,
      createdBy: expenses.createdBy,
      source: expenses.source,
    })
    .from(expenses)
    .innerJoin(members, eq(expenses.payerId, members.id))
    .where(and(eq(expenses.groupId, ctx.groupId), isNull(expenses.deletedAt), opts.expenseId ? eq(expenses.id, opts.expenseId) : undefined))
    .orderBy(desc(expenses.createdAt), desc(expenses.id))
    .limit(limit);
  if (rows.length === 0) return [];

  const splitRows = await db
    .select({ expenseId: expenseSplits.expenseId, memberId: expenseSplits.memberId, name: members.displayName, cents: expenseSplits.cents })
    .from(expenseSplits)
    .innerJoin(members, eq(expenseSplits.memberId, members.id))
    .where(inArray(expenseSplits.expenseId, rows.map((r) => r.id)));
  const splitsByExpense = new Map<string, ExpenseSplit[]>();
  for (const s of splitRows) {
    const list = splitsByExpense.get(s.expenseId) ?? [];
    list.push({ memberId: s.memberId, name: s.name, cents: s.cents });
    splitsByExpense.set(s.expenseId, list);
  }
  return rows.map((r) => ({ ...r, splits: splitsByExpense.get(r.id) ?? [] }));
}

export async function getExpense(ctx: GroupCtx, expenseId: string): Promise<Expense | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(expenseId)) return undefined;
  return (await listExpenses(ctx, 1, { expenseId }))[0];
}
