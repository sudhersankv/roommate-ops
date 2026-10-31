// Money: Expenses (any split method, one or more Payers), Balances, the Settle plan, settling up. Integer cents
// everywhere (ADR 0007): the model passes intent (percents, shares, who was in), never per-person cents it worked out.
import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ExpenseCategory, ExpenseSource, Recurrence, SplitMethod } from "@/db/enums";
import { localDay } from "@/lib/dates";
import { recordFor } from "./activity";
import { canChangeExpense, NotAllowedError, requireActive } from "./authz";
import { guessCategory, isCategory } from "./categories";
import { attachReceipt, docIdFromUrl, receiptHref } from "./documents";
import { listMembers } from "./members";
import { enqueueSplitwisePush } from "./outbox";
import type { ReportPart } from "./report";
import { checkPayers, computeShares, SplitError, type PayerRow, type PercentRow, type SharesRow, type SplitIntent, type SplitRow } from "./split";
import { currencyOf } from "./groups";
import { moneyIn, type Ctx, type GroupCtx } from "./types";

const { expenses, expensePayers, expenseSplits, expenseExternalRefs, settlements, members, groups } = schema;

export type Balance = { memberId: string; name: string; cents: number }; // + = is owed, - = owes
export type Transfer = { fromId: string; fromName: string; toId: string; toName: string; cents: number };
export type ExpenseSplit = { memberId: string; name: string; cents: number; weight?: number | null };
export type ExpensePayer = { memberId: string; name: string; cents: number };
export type Expense = {
  id: string;
  /** The primary Payer (paid the most). */
  payerName: string;
  cents: number;
  description: string;
  createdAt: Date;
  payerId?: string;
  createdBy?: string | null;
  source?: ExpenseSource;
  splits?: ExpenseSplit[];
  payers?: ExpensePayer[];
  method?: SplitMethod;
  category?: ExpenseCategory;
  note?: string | null;
  occurredOn?: string;
  recurring?: Recurrence | null;
  recurringParentId?: string | null;
  /** A recurring parent whose amount is asked on each due day (utilities); its own cents are 0, never owed. */
  variable?: boolean;
  receiptUrl?: string | null;
  /** The receipt's Document (open it at receiptUrl, /api/docs/<id>). */
  receiptDocumentId?: string | null;
  splitwiseId?: string | null;
  deletedAt?: Date | null;
};
export { splitEvenly, splitExact, splitPercent, splitShares, checkPayers, SplitError, type SplitRow } from "./split";

/* ---------- pure helpers (unit-tested in money.test.ts) ---------- */

/**
 * Simplified debts: a minimal-ish set of transfers that zeroes all balances. Greedy: the biggest debtor pays the
 * biggest creditor min(debt, credit), repeat. Balances are integer cents, so "< 1 cent" means zero and is skipped.
 * Ties break by name so the output is deterministic.
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

export type LedgerExpense = { payers: { memberId: string; cents: number }[]; shares: { memberId: string; cents: number }[] };
export type LedgerSettlement = { fromId: string; toId: string; cents: number };

/**
 * Pairwise debts (simplify debts off): A owes B exactly what their shared Expenses imply. Within one Expense, each
 * Share is owed to the Payers in proportion to what they paid (computeSettlePlan on that Expense's nets, so it's
 * deterministic and whole cents); then every pair is netted across Expenses and Settlements.
 */
export function computePairwiseDebts(ledger: LedgerExpense[], paid: LedgerSettlement[], nameOf: (id: string) => string): Transfer[] {
  const owes = new Map<string, number>(); // "from|to" -> cents from owes to
  const bump = (from: string, to: string, cents: number) => {
    if (from === to || cents === 0) return;
    const [a, b] = from < to ? [from, to] : [to, from];
    const key = `${a}|${b}`;
    owes.set(key, (owes.get(key) ?? 0) + (from === a ? cents : -cents));
  };
  for (const e of ledger) {
    const net = new Map<string, number>();
    for (const p of e.payers) net.set(p.memberId, (net.get(p.memberId) ?? 0) + p.cents);
    for (const s of e.shares) net.set(s.memberId, (net.get(s.memberId) ?? 0) - s.cents);
    const balances = [...net].map(([memberId, cents]) => ({ memberId, name: nameOf(memberId), cents }));
    for (const t of computeSettlePlan(balances)) bump(t.fromId, t.toId, t.cents);
  }
  for (const s of paid) bump(s.fromId, s.toId, -s.cents);
  const out: Transfer[] = [];
  for (const [key, cents] of owes) {
    if (cents === 0) continue;
    const [a, b] = key.split("|");
    const [from, to] = cents > 0 ? [a, b] : [b, a];
    out.push({ fromId: from, fromName: nameOf(from), toId: to, toName: nameOf(to), cents: Math.abs(cents) });
  }
  return out.sort((x, y) => y.cents - x.cents || x.fromName.localeCompare(y.fromName) || x.toName.localeCompare(y.toName));
}

/* ---------- building an Expense ---------- */

export type ExpenseInput = {
  cents: number;
  description: string;
  /** Inferred when omitted: splits -> exact, percents -> percent, shares -> shares, else equal. */
  method?: SplitMethod;
  /** equal: member ids (default: everyone active). */
  splitAmong?: string[];
  /** exact: cents per member; must add up to `cents`. */
  splits?: SplitRow[];
  /** percent: must add up to 100. */
  percents?: PercentRow[];
  /** shares: any positive numbers ("2:2:1"). */
  shares?: SharesRow[];
  /** One Payer for the whole amount (default: the sender). Ignored when `payers` is given. */
  payerId?: string;
  /** Several Payers; must add up to `cents`. */
  payers?: PayerRow[];
  category?: ExpenseCategory;
  note?: string | null;
  /** "YYYY-MM-DD"; default today in the Group's time zone. */
  occurredOn?: string;
  recurring?: Recurrence | null;
  /** A variable recurring parent (utilities): the amount is asked of its Payer on each due day. */
  variable?: boolean;
  /** The parent this Expense is a month of (a variable parent's answered amount). */
  recurringParentId?: string;
  receiptUrl?: string | null;
  source?: ExpenseSource;
};

export type BuiltExpense = {
  cents: number;
  description: string;
  method: SplitMethod;
  payers: PayerRow[]; // biggest first
  rows: SplitRow[];
  weights: Map<string, number>;
  category: ExpenseCategory;
  note: string | null;
  occurredOn: string;
  recurring: Recurrence | null;
  receiptUrl: string | null;
};

function assertWholeCents(cents: number, what = "Amount") {
  if (!Number.isInteger(cents)) throw new Error(`${what} must be whole cents (got ${cents}).`);
  if (cents <= 0) throw new Error(`${what} must be more than $0.00.`);
}

export function inferMethod(input: Pick<ExpenseInput, "method" | "splits" | "percents" | "shares">): SplitMethod {
  return input.method ?? (input.splits ? "exact" : input.percents ? "percent" : input.shares ? "shares" : "equal");
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function checkDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (!DAY.test(day) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day) throw new Error(`"${day}" isn't a date like 2026-10-28.`);
  return day;
}

async function groupTz(groupId: string): Promise<string> {
  const [g] = await db.select({ tz: groups.timezone }).from(groups).where(eq(groups.id, groupId));
  return g?.tz ?? "America/Chicago";
}

export const todayIn = async (groupId: string) => localDay(new Date(), await groupTz(groupId));

/** Validates an Expense against the Group's active Members and works out every Share. */
async function build(ctx: Ctx, input: ExpenseInput): Promise<BuiltExpense & { nameOf: (id: string) => string; amount: (cents: number) => string }> {
  // A variable parent has no amount of its own (0 cents): each month is its own Expense. Its rows keep who's in and the weights.
  if (input.variable) {
    if (input.cents !== 0) throw new Error("A bill that varies has no amount of its own; each month's amount is asked on the due day.");
  } else assertWholeCents(input.cents);
  const description = input.description?.trim();
  if (!description) throw new Error("What was it for? Give the expense a description.");

  const people = await listMembers(ctx);
  const currency = await currencyOf(ctx.groupId);
  const amount = moneyIn(currency);
  const byId = new Map(people.map((m) => [m.id, m]));
  const nameOf = (id: string) => byId.get(id)?.displayName ?? id;
  const known = (id: string, role: string) => {
    if (!byId.has(id)) throw new Error(role === "payer" ? "I don't know who paid. The payer isn't an active member of this group." : `Can't split with ${id}: not an active member here.`);
  };

  const payerList = input.payers?.length ? input.payers : [{ memberId: input.payerId ?? ctx.memberId, cents: input.cents }];
  for (const p of payerList) known(p.memberId, "payer");
  if (input.variable && payerList.length > 1) throw new SplitError("A bill that varies has one payer. Who pays it?");
  const payers = input.variable ? [{ memberId: payerList[0].memberId, cents: 0 }] : checkPayers(input.cents, payerList, nameOf, currency);
  const tie = { payerIds: payers.map((p) => p.memberId), nameOf, currency };

  const method = inferMethod(input);
  let intent: SplitIntent;
  if (method === "equal") intent = { method, among: input.splitAmong ?? people.map((m) => m.id) };
  else if (method === "exact") intent = { method, splits: input.splits ?? [] };
  else if (method === "percent") intent = { method, percents: input.percents ?? [] };
  else intent = { method, shares: input.shares ?? [] };
  const ids = intent.method === "equal" ? intent.among : intent.method === "exact" ? intent.splits.map((r) => r.memberId) : intent.method === "percent" ? intent.percents.map((r) => r.memberId) : intent.shares.map((r) => r.memberId);
  for (const id of ids) known(id, "share");
  const { rows, weights } = computeShares(input.cents, intent, tie);
  if (rows.length === 0) throw new SplitError("Nobody ends up with a share. Who's in this one?");

  return {
    cents: input.cents,
    description,
    method,
    payers,
    rows,
    weights,
    category: isCategory(input.category) ? input.category : guessCategory(description, input.source),
    note: input.note?.trim() ? input.note.trim().slice(0, 500) : null,
    occurredOn: input.occurredOn ? checkDay(input.occurredOn) : await todayIn(ctx.groupId),
    recurring: input.recurring ?? null,
    receiptUrl: input.receiptUrl ?? null,
    nameOf,
    amount,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function writeShares(tx: Tx, expenseId: string, b: Pick<BuiltExpense, "payers" | "rows" | "weights">) {
  await tx.insert(expensePayers).values(b.payers.map((p) => ({ expenseId, memberId: p.memberId, cents: p.cents })));
  await tx.insert(expenseSplits).values(b.rows.map((r) => ({ expenseId, memberId: r.memberId, cents: r.cents, weight: b.weights.has(r.memberId) ? String(b.weights.get(r.memberId)) : null })));
}

/**
 * Internal (recurring copies, Splitwise import): write an already-validated Expense. Skips the active-member check
 * because imported people may still be Pending. Returns null when `onConflictSkip` hit an existing recurring copy.
 */
export async function insertExpenseRows(
  groupId: string,
  createdBy: string | null,
  b: Omit<BuiltExpense, "weights"> & { weights?: Map<string, number>; source: ExpenseSource; recurringParentId?: string | null; variable?: boolean; createdAt?: Date },
  tx?: Tx,
): Promise<string | null> {
  const run = async (t: Tx) => {
    const [e] = await t
      .insert(expenses)
      .values({
        groupId,
        payerId: b.payers[0].memberId,
        cents: b.cents,
        description: b.description,
        category: b.category,
        note: b.note,
        occurredOn: b.occurredOn,
        splitMethod: b.method,
        recurring: b.recurring,
        recurringParentId: b.recurringParentId ?? null,
        variable: b.variable ?? false,
        receiptUrl: b.receiptUrl,
        source: b.source,
        createdBy,
        ...(b.createdAt ? { createdAt: b.createdAt } : {}),
      })
      .onConflictDoNothing()
      .returning({ id: expenses.id });
    if (!e) return null;
    await writeShares(t, e.id, { payers: b.payers, rows: b.rows, weights: b.weights ?? new Map() });
    return e.id;
  };
  return tx ? run(tx) : db.transaction(run);
}

const howSplit = (b: Pick<BuiltExpense, "method" | "rows" | "payers">, nameOf: (id: string) => string, amount: (cents: number) => string) => {
  const by = b.payers.length > 1 ? ` (paid by ${b.payers.map((p) => `${nameOf(p.memberId)} ${amount(p.cents)}`).join(", ")})` : "";
  return b.method === "equal" ? by : `, split by ${b.method}${by}`;
};

/**
 * Record a shared Expense. One Payer (payerId, default the sender) or several (`payers`, must add up). The split is
 * equal (`splitAmong`, default everyone active), exact (`splits`), percent (`percents`) or shares (`shares`); the
 * cents are always computed here, leftover cents to the Payer first. Category defaults to a guess.
 */
export async function logExpense(ctx: Ctx, input: ExpenseInput): Promise<Expense> {
  await requireActive(ctx);
  if (input.variable) checkVariable(input);
  const b = await build(ctx, input);
  const source = input.source ?? (ctx.source === "ui" ? "ui" : "chat");
  const id = await insertExpenseRows(ctx.groupId, ctx.memberId, { ...b, source, variable: input.variable, recurringParentId: input.recurringParentId });
  if (!id) throw new Error(`${b.description} for ${b.occurredOn} is already logged.`);
  if (b.receiptUrl) await linkReceipt(ctx, id, b.description, b.receiptUrl);
  const what = input.variable ? `added ${b.description} (${b.recurring}, amount asked on the due day)` : `added ${b.description}, ${b.amount(b.cents)}${howSplit(b, b.nameOf, b.amount)}`;
  await recordFor(ctx, "expense.added", what, { table: "expenses", id });
  if (!input.variable) await enqueueSplitwisePush(ctx.groupId, id, "upsert");
  return (await getExpense(ctx, id))!;
}

/** A variable Expense repeats, and its split has to work for any amount: evenly, by percent or by shares. */
function checkVariable(input: Pick<ExpenseInput, "recurring" | "method" | "splits" | "percents" | "shares">) {
  if (input.recurring !== "monthly") throw new Error("A bill that varies has to repeat monthly.");
  if (inferMethod(input) === "exact") throw new SplitError("A bill that varies can't have fixed amounts per person. Split it evenly, by percent or by shares.");
}

/** The Expense plus the ownership check: added it, paid it, has a Share in it, or Admin. */
async function changeable(ctx: Ctx, expenseId: string, opts: { deleted?: boolean } = {}) {
  const actor = await requireActive(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(expenseId)) throw new Error("That expense isn't here anymore.");
  const [e] = await db
    .select()
    .from(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, ctx.groupId), opts.deleted ? isNotNull(expenses.deletedAt) : isNull(expenses.deletedAt)));
  if (!e) throw new Error(opts.deleted ? "That expense isn't in the bin anymore." : "That expense isn't here anymore.");
  const [participants, payers] = await Promise.all([
    db.select({ id: expenseSplits.memberId }).from(expenseSplits).where(eq(expenseSplits.expenseId, e.id)),
    db.select({ id: expensePayers.memberId }).from(expensePayers).where(eq(expensePayers.expenseId, e.id)),
  ]);
  const payerIds = payers.length ? payers.map((p) => p.id) : [e.payerId];
  const allowed = payerIds.some((payerId) => canChangeExpense(actor, { createdBy: e.createdBy, payerId, participantIds: participants.map((p) => p.id) }));
  if (!allowed) throw new NotAllowedError(`Only someone in "${e.description}" (or an admin) can change it.`, "not-yours");
  return e;
}

export type ExpensePatch = { expenseId: string } & Partial<ExpenseInput>;

/**
 * Change an Expense. Anything left out keeps its current value, including the split method: a new total re-splits
 * equal/percent/shares Expenses the same way. Exact amounts or several Payers can't be re-scaled, so changing the
 * total of one of those needs the new amounts too.
 */
export async function updateExpense(ctx: Ctx, input: ExpensePatch): Promise<Expense> {
  const row = await changeable(ctx, input.expenseId);
  const before = (await getExpense(ctx, row.id))!;
  const cents = input.cents ?? before.cents;
  const totalChanged = cents !== before.cents;
  const amount = moneyIn(await currencyOf(ctx.groupId));

  let payers = input.payers;
  if (!payers && input.payerId) payers = [{ memberId: input.payerId, cents }];
  if (!payers) {
    const old = before.payers ?? [];
    if (old.length > 1 && totalChanged) throw new SplitError(`Several people paid for ${before.description}. Who paid how much of the new ${amount(cents)}?`);
    payers = old.length > 1 ? old.map((p) => ({ memberId: p.memberId, cents: p.cents })) : [{ memberId: old[0]?.memberId ?? row.payerId, cents }];
  }

  const splitGiven = input.method || input.splits || input.percents || input.shares || input.splitAmong;
  const method = splitGiven ? inferMethod(input) : (before.method ?? "equal");
  const old = before.splits ?? [];
  let split: Pick<ExpenseInput, "splitAmong" | "splits" | "percents" | "shares"> = {};
  if (method === "equal") split = { splitAmong: input.splitAmong ?? old.map((s) => s.memberId) };
  else if (method === "exact") {
    if (input.splits) split = { splits: input.splits };
    else if (totalChanged || before.method !== "exact") throw new SplitError(`${before.description} is split by exact amounts. Give me each person's amount for ${amount(cents)}.`);
    else split = { splits: old.map((s) => ({ memberId: s.memberId, cents: s.cents })) };
  } else if (method === "percent") {
    split = { percents: input.percents ?? (before.method === "percent" ? old.map((s) => ({ memberId: s.memberId, percent: Number(s.weight ?? 0) })) : undefined) };
    if (!split.percents) throw new SplitError(`What percentage is each person's share of ${before.description}?`);
  } else {
    split = { shares: input.shares ?? (before.method === "shares" ? old.map((s) => ({ memberId: s.memberId, shares: Number(s.weight ?? 0) })) : undefined) };
    if (!split.shares) throw new SplitError(`How many shares does each person get in ${before.description}?`);
  }

  const b = await build(ctx, {
    cents,
    description: input.description ?? before.description,
    method,
    ...split,
    payers,
    category: input.category ?? before.category,
    note: input.note !== undefined ? input.note : before.note,
    occurredOn: input.occurredOn ?? before.occurredOn,
    recurring: input.recurring !== undefined ? input.recurring : before.recurring,
    receiptUrl: input.receiptUrl !== undefined ? input.receiptUrl : before.receiptUrl,
    source: before.source,
    variable: input.variable ?? before.variable,
  });
  await db.transaction(async (tx) => {
    await tx
      .update(expenses)
      .set({
        payerId: b.payers[0].memberId,
        cents: b.cents,
        description: b.description,
        category: b.category,
        note: b.note,
        occurredOn: b.occurredOn,
        splitMethod: b.method,
        recurring: b.recurring,
        ...(input.variable !== undefined ? { variable: input.variable } : {}),
        receiptUrl: b.receiptUrl,
      })
      .where(eq(expenses.id, row.id));
    await tx.delete(expensePayers).where(eq(expensePayers.expenseId, row.id));
    await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, row.id));
    await writeShares(tx, row.id, b);
  });
  const what = totalChanged && !before.variable ? `changed ${b.description}: ${amount(before.cents)} -> ${amount(cents)}` : `changed ${b.description}`;
  if (input.receiptUrl !== undefined && input.receiptUrl !== before.receiptUrl) await linkReceipt(ctx, row.id, b.description, b.receiptUrl);
  await recordFor(ctx, "expense.changed", what, { table: "expenses", id: row.id });
  if (!(input.variable ?? before.variable)) await enqueueSplitwisePush(ctx.groupId, row.id, "upsert");
  return (await getExpense(ctx, row.id))!;
}

/**
 * The receipt's Document (ADR 0018): a /api/docs link of this Group's becomes expenses.receipt_document_id, and the
 * Document a filed receipt pointing at the Expense. Anything else (an old /uploads path) keeps no Document.
 */
async function linkReceipt(ctx: Ctx, expenseId: string, description: string, receiptUrl: string | null) {
  const docId = receiptUrl ? docIdFromUrl(receiptUrl) : null;
  const linked = docId ? await attachReceipt(ctx, docId, { id: expenseId, description }) : false;
  if (!linked) await db.update(expenses).set({ receiptDocumentId: null }).where(eq(expenses.id, expenseId));
}

/** Soft delete, so undo can bring it back. */
export async function deleteExpense(ctx: Ctx, input: { expenseId: string }): Promise<{ id: string; description: string; cents: number }> {
  const e = await changeable(ctx, input.expenseId);
  await db.update(expenses).set({ deletedAt: new Date() }).where(eq(expenses.id, e.id));
  await recordFor(ctx, "expense.deleted", `deleted ${e.description}, ${moneyIn(await currencyOf(ctx.groupId))(e.cents)}`, { table: "expenses", id: e.id });
  await enqueueSplitwisePush(ctx.groupId, e.id, "delete");
  return { id: e.id, description: e.description, cents: e.cents };
}

export async function restoreExpense(ctx: Ctx, input: { expenseId: string }): Promise<{ id: string; description: string; cents: number }> {
  const e = await changeable(ctx, input.expenseId, { deleted: true });
  await db.update(expenses).set({ deletedAt: null }).where(eq(expenses.id, e.id));
  await recordFor(ctx, "expense.restored", `restored ${e.description}, ${moneyIn(await currencyOf(ctx.groupId))(e.cents)}`, { table: "expenses", id: e.id });
  await enqueueSplitwisePush(ctx.groupId, e.id, "upsert");
  return { id: e.id, description: e.description, cents: e.cents };
}

/** The most recently deleted Expense in the Group (what "undo" brings back), from the last 7 days. */
export async function lastDeletedExpense(ctx: GroupCtx): Promise<{ id: string; description: string; cents: number } | undefined> {
  const [e] = await db
    .select({ id: expenses.id, description: expenses.description, cents: expenses.cents })
    .from(expenses)
    .where(and(eq(expenses.groupId, ctx.groupId), isNotNull(expenses.deletedAt), sql`${expenses.deletedAt} > now() - interval '7 days'`))
    .orderBy(desc(expenses.deletedAt))
    .limit(1);
  return e;
}

/** Expenses whose description matches `query` (exact, then contains), newest first. */
export async function findExpenses(ctx: GroupCtx, query: string, opts: { deleted?: boolean } = {}): Promise<{ id: string; description: string; cents: number; occurredOn: string }[]> {
  const q = query.trim().toLowerCase();
  const rows = await db
    .select({ id: expenses.id, description: expenses.description, cents: expenses.cents, occurredOn: expenses.occurredOn })
    .from(expenses)
    .where(and(eq(expenses.groupId, ctx.groupId), opts.deleted ? isNotNull(expenses.deletedAt) : isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.occurredOn), desc(expenses.createdAt))
    .limit(200);
  if (/^[0-9a-f-]{36}$/i.test(q)) return rows.filter((r) => r.id === q);
  const exact = rows.filter((r) => r.description.toLowerCase() === q);
  if (exact.length) return exact;
  const words = q.replace(/^(the|my|our)\s+/, "").split(/\s+/).filter(Boolean);
  return rows.filter((r) => words.every((w) => r.description.toLowerCase().includes(w)));
}

/* ---------- Balances and the Settle plan ---------- */

/** The Expenses people owe on: live, and not a variable parent (0 cents of its own; each month is its own Expense). */
const owedExpenses = (groupId: string) => and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt), eq(expenses.variable, false));

/**
 * Per Member: paid - owed + settlements sent - settlements received. Positive = is owed.
 * Active Members are always listed (zero included); anyone removed stays while they still owe or are owed, so
 * balances always net to zero. Sorted by balance descending, then by name.
 */
export async function getBalances(ctx: GroupCtx): Promise<Balance[]> {
  const gid = ctx.groupId;
  const live = owedExpenses(gid);
  const [paid, owed, sent, received, everyone] = await Promise.all([
    db
      .select({ id: expensePayers.memberId, cents: sql<number>`coalesce(sum(${expensePayers.cents}), 0)::int` })
      .from(expensePayers)
      .innerJoin(expenses, eq(expensePayers.expenseId, expenses.id))
      .where(live)
      .groupBy(expensePayers.memberId),
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

async function memberNames(groupId: string): Promise<(id: string) => string> {
  const rows = await db.select({ id: members.id, name: members.displayName, status: members.status }).from(members).where(eq(members.groupId, groupId));
  const names = new Map(rows.map((r) => [r.id, r.status === "removed" ? `${r.name} (moved out)` : r.name]));
  return (id) => names.get(id) ?? "Someone";
}

/** Who owes whom with "simplify debts" off: each pair's net from the Expenses they shared and their Settlements. */
export async function pairwiseDebts(ctx: GroupCtx): Promise<Transfer[]> {
  const gid = ctx.groupId;
  const live = owedExpenses(gid);
  const [payers, shares, paid, nameOf] = await Promise.all([
    db.select({ expenseId: expensePayers.expenseId, memberId: expensePayers.memberId, cents: expensePayers.cents }).from(expensePayers).innerJoin(expenses, eq(expensePayers.expenseId, expenses.id)).where(live),
    db.select({ expenseId: expenseSplits.expenseId, memberId: expenseSplits.memberId, cents: expenseSplits.cents }).from(expenseSplits).innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id)).where(live),
    db.select({ fromId: settlements.fromId, toId: settlements.toId, cents: settlements.cents }).from(settlements).where(eq(settlements.groupId, gid)),
    memberNames(gid),
  ]);
  const ledger = new Map<string, LedgerExpense>();
  const of = (id: string) => ledger.get(id) ?? (ledger.set(id, { payers: [], shares: [] }), ledger.get(id)!);
  for (const p of payers) of(p.expenseId).payers.push(p);
  for (const s of shares) of(s.expenseId).shares.push(s);
  return computePairwiseDebts([...ledger.values()], paid, nameOf);
}

/** The Settle plan: simplified (fewest payments) or pairwise, following the Group's "simplify debts" setting. */
export async function getSettlePlan(ctx: GroupCtx): Promise<Transfer[]> {
  const [g] = await db.select({ simplify: groups.simplifyDebts }).from(groups).where(eq(groups.id, ctx.groupId));
  return g && !g.simplify ? pairwiseDebts(ctx) : computeSettlePlan(await getBalances(ctx));
}

/**
 * Money's section of the weekly Group Report: how many balances are open, never who or how much (the Settle nudge
 * tells each person privately, ADR 0021). `nudged` = the Settle nudge covers at least one of the debts. Pure.
 */
export function settleReportParts(plan: readonly Transfer[], opts: { nudged?: boolean } = {}): ReportPart[] {
  if (plan.length === 0) return [{ icon: "💸", text: "All square." }];
  const n = `${plan.length} open balance${plan.length === 1 ? "" : "s"}`;
  return [{ icon: "💸", text: opts.nudged ? `${n}; I'm nudging people privately.` : `${n}.` }];
}

/** The Settle plan row between two Members, whichever way it goes. */
export async function debtBetween(ctx: GroupCtx, a: string, b: string): Promise<Transfer | undefined> {
  return (await getSettlePlan(ctx)).find((t) => (t.fromId === a && t.toId === b) || (t.fromId === b && t.toId === a));
}

/** Record that `from` paid `to` back. fromId defaults to ctx.memberId. */
export async function settleUp(ctx: Ctx, input: { fromId?: string; toId: string; cents: number }): Promise<{ id: string; fromId: string; toId: string; cents: number }> {
  await requireActive(ctx);
  assertWholeCents(input.cents, "Payment");
  const fromId = input.fromId ?? ctx.memberId;
  if (fromId === input.toId) throw new Error("Paying yourself back doesn't count.");
  const people = await listMembers(ctx);
  const byId = new Map(people.map((m) => [m.id, m.displayName]));
  if (!byId.has(fromId)) throw new Error("The payer isn't an active member of this group.");
  if (!byId.has(input.toId)) throw new Error("The person being paid isn't an active member of this group.");
  const [s] = await db.insert(settlements).values({ groupId: ctx.groupId, fromId, toId: input.toId, cents: input.cents }).returning();
  const amount = moneyIn(await currencyOf(ctx.groupId));
  const summary = fromId === ctx.memberId ? `paid ${byId.get(input.toId)} ${amount(input.cents)}` : `recorded ${byId.get(fromId)} paying ${byId.get(input.toId)} ${amount(input.cents)}`;
  await recordFor(ctx, "settlement.added", summary, { table: "settlements", id: s.id });
  return { id: s.id, fromId, toId: input.toId, cents: input.cents };
}

/* ---------- reads ---------- */

/** Newest first (by the day it happened), with Payers, Shares, method and category. Deleted Expenses are left out. */
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
      method: expenses.splitMethod,
      category: expenses.category,
      note: expenses.note,
      occurredOn: expenses.occurredOn,
      recurring: expenses.recurring,
      recurringParentId: expenses.recurringParentId,
      variable: expenses.variable,
      receiptUrl: expenses.receiptUrl,
      receiptDocumentId: expenses.receiptDocumentId,
      splitwiseId: expenseExternalRefs.externalId,
      deletedAt: expenses.deletedAt,
    })
    .from(expenses)
    .innerJoin(members, eq(expenses.payerId, members.id))
    .leftJoin(expenseExternalRefs, and(eq(expenseExternalRefs.expenseId, expenses.id), eq(expenseExternalRefs.provider, "splitwise")))
    .where(and(eq(expenses.groupId, ctx.groupId), opts.expenseId ? eq(expenses.id, opts.expenseId) : isNull(expenses.deletedAt)))
    .orderBy(desc(expenses.occurredOn), desc(expenses.createdAt), desc(expenses.id))
    .limit(limit);
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [splitRows, payerRows] = await Promise.all([
    db
      .select({ expenseId: expenseSplits.expenseId, memberId: expenseSplits.memberId, name: members.displayName, cents: expenseSplits.cents, weight: expenseSplits.weight })
      .from(expenseSplits)
      .innerJoin(members, eq(expenseSplits.memberId, members.id))
      .where(inArray(expenseSplits.expenseId, ids)),
    db
      .select({ expenseId: expensePayers.expenseId, memberId: expensePayers.memberId, name: members.displayName, cents: expensePayers.cents })
      .from(expensePayers)
      .innerJoin(members, eq(expensePayers.memberId, members.id))
      .where(inArray(expensePayers.expenseId, ids)),
  ]);
  const group = <T extends { expenseId: string }>(list: T[]) => {
    const m = new Map<string, T[]>();
    for (const x of list) (m.get(x.expenseId) ?? (m.set(x.expenseId, []), m.get(x.expenseId)!)).push(x);
    return m;
  };
  const splitsBy = group(splitRows);
  const payersBy = group(payerRows);
  return rows.map((r) => ({
    ...r,
    splits: (splitsBy.get(r.id) ?? []).map((s) => ({ memberId: s.memberId, name: s.name, cents: s.cents, weight: s.weight === null ? null : Number(s.weight) })),
    payers: (payersBy.get(r.id) ?? []).map((p) => ({ memberId: p.memberId, name: p.name, cents: p.cents })).sort((a, b) => b.cents - a.cents),
  }));
}

/** One Expense by id, deleted ones included (the detail page and undo need them). */
export async function getExpense(ctx: GroupCtx, expenseId: string): Promise<Expense | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(expenseId)) return undefined;
  return (await listExpenses(ctx, 1, { expenseId }))[0];
}

/** What the model reads back about an Expense (Money's tools, the Cart's "I paid"): names and ready-made amounts in the Group's currency, so it never formats or adds cents itself. */
export function expenseSummary(e: Expense, currency = "USD") {
  const amount = moneyIn(currency);
  return {
    id: e.id,
    description: e.description,
    total: e.variable ? "asked on the due day" : amount(e.cents),
    date: e.occurredOn,
    category: e.category,
    method: e.method,
    paidBy: (e.payers ?? []).map((p) => ({ name: p.name, paid: amount(p.cents) })),
    shares: (e.splits ?? []).map((s) => ({ name: s.name, ...(e.variable ? {} : { owes: amount(s.cents) }), ...(s.weight != null ? { [e.method === "percent" ? "percent" : "shares"]: s.weight } : {}) })),
    ...(e.note ? { note: e.note } : {}),
    ...(e.recurring ? { repeats: e.recurring } : {}),
    ...(receiptHref(e.receiptUrl) ? { hasReceipt: true } : {}),
    ...(e.splitwiseId ? { inSplitwise: true } : {}),
  };
}
