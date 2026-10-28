// Cart tools: thin wrappers over services/cart. Buttons go out as `links` in the result (never pasted URLs).
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { cart } from "@/services";
import { dollars } from "@/services/types";
import { expenseSummary } from "../splitting/money";
import { ctxOf, dashboardLinks, memberIdByName, toCents } from "../util";

/** The View-cart button; omitted when APP_URL is not an absolute URL. */
const viewCart = (groupId: string) => dashboardLinks("🛒 View cart", `/g/${groupId}/cart`);

export const cartTools = {
  cart_add: createTool({
    id: "cart_add",
    description:
      "Add grocery items to the shared cart, attributed to the sender ('add 3 bags of chips for me' -> one item, name 'chips', qty '3 bags'). shared=true for things the whole group uses (toilet paper, dish soap, 'for the house'). If it's unclear whether it's for them or everyone, ask first. Returns addedTotal (just these items) and cartTotal (the whole open cart). A View-cart button is attached automatically; don't paste URLs.",
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            name: z.string().min(1).describe("Item name without the quantity, e.g. 'chips'"),
            qty: z.string().optional().describe("Free text quantity, e.g. '3 bags', '2', '1 gallon', '2 lb'. Omit for 1."),
          }),
        )
        .min(1),
      shared: z.boolean().optional().describe("true when it's for the whole house, not one person"),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const items = await cart.addItems(ctx, input);
      const open = await cart.listOpenItems(ctx);
      const addedTotalCents = cart.cartTotal(items);
      const cartTotalCents = cart.cartTotal(open);
      return {
        items,
        addedTotalCents,
        addedTotal: dollars(addedTotalCents),
        cartItemCount: open.length,
        cartTotalCents,
        cartTotal: dollars(cartTotalCents),
        ...viewCart(ctx.groupId),
      };
    },
  }),
  cart_remove: createTool({
    id: "cart_remove",
    description: "Remove an item from the open cart by name (case-insensitive). Whoever added it or an admin can.",
    inputSchema: z.object({ name: z.string().min(1) }),
    execute: async (input, context) => ({ removed: await cart.removeItem(ctxOf(context), input) }),
  }),
  cart_view: createTool({
    id: "cart_view",
    description: "Show the open cart grouped by who added each item (recipe items say which recipe), with estimated prices and the estimated total.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const groups = await cart.viewCart(ctx);
      const all = Object.values(groups).flat();
      const estTotalCents = cart.cartTotal(all);
      return { groups, itemCount: all.length, estTotalCents, estTotal: dollars(estTotalCents), ...(all.length ? viewCart(ctx.groupId) : {}) };
    },
  }),
  cart_checkout: createTool({
    id: "cart_checkout",
    description:
      "Someone wants to check out / order the cart / get the Instacart list. Makes an Instacart shopping list of the open cart and records the Checkout; the 'Open in Instacart' button is attached for you. Say the item count and estimated total. If `available` is false, relay `message` (buy it yourselves and tell me the total).",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const ctx = ctxOf(context);
      const c = await cart.checkout(ctx);
      const summary = { checkoutId: c.id, itemCount: c.itemCount, estTotalCents: c.estCents, estTotal: dollars(c.estCents) };
      if (!c.url) return { available: false, message: `${c.unavailable ?? "The Instacart link isn't available yet."} Buy it yourselves and tell me the total.`, ...summary };
      return { available: true, ...summary, links: [{ text: "🛒 Open in Instacart", url: c.url }] };
    },
  }),
  cart_purchased: createTool({
    id: "cart_purchased",
    description:
      "Someone bought the cart for a total ('I paid 84 for groceries', 'I bought the groceries, $84'), including after a checkout. Use this, not log_expense, for the grocery run. Creates one expense split by who added what (shared items split evenly, scaled from the estimates) and clears the cart. Default payer = sender. Returns `shares`: each person's part as ready-to-say amounts.",
    inputSchema: z.object({
      total: z.number().positive().describe("Dollars, e.g. 84.2"),
      payer: z.string().optional().describe("Who paid, by first name. Omit for the sender."),
    }),
    execute: async ({ total, payer }, context) => {
      const ctx = ctxOf(context);
      const e = await cart.markPurchased(ctx, { totalCents: toCents(total), payerId: payer ? await memberIdByName(ctx, payer) : undefined });
      return { ...expenseSummary(e), cents: e.cents, payerName: e.payerName, splits: e.splits, ...dashboardLinks("See the expense", `/g/${ctx.groupId}/money/${e.id}`) };
    },
  }),
};
