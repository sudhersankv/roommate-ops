// Rent and utilities (#25): thin front doors over services/rent.ts and services/recurring.ts. The model passes the
// split as people said it (percents, shares, exact amounts in the group's currency) and the services compute every cent (ADR 0007).
// In the group chat nobody's own share is said out loud: rent_status gives the shares only in a DM.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { EXPENSE_CATEGORIES } from "@/db/enums";
import { groups } from "@/services";
import { expenseSummary, findExpenses, getExpense } from "@/services/money";
import { answerAmount, setVariableExpense } from "@/services/recurring";
import { rentStatus, rentSummary, setRent } from "@/services/rent";
import { groupTimezone } from "@/services/schedule";
import { moneyIn } from "@/services/types";
import { ctxOf, memberIdByName, toCents } from "../util";

const inDm = (context: unknown) => (context as { requestContext?: { get(k: string): unknown } } | undefined)?.requestContext?.get("isPrivate") === true;

const shareFields = {
  splitAmong: z.array(z.string()).optional().describe("Split evenly among these member names; omit for everyone"),
  exact: z.array(z.object({ name: z.string(), amount: z.number().nonnegative().describe("In the group's currency, as said") })).optional().describe("'Maya 1000, Dev 800, Sam 600': each person's amount; must add up"),
  percents: z.array(z.object({ name: z.string(), percent: z.number().nonnegative() })).optional().describe("'40/30/30'; must add up to 100"),
  shares: z.array(z.object({ name: z.string(), shares: z.number().positive() })).optional().describe("'2:2:1'"),
};
type ShareArgs = { [K in keyof typeof shareFields]?: z.infer<(typeof shareFields)[K]> };

async function resolveShares(ctx: ReturnType<typeof ctxOf>, a: ShareArgs) {
  const id = (n: string) => memberIdByName(ctx, n);
  if (a.exact) return { method: "exact" as const, splits: await Promise.all(a.exact.map(async (r) => ({ memberId: await id(r.name), cents: toCents(r.amount) }))) };
  if (a.percents) return { method: "percent" as const, percents: await Promise.all(a.percents.map(async (r) => ({ memberId: await id(r.name), percent: r.percent }))) };
  if (a.shares) return { method: "shares" as const, shares: await Promise.all(a.shares.map(async (r) => ({ memberId: await id(r.name), shares: r.shares }))) };
  if (a.splitAmong) return { method: "equal" as const, splitAmong: await Promise.all(a.splitAmong.map(id)) };
  return {};
}

/** What the group hears about the rent; the shares only in a DM. */
function sayRent(r: ReturnType<typeof rentSummary>, privately: boolean) {
  const { shares, ...rest } = r;
  return privately ? r : { ...rest, shares: "Each person's share is on the Money page, or ask me in a DM.", sharesCount: shares.length };
}

export const rentTools = {
  set_rent: createTool({
    id: "set_rent",
    description:
      "Set up or change the group's rent ('rent is 2400 on the 1st, Maya pays', 'Maya 1000, Dev 800, Sam 600', 'rent went up to 2500'). " +
      "It's a monthly recurring expense: Roomie tells the group 3 days before it's due and DMs each person their own share with a pay link. " +
      "New rent needs the amount and the due day; the payer defaults to the sender, the split to everyone evenly. Pass only what changes. Pass the split as said, never per-person amounts you worked out.",
    inputSchema: z.object({
      amount: z.number().positive().optional().describe("The whole rent in the group's currency"),
      dueDay: z.number().int().min(1).max(31).optional().describe("Day of the month it's due (1 = the 1st)"),
      payer: z.string().optional().describe("Who pays the landlord (member name); default the sender for new rent"),
      ...shareFields,
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const rent = await setRent(ctx, {
        ...(input.amount !== undefined ? { cents: toCents(input.amount) } : {}),
        ...(input.dueDay !== undefined ? { dueDay: input.dueDay } : {}),
        ...(input.payer ? { payerId: await memberIdByName(ctx, input.payer) } : {}),
        ...(await resolveShares(ctx, input)),
      });
      return { rent: sayRent(rentSummary(rent, await groupTimezone(ctx.groupId)), inDm(context)), next: "Confirm in one line: the amount, the day and who pays the landlord." };
    },
  }),
  rent_status: createTool({
    id: "rent_status",
    description:
      "The group's rent: the amount, the due day, who pays the landlord, the split ('what's our rent?', 'when is rent due?'). When there's none yet and offer is true, offer once to track it.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const s = await rentStatus(ctx);
      if (!s.rent) return { rent: null, offer: s.offer, ...(s.offer ? { say: `No rent set up yet. Want me to track it? Tell me the amount, the day it's due and who pays the landlord.` } : {}) };
      return { rent: sayRent(s.rent, inDm(context)), offer: false };
    },
  }),
  set_variable_expense: createTool({
    id: "set_variable_expense",
    description:
      "A monthly bill whose amount changes ('electric varies, due the 20th, Dev pays'). On the due day Roomie DMs the payer for the amount and logs it split this way. A bill with a fixed amount ('internet is 80 a month') is log_expense with recurring=monthly instead.",
    inputSchema: z.object({
      description: z.string().min(1).describe("The bill, e.g. 'Electric'"),
      dueDay: z.number().int().min(1).max(31).describe("Day of the month it's due"),
      payer: z.string().optional().describe("Who pays the bill (member name); default the sender"),
      category: z.enum(EXPENSE_CATEGORIES).optional().describe("Default utilities"),
      splitAmong: shareFields.splitAmong,
      percents: shareFields.percents,
      shares: shareFields.shares,
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const e = await setVariableExpense(ctx, {
        description: input.description,
        dueDay: input.dueDay,
        ...(input.category ? { category: input.category } : {}),
        ...(input.payer ? { payerId: await memberIdByName(ctx, input.payer) } : {}),
        ...(await resolveShares(ctx, input)),
      });
      return { bill: e.description, firstAsk: e.occurredOn, paidBy: e.payerName, method: e.method, next: `Confirm in one line: on the due day you'll ask ${e.payerName} how much it was.` };
    },
  }),
  answer_amount: createTool({
    id: "answer_amount",
    description:
      "The amount of a bill Roomie asked for ('92' in reply to 'How much was the electric bill?', 'roomie electric was 92', 'yes' to a prefilled amount: pass that amount). Logs this month's bill split like always. Only the bill's payer or an admin.",
    inputSchema: z.object({
      amount: z.number().positive().describe("In the group's currency"),
      bill: z.string().optional().describe("Which bill, when more than one is waiting (e.g. 'electric')"),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      let expenseId: string | undefined;
      if (input.bill) {
        // The variable parent the bill names; anything else (no match, two) lets the service ask which.
        const hits = await Promise.all((await findExpenses(ctx, input.bill.replace(/\s+bill$/i, ""))).map((h) => getExpense(ctx, h.id)));
        const parents = hits.filter((e) => e?.variable && !e.recurringParentId);
        if (parents.length === 1) expenseId = parents[0]!.id;
      }
      const { expense } = await answerAmount(ctx, { cents: toCents(input.amount), ...(expenseId ? { expenseId } : {}) });
      const currency = await groups.currencyOf(ctx.groupId);
      const summary = expenseSummary(expense, currency);
      return { logged: summary.description, total: moneyIn(currency)(expense.cents), date: summary.date, paidBy: summary.paidBy, ...(inDm(context) ? { shares: summary.shares } : {}) };
    },
  }),
};
