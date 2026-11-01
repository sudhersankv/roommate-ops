// The splitting tools: thin front doors over services/money.ts. The model passes intent (who, percentages, shares,
// exact amounts as people said them, in the group's currency); every per-person cent is computed by the service (ADR 0007).
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { EXPENSE_CATEGORIES, RECURRENCES, SPLIT_METHODS } from "@/db/enums";
import { payLinks } from "@/lib/pay-links";
import { groups, members, money, reactions } from "@/services";
import { expenseSummary, type Transfer } from "@/services/money";
import { moneyIn, type Ctx, type GroupCtx } from "@/services/types";
import { ctxOf, memberIdByName, toCents } from "../util";

const transferText = (t: Transfer, amount: (cents: number) => string) => ({ from: t.fromName, to: t.toName, amount: amount(t.cents) });
/** Amounts said in the Group's currency. */
const amountFor = async (ctx: GroupCtx) => moneyIn(await groups.currencyOf(ctx.groupId));

const names = (ctx: Ctx, list: string[]) => Promise.all(list.map((n) => memberIdByName(ctx, n)));

const splitFields = {
  method: z.enum(SPLIT_METHODS).optional().describe("equal (default), exact, percent or shares. Inferred from which list you pass."),
  splitAmong: z.array(z.string()).optional().describe("equal: member names; omit for everyone"),
  exact: z.array(z.object({ name: z.string(), amount: z.number().nonnegative().describe("In the group's currency, as the person said it") })).optional().describe("exact: each person's amount; must add up to the total"),
  percents: z.array(z.object({ name: z.string(), percent: z.number().nonnegative() })).optional().describe("percent: e.g. 50/25/25; must add up to 100"),
  shares: z.array(z.object({ name: z.string(), shares: z.number().positive() })).optional().describe("shares: e.g. 2:2:1"),
  payer: z.string().optional().describe("Member name if one person other than the sender paid it all"),
  payers: z.array(z.object({ name: z.string(), amount: z.number().nonnegative().describe("What this person paid, in the group's currency") })).optional().describe("Several payers ('Alex paid 60 and I paid 40'); must add up to the total"),
};

type SplitArgs = { [K in keyof typeof splitFields]?: z.infer<(typeof splitFields)[K]> };

/** Names -> member ids, amounts -> cents. No arithmetic beyond the unit conversion. */
async function resolveSplit(ctx: Ctx, a: SplitArgs): Promise<Partial<money.ExpenseInput>> {
  const out: Partial<money.ExpenseInput> = {};
  if (a.method) out.method = a.method;
  if (a.splitAmong) out.splitAmong = await names(ctx, a.splitAmong);
  if (a.exact) out.splits = await Promise.all(a.exact.map(async (r) => ({ memberId: await memberIdByName(ctx, r.name), cents: toCents(r.amount) })));
  if (a.percents) out.percents = await Promise.all(a.percents.map(async (r) => ({ memberId: await memberIdByName(ctx, r.name), percent: r.percent })));
  if (a.shares) out.shares = await Promise.all(a.shares.map(async (r) => ({ memberId: await memberIdByName(ctx, r.name), shares: r.shares })));
  if (a.payers?.length) out.payers = await Promise.all(a.payers.map(async (p) => ({ memberId: await memberIdByName(ctx, p.name), cents: toCents(p.amount) })));
  else if (a.payer) out.payerId = await memberIdByName(ctx, a.payer);
  return out;
}

/** One Expense from a description, or a clear error the model can turn into a question. */
async function pickExpense(ctx: Ctx, query: string, opts: { deleted?: boolean } = {}): Promise<{ id: string; description: string }> {
  const hits = await money.findExpenses(ctx, query, opts);
  if (hits.length === 0) throw new Error(`No ${opts.deleted ? "deleted " : ""}expense matches "${query}".`);
  if (hits.length > 1) {
    const amount = await amountFor(ctx);
    const list = hits.slice(0, 5).map((h) => `${h.description} ${amount(h.cents)} on ${h.occurredOn}`).join("; ");
    throw new Error(`More than one expense matches "${query}": ${list}. Ask which one.`);
  }
  return hits[0];
}

export const moneyTools = {
  log_expense: createTool({
    id: "log_expense",
    description:
      "Record a shared expense ('I paid $60 for internet'). Defaults: payer = sender, split equally among everyone, today. " +
      "Pass the split the way people said it and let the service do the math: percents for '50/25/25', shares for '2:2:1', exact for amounts per person, payers for 'Alex paid 60 and I paid 40'. Never pass per-person amounts you calculated yourself. " +
      "Always set a category. Exact amounts or payers that don't add up come back as an error: ask instead of fixing them.",
    inputSchema: z.object({
      amount: z.number().positive().describe("The total in the group's currency, e.g. 62.5"),
      description: z.string().min(1).describe("What it was for, e.g. 'internet'"),
      category: z.enum(EXPENSE_CATEGORIES).describe("Your best pick: food (eating out), groceries, rent, utilities, transport, entertainment, household, travel, health, other"),
      ...splitFields,
      note: z.string().optional(),
      date: z.string().optional().describe("YYYY-MM-DD in the group's time zone, if not today"),
      recurring: z.enum(RECURRENCES).optional().describe("monthly or weekly, only when they say it repeats (rent every month)"),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const e = await money.logExpense(ctx, {
        cents: toCents(input.amount),
        description: input.description,
        category: input.category,
        note: input.note,
        occurredOn: input.date,
        recurring: input.recurring ?? null,
        ...(await resolveSplit(ctx, input)),
      });
      return expenseSummary(e, await groups.currencyOf(ctx.groupId));
    },
  }),
  update_expense: createTool({
    id: "update_expense",
    description:
      "Change an expense ('make the pizza $30', 'Sam wasn't in the uber', 'the dinner was 60/40'). Only pass what changes; the split method is kept, so a new total re-splits it the same way. Find it by its description.",
    inputSchema: z.object({
      expense: z.string().min(1).describe("Its description (or id) as people call it, e.g. 'pizza'"),
      amount: z.number().positive().optional().describe("New total in the group's currency"),
      description: z.string().optional().describe("New description"),
      category: z.enum(EXPENSE_CATEGORIES).optional(),
      ...splitFields,
      note: z.string().optional(),
      date: z.string().optional().describe("YYYY-MM-DD"),
      recurring: z.enum(["monthly", "weekly", "none"]).optional().describe("'none' stops it repeating"),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const target = await pickExpense(ctx, input.expense);
      const e = await money.updateExpense(ctx, {
        expenseId: target.id,
        ...(input.amount !== undefined ? { cents: toCents(input.amount) } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.category ? { category: input.category } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.date ? { occurredOn: input.date } : {}),
        ...(input.recurring ? { recurring: input.recurring === "none" ? null : input.recurring } : {}),
        ...(await resolveSplit(ctx, input)),
      });
      return expenseSummary(e, await groups.currencyOf(ctx.groupId));
    },
  }),
  delete_expense: createTool({
    id: "delete_expense",
    description: "Delete an expense ('delete the pizza expense'). It can be brought back with restore_expense ('undo').",
    inputSchema: z.object({ expense: z.string().min(1).describe("Its description (or id), e.g. 'pizza'") }),
    execute: async ({ expense }, context) => {
      const ctx = ctxOf(context);
      const target = await pickExpense(ctx, expense);
      const gone = await money.deleteExpense(ctx, { expenseId: target.id });
      return { deleted: gone.description, amount: (await amountFor(ctx))(gone.cents), undo: "Say 'undo' to bring it back." };
    },
  }),
  restore_expense: createTool({
    id: "restore_expense",
    description: "Undo a delete: bring back a deleted expense. Without a description, the most recently deleted one.",
    inputSchema: z.object({ expense: z.string().optional().describe("Its description, if they said which") }),
    execute: async ({ expense }, context) => {
      const ctx = ctxOf(context);
      const target = expense ? await pickExpense(ctx, expense, { deleted: true }) : await money.lastDeletedExpense(ctx);
      if (!target) throw new Error("Nothing was deleted lately, so there's nothing to undo.");
      const back = await money.restoreExpense(ctx, { expenseId: target.id });
      return { restored: back.description, amount: (await amountFor(ctx))(back.cents) };
    },
  }),
  get_balances: createTool({
    id: "get_balances",
    description:
      "Who owes what: each member's balance (positive = is owed) and the settle plan. With 'simplify debts' on the plan is the fewest payments; off, it's pairwise (each pair's net from what they shared). Amounts are ready to say.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const [balances, plan, group] = await Promise.all([money.getBalances(ctx), money.getSettlePlan(ctx), groups.getGroup(ctx.groupId)]);
      const amount = moneyIn(group?.currency);
      return {
        simplifyDebts: group?.simplifyDebts ?? true,
        balances: balances.map((b) => ({ name: b.name, balance: `${b.cents > 0 ? "+" : b.cents < 0 ? "-" : ""}${amount(Math.abs(b.cents))}`, cents: b.cents })),
        settlePlan: plan.map((t) => transferText(t, amount)),
      };
    },
  }),
  settle_up: createTool({
    id: "settle_up",
    description:
      "Settling up between the sender (or `from`) and another member. paid=true records a payment that already happened ('I paid Maya back $20', 'Sam sent me 15'). " +
      "paid=false ('settle up with Sam', 'how do I pay Dev?') records nothing: it returns who owes whom and how much, with pay buttons for the person being paid (attached for you).",
    inputSchema: z.object({
      with: z.string().min(1).describe("The other member"),
      paid: z.boolean().describe("true only if the money already moved"),
      amount: z.number().positive().optional().describe("In the group's currency; omit to use what the settle plan says"),
      direction: z.enum(["sender_pays", "other_pays"]).optional().describe("For paid=true: who paid. Default: the sender paid the other member"),
      from: z.string().optional().describe("Record for someone else: the member who paid (instead of the sender)"),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const other = await memberIdByName(ctx, input.with);
      const amount = await amountFor(ctx);
      const me = input.from ? await memberIdByName(ctx, input.from) : ctx.memberId;
      const owed = await money.debtBetween(ctx, me, other);
      if (input.paid) {
        const [fromId, toId] = input.direction === "other_pays" ? [other, me] : [me, other];
        const cents = input.amount !== undefined ? toCents(input.amount) : owed && owed.fromId === fromId ? owed.cents : null;
        if (!cents) throw new Error("How much was it? The settle plan doesn't have that one owing the other anything.");
        const s = await money.settleUp(ctx, { fromId, toId, cents });
        const after = await money.debtBetween(ctx, fromId, toId);
        const react = reactions.settledReaction({ square: !after });
        return { recorded: true, amount: amount(s.cents), stillOwed: after ? transferText(after, amount) : "square now", ...(react ? { react } : {}) };
      }
      if (!owed) return { recorded: false, square: true, message: "Nothing to settle: they're square." };
      const cents = input.amount !== undefined ? toCents(input.amount) : owed.cents;
      const payee = (await members.listMembersWithHandles(ctx)).find((m) => m.id === owed.toId);
      const links = payLinks(payee?.handles ?? {}, cents, { to: owed.toName, note: (await groups.getGroup(ctx.groupId))?.name ?? "" });
      return {
        recorded: false,
        owes: { from: owed.fromName, to: owed.toName, amount: amount(cents) },
        ...(links.length ? { links, payButtons: links.map((l) => l.text) } : { noHandles: `${owed.toName} hasn't saved a Venmo, PayPal or Cash App handle yet.` }),
        next: "Nothing is recorded until they say it's paid.",
      };
    },
  }),
  set_simplify_debts: createTool({
    id: "set_simplify_debts",
    description: "Admin only: 'simplify debts' on (settle with the fewest payments, even between people who didn't share an expense) or off (pairwise).",
    inputSchema: z.object({ on: z.boolean() }),
    execute: async ({ on }, context) => {
      const ctx = ctxOf(context);
      await groups.setSimplifyDebts(ctx, { on });
      const amount = await amountFor(ctx);
      return { simplifyDebts: on, settlePlan: (await money.getSettlePlan(ctx)).map((t) => transferText(t, amount)) };
    },
  }),
  list_expenses: createTool({
    id: "list_expenses",
    description: "Recent shared expenses, newest first, with payers, each person's share, method and category. Amounts are ready to say.",
    inputSchema: z.object({ limit: z.number().int().positive().max(50).optional().describe("Default 10") }),
    execute: async ({ limit }, context) => {
      const ctx = ctxOf(context);
      const currency = await groups.currencyOf(ctx.groupId);
      return (await money.listExpenses(ctx, limit ?? 10)).map((e) => expenseSummary(e, currency));
    },
  }),
};
