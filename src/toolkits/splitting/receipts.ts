import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { EXPENSE_CATEGORIES } from "@/db/enums";
import { cart, groups, members, money, receipts } from "@/services";
import { expenseSummary } from "@/services/money";
import { recordReceiptItems } from "@/services/restock";
import { moneyIn } from "@/services/types";
import { ctxOf, memberIdByName, toCents } from "../util";

export const receiptTools = {
  expense_from_receipt: createTool({
    id: "expense_from_receipt",
    description:
      "A photo of a receipt -> an expense with exact shares per item. Pass who had what as people said it ('steak -> Dev', 'wine shared'); items nobody claimed are shared by everyone, and tax and tip follow each person's items. " +
      "confirm=false (the default) reads the receipt and returns the breakdown without logging: show it in one or two lines and ask. confirm=true logs it; use it when they explicitly asked to log it, or said yes to the breakdown. " +
      "If the receipt's printed total doesn't match its items, say both numbers and ask which to use (pass it as total). " +
      "A grocery or household receipt while the Cart has those things closes the Cart (`closesCart`): lines on the Cart go to whoever added them (shared ones split evenly), they're marked bought and the Checkout paid. Show the breakdown first unless they asked to log it. If it returns `ask`, ask just that one question about the lines that weren't on the Cart, then call again with the answer in assignments ('shared' -> ['everyone']). 'I paid 84' without a receipt stays cart_purchased.",
    inputSchema: z.object({
      receipt_url: z.string().min(1).describe("The photo's url from the message"),
      assignments: z
        .array(z.object({ item: z.string().describe("As they said it, e.g. 'steak'"), who: z.array(z.string()).describe("Member names; ['everyone'] for shared") }))
        .optional(),
      payer: z.string().optional().describe("Member name if the sender didn't pay"),
      total: z.number().positive().optional().describe("In the group's currency, only when they picked a total different from the items' sum"),
      description: z.string().optional().describe("Default: the merchant"),
      category: z.enum(EXPENSE_CATEGORIES).optional().describe("Default: food for restaurants, else your pick"),
      confirm: z.boolean().optional(),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      await receipts.requireGroupUpload(input.receipt_url, ctx.groupId);
      const group = await groups.getGroup(ctx.groupId);
      const parsed = await receipts.parseReceipt({ url: input.receipt_url }, group?.currency);
      const amount = moneyIn(group?.currency);
      const everyone = (await members.listMembers(ctx)).map((m) => m.id);
      const payerId = input.payer ? await memberIdByName(ctx, input.payer) : ctx.memberId;
      const assignments = await Promise.all(
        (input.assignments ?? []).map(async (a) => ({
          item: a.item,
          memberIds: a.who.some((w) => /^(everyone|all|shared|us|we)$/i.test(w.trim())) ? everyone : await Promise.all(a.who.map((n) => memberIdByName(ctx, n))),
        })),
      );
      const totalCents = input.total !== undefined ? toCents(input.total) : parsed.totalCents;
      const people = await members.listMembers(ctx);
      const nameOf = (id: string) => people.find((p) => p.id === id)?.displayName ?? "Someone";
      const whoOf = (ids: string[]) => (ids.length === everyone.length ? "everyone" : ids.map(nameOf));
      const mismatch = parsed.mismatch && input.total === undefined;
      const warning = mismatch ? { warning: `The receipt says ${amount(parsed.printedTotalCents!)}, but its items, tax and tip add up to ${amount(parsed.totalCents)}. Ask which total is right before logging.` } : {};

      // A grocery or household receipt while the Cart has those things closes the Cart (cart.closeCartWithReceipt).
      const groceryLike = input.category === undefined || input.category === "groceries" || input.category === "household";
      const plan = groceryLike ? await cart.planCartReceipt(ctx, { receipt: parsed, totalCents, assignments, payerId }) : null;
      if (plan) {
        const ask = cart.unmatchedQuestion(plan.unanswered, amount);
        const breakdown = {
          closesCart: true,
          merchant: parsed.merchant,
          date: parsed.date,
          items: plan.lines.map((l) => ({ name: l.name, price: amount(l.cents), who: whoOf(l.memberIds), ...(l.cartItem ? { cartItem: l.cartItem.name } : { notOnCart: true }) })),
          tax: amount(parsed.taxCents),
          tip: amount(parsed.tipCents),
          total: amount(totalCents),
          perPerson: plan.rows.map((r) => ({ name: nameOf(r.memberId), owes: amount(r.cents) })),
          ...(plan.notOnReceipt.length ? { staysInCart: plan.notOnReceipt.map((i) => i.name) } : {}),
          ...(ask ? { ask } : {}),
          ...warning,
        };
        if (!input.confirm || mismatch || ask) return { logged: false, needsConfirmation: true, ...breakdown };
        const r = await cart.closeCartWithReceipt(ctx, {
          receipt: parsed,
          totalCents,
          receiptUrl: input.receipt_url,
          assignments,
          payerId,
          description: input.description,
          category: input.category ?? "groceries",
          occurredOn: parsed.date && parsed.date <= (await money.todayIn(ctx.groupId)) ? parsed.date : undefined,
          note: plan.lines.map((l) => `${l.name} ${amount(l.cents)}`).join(", ").slice(0, 500),
        });
        return { logged: true, closedCart: true, purchased: r.purchased, checkoutPaid: !!r.checkoutId, ...(r.notOnReceipt.length ? { staysInCart: r.notOnReceipt.map((i) => i.name) } : {}), ...expenseSummary(r.expense, group?.currency) };
      }

      const { rows, items } = receipts.receiptSplits(parsed, assignments, everyone, payerId, totalCents);
      const breakdown = {
        merchant: parsed.merchant,
        date: parsed.date,
        items: items.map((i) => ({ name: i.name, price: amount(i.cents), who: whoOf(i.memberIds) })),
        tax: amount(parsed.taxCents),
        tip: amount(parsed.tipCents),
        total: amount(totalCents),
        perPerson: rows.map((r) => ({ name: nameOf(r.memberId), owes: amount(r.cents) })),
        ...warning,
      };
      if (!input.confirm || mismatch) return { logged: false, needsConfirmation: true, ...breakdown };
      const e = await money.logExpense(ctx, {
        cents: totalCents,
        description: input.description ?? parsed.merchant,
        category: input.category ?? "food",
        method: "exact",
        splits: rows,
        payerId,
        occurredOn: parsed.date && parsed.date <= (await money.todayIn(ctx.groupId)) ? parsed.date : undefined,
        receiptUrl: input.receipt_url,
        note: items.map((i) => `${i.name} ${amount(i.cents)}`).join(", ").slice(0, 500),
      });
      // Restock learns from what was bought (grocery and household receipts; claimed lines are that Member's).
      await recordReceiptItems(ctx, { id: e.id, category: e.category ?? "" }, items, everyone).catch((err) => console.warn("[receipts] restock events failed", err));
      return { logged: true, ...expenseSummary(e, group?.currency) };
    },
  }),
};
