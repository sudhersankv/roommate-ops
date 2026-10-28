// P1 · Sudhersan.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { money } from "@/services";
import { ctxOf, memberIdByName, toCents } from "../util";

export const moneyTools = {
  log_expense: createTool({
    id: "log_expense",
    description:
      "Record that someone paid for something shared ('I paid $60 for internet'). Defaults: payer = sender, split evenly among everyone. Amount is in dollars; the service converts to cents and computes the split.",
    inputSchema: z.object({
      amount: z.number().positive().describe("Dollars, e.g. 62.5"),
      description: z.string().min(1).describe("What it was for, e.g. 'internet'"),
      payer: z.string().optional().describe("Member name if not the sender"),
      splitAmong: z.array(z.string()).optional().describe("Member names; omit for everyone"),
    }),
    execute: async ({ amount, description, payer, splitAmong }, context) => {
      const ctx = ctxOf(context);
      return money.logExpense(ctx, {
        cents: toCents(amount),
        description,
        payerId: payer ? await memberIdByName(ctx, payer) : undefined,
        splitAmong: splitAmong ? await Promise.all(splitAmong.map((n) => memberIdByName(ctx, n))) : undefined,
      });
    },
  }),
  get_balances: createTool({
    id: "get_balances",
    description:
      "Who owes what: current balances (positive = is owed, negative = owes) plus the minimal set of payments to settle up. Amounts are in CENTS; divide by 100 when you say them.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      return { balances: await money.getBalances(ctx), settlePlan: await money.getSettlePlan(ctx) };
    },
  }),
  settle_up: createTool({
    id: "settle_up",
    description: "Record a payment between members (e.g. 'I paid Ryan back $30'). Default payer = sender.",
    inputSchema: z.object({
      to: z.string().min(1).describe("Member who got paid"),
      amount: z.number().positive().describe("Dollars"),
      from: z.string().optional().describe("Member who paid, if not the sender"),
    }),
    execute: async ({ to, amount, from }, context) => {
      const ctx = ctxOf(context);
      await money.settleUp(ctx, {
        toId: await memberIdByName(ctx, to),
        fromId: from ? await memberIdByName(ctx, from) : undefined,
        cents: toCents(amount),
      });
      return { ok: true };
    },
  }),
  list_expenses: createTool({
    id: "list_expenses",
    description: "Recent shared expenses, newest first, with who paid and each person's share (cents).",
    inputSchema: z.object({ limit: z.number().int().positive().max(50).optional().describe("Default 10") }),
    execute: async ({ limit }, context) => money.listExpenses(ctxOf(context), limit ?? 10),
  }),
};
