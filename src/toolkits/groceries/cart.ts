// P2 · Sudhersan. Cart tools: thin wrappers over services/cart. Buttons go out as `links` in the result (never pasted URLs).
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { cart } from "@/services";
import { dollars } from "@/services/types";
import { ctxOf, dashboardLinks, memberIdByName, toCents } from "../util";

/** The View-cart button; omitted when APP_URL is not an absolute URL. */
const viewCart = () => dashboardLinks("🛒 View cart", "/cart");

export const cartTools = {
  cart_add: createTool({
    id: "cart_add",
    description:
      "Add grocery items to the shared cart, attributed to the sender ('add 3 bags of chips for me' -> one item, name 'chips', qty '3 bags'). shared=true for household items (toilet paper, dish soap). Returns addedTotal (just these items) and cartTotal (the whole open cart). A View-cart button is attached automatically; don't paste URLs.",
    inputSchema: z.object({
      items: z
        .array(
          z.object({
            name: z.string().min(1).describe("Item name without the quantity, e.g. 'chips'"),
            qty: z.string().optional().describe("Free text quantity, e.g. '3 bags', '2', '1 gallon'. Omit for 1."),
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
        ...viewCart(),
      };
    },
  }),
  cart_remove: createTool({
    id: "cart_remove",
    description: "Remove an item from the open cart by name (case-insensitive).",
    inputSchema: z.object({ name: z.string().min(1) }),
    execute: async (input, context) => ({ removed: await cart.removeItem(ctxOf(context), input) }),
  }),
  cart_view: createTool({
    id: "cart_view",
    description: "Show the open cart grouped by who added each item, with estimated prices and the estimated total.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const groups = await cart.viewCart(ctxOf(context));
      const all = Object.values(groups).flat();
      const estTotalCents = cart.cartTotal(all);
      return { groups, itemCount: all.length, estTotalCents, estTotal: dollars(estTotalCents), ...(all.length ? viewCart() : {}) };
    },
  }),
  cart_checkout: createTool({
    id: "cart_checkout",
    description:
      "Someone wants to check out / order the cart. Instacart checkout isn't available yet: tell them it's coming soon (use `message`) and mention the item count and estimated total.",
    inputSchema: z.object({}),
    execute: async (_input, context) => {
      const items = await cart.listOpenItems(ctxOf(context));
      const estTotalCents = cart.cartTotal(items);
      return {
        available: false,
        message: "Instacart checkout is coming soon. For now, buy it yourselves and tell me the total.",
        itemCount: items.length,
        estTotalCents,
        estTotal: dollars(estTotalCents),
      };
    },
  }),
  cart_purchased: createTool({
    id: "cart_purchased",
    description:
      "Someone bought the cart for a total ('I bought the groceries, $84'). Creates one expense split by who added what (shared items split evenly) and clears the cart. Default payer = sender.",
    inputSchema: z.object({
      total: z.number().positive().describe("Dollars, e.g. 84.2"),
      payer: z.string().optional().describe("Who paid, by first name. Omit for the sender."),
    }),
    execute: async ({ total, payer }, context) => {
      const ctx = ctxOf(context);
      return cart.markPurchased(ctx, { totalCents: toCents(total), payerId: payer ? await memberIdByName(ctx, payer) : undefined });
    },
  }),
};
