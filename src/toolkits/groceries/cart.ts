// Cart tools: thin wrappers over services/cart. No prices anywhere here (real money comes from the receipt), and no
// links on routine actions: the Cart page goes out only when someone asks for it (cart_view link: true), and the
// Instacart list on checkout.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { cart, groups } from "@/services";
import { addPhotoToCart, photoSummary, readGroceryPhoto } from "@/services/grocery-photos";
import { expenseSummary } from "@/services/money";
import { checkoutSuggestions } from "@/services/restock";
import { checkoutAskLine } from "@/services/restock-math";
import { ctxOf, dashboardLinks, memberIdByName, toCents } from "../util";

type Item = { name: string; qty: string; shared: boolean; addedByName: string; recipeTitle?: string | null };
/** What Roomie sees of a Cart item: what, how much, for whom. */
const said = (i: Item) => ({ name: i.name, qty: i.qty, ...(i.shared ? { shared: true } : { for: i.addedByName }), ...(i.recipeTitle ? { recipe: i.recipeTitle } : {}) });

const itemSchema = z.object({
  name: z.string().min(1).describe("Item name without the quantity, e.g. 'chips'"),
  qty: z.string().optional().describe("The quantity exactly as they said it, e.g. '3 bags', '2 cartons', '12', '1 lb'. Omit for 1."),
});

export const cartTools = {
  cart_add: createTool({
    id: "cart_add",
    description:
      "Add grocery items to the shared cart, attributed to the sender ('add 3 bags of chips for me' -> one item, name 'chips', qty '3 bags'), or to `for` ('oat milk for Dev'). shared=true for things the whole group uses (toilet paper, dish soap, 'for the house', 'common'). If it's unclear whether it's for them or everyone, ask first. Quantities are stored as said (omit qty when they didn't say one: their usual is filled in and comes back in `usedUsual`; say it, 'Eggs, 18 like usual.'); if the result has `needsClarification`, those items were NOT added: ask that one short question (and say what was added, if anything), then call cart_add again with only those items. No prices: never say a price or total.",
    inputSchema: z.object({
      items: z.array(itemSchema).min(1),
      shared: z.boolean().optional().describe("true when it's for the whole house, not one person"),
      for: z.string().optional().describe("A member's first name when it's for someone else; omit for the sender"),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const forMemberId = input.for && !input.shared ? await memberIdByName(ctx, input.for) : undefined;
      const { added, needsClarification, usedUsual } = await cart.addAsSaid(ctx, { items: input.items, shared: input.shared, forMemberId });
      const open = await cart.listOpenItems(ctx);
      return {
        added: added.map(said),
        cartItemCount: open.length,
        ...(usedUsual.length ? { usedUsual } : {}),
        ...(needsClarification.length ? { needsClarification } : {}),
      };
    },
  }),
  cart_remove: createTool({
    id: "cart_remove",
    description: "Remove an item from the open cart by name (case-insensitive). Whoever added it or an admin can. `removed: false` means it wasn't in the cart.",
    inputSchema: z.object({ name: z.string().min(1) }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const removed = await cart.removeItem(ctx, input);
      return { removed, cartItemCount: (await cart.listOpenItems(ctx)).length };
    },
  }),
  cart_view: createTool({
    id: "cart_view",
    description:
      "The open cart grouped by who it's for ('Shared' = everyone; recipe items say which recipe). No prices. link=true only when they ask where the Cart page is or for a link to it; then the button is attached for you.",
    inputSchema: z.object({ link: z.boolean().optional().describe("true only when they asked for the Cart page / a link") }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const groups = await cart.viewCart(ctx);
      const view = Object.fromEntries(Object.entries(groups).map(([who, items]) => [who, items.map((i) => ({ name: i.name, qty: i.qty, ...(i.recipeTitle ? { recipe: i.recipeTitle } : {}) }))]));
      const itemCount = Object.values(groups).flat().length;
      return { groups: view, itemCount, ...(input.link ? dashboardLinks("🛒 The Cart", `/g/${ctx.groupId}/cart`) : {}) };
    },
  }),
  cart_from_photo: createTool({
    id: "cart_from_photo",
    description:
      "A photo of a recipe, a shopping list or a shelf ('[photo: <url>]' in the message) -> the things to buy. confirm=false (the default) only reads it: say the `summary` in one line and ask whether to add them (as shared, or for whom) unless they already said ('all common' = shared). confirm=true adds them (a recipe is saved too and its ingredients go in minus the Pantry and `skip`). If `kind` is 'receipt', it's money, not groceries: use expense_from_receipt (`next`) with the same url.",
    inputSchema: z.object({
      photo_url: z.string().min(1).describe("The photo's url from the message"),
      shared: z.boolean().optional().describe("true when it's for the whole house ('all common', 'for everyone')"),
      for: z.string().optional().describe("A member's first name when it's for someone else"),
      confirm: z.boolean().optional().describe("true once they said yes (or explicitly asked to add them)"),
      skip: z.array(z.string()).optional().describe("Things they say they already have"),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const photo = await readGroceryPhoto(input.photo_url, ctx.groupId);
      // Groceries requires Money (its manifest says so), so the receipt tool is always there.
      if (photo.kind === "receipt") return { kind: "receipt", next: "expense_from_receipt" };
      if (photo.items.length === 0) return { kind: photo.kind, items: [], say: "I can't find a list or a recipe in that photo." };
      if (!input.confirm) {
        const items = photo.items.map((i) => ({ name: i.name, ...(i.qty ? { qty: i.qty } : {}) }));
        return { kind: photo.kind, ...(photo.title ? { title: photo.title } : {}), items, summary: photoSummary(photo.items), needsConfirmation: true };
      }
      const forMemberId = input.for && !input.shared ? await memberIdByName(ctx, input.for) : undefined;
      const r = await addPhotoToCart(ctx, photo, { shared: input.shared, forMemberId, skip: input.skip });
      return {
        kind: r.kind,
        ...(r.recipe ? { recipe: r.recipe } : {}),
        added: r.added,
        addedCount: r.added.length,
        ...(r.skippedHave.length ? { skippedHave: r.skippedHave } : {}),
        ...(r.alreadyInCart.length ? { alreadyInCart: r.alreadyInCart } : {}),
        ...(r.needsClarification.length ? { needsClarification: r.needsClarification } : {}),
      };
    },
  }),
  cart_checkout: createTool({
    id: "cart_checkout",
    description:
      "Someone wants to check out / order the cart / get the Instacart list. Makes an Instacart shopping list of the open cart and records the Checkout; the 'Open in Instacart' button is attached for you. Say the item count (no prices: the receipt has those). If `available` is false, relay `message`. " +
      "If probably-low items aren't in the Cart it returns `askFirst` with `suggested` and `say` instead (no list yet): post `say` and wait. Call it again with skip_suggestions=true when they said 'just checkout' (then never ask), or after they answered (add the ones they want first).",
    inputSchema: z.object({
      skip_suggestions: z.boolean().optional().describe("true for 'just checkout', or once they've answered the probably-low question"),
    }),
    execute: async ({ skip_suggestions }, context) => {
      const ctx = ctxOf(context);
      const inDm = (context?.requestContext as { get(k: string): unknown } | undefined)?.get("isPrivate") === true;
      const suggested = skip_suggestions ? [] : await checkoutSuggestions(ctx, { mine: inDm });
      if (suggested.length) return { askFirst: true, suggested, itemCount: (await cart.listOpenItems(ctx)).length, say: checkoutAskLine(suggested) };
      const c = await cart.checkout(ctx);
      const summary = { checkoutId: c.id, itemCount: c.itemCount };
      if (!c.url) return { available: false, message: `${c.unavailable ?? "The Instacart link isn't available yet."} Buy it yourselves and tell me the total.`, ...summary };
      return { available: true, ...summary, links: [{ text: "🛒 Open in Instacart", url: c.url }] };
    },
  }),
  cart_purchased: createTool({
    id: "cart_purchased",
    description:
      "Someone bought the cart for a total ('I paid 84 for groceries', 'I bought the groceries, $84'), including after a checkout. Use this, not log_expense, for the grocery run. Creates one expense split by who added what (each item counts the same; shared items split evenly) and clears the cart. Default payer = sender. Returns `shares`: each person's part as ready-to-say amounts.",
    inputSchema: z.object({
      total: z.number().positive().describe("In the group's currency, e.g. 84.2"),
      payer: z.string().optional().describe("Who paid, by first name. Omit for the sender."),
    }),
    execute: async ({ total, payer }, context) => {
      const ctx = ctxOf(context);
      const e = await cart.markPurchased(ctx, { totalCents: toCents(total), payerId: payer ? await memberIdByName(ctx, payer) : undefined });
      return { ...expenseSummary(e, await groups.currencyOf(ctx.groupId)), cents: e.cents, payerName: e.payerName, splits: e.splits };
    },
  }),
};
