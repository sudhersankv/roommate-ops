// The shared grocery Cart. Items are attributed to whoever added them; a Checkout snapshots the open Cart into an
// Instacart shopping list; "I paid" logs ONE Expense split by who added what (weighted by estCents, shared items
// split evenly across active Members). The split math is pure, in cart-split.ts, so the dashboard previews with it.
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CheckoutItem } from "@/db/schema";
import { estimate } from "@/lib/prices";
import { measurementOrEach, parseAmount } from "@/lib/units";
import { dashboardUrl } from "@/lib/urls";
import { InstacartUnavailableError, instacartClient } from "@/integrations/instacart";
import { record } from "./activity";
import { NotAllowedError, requireActive } from "./authz";
import { cartTotal, computeCartSplits } from "./cart-split";
import { listMembers } from "./members";
import { logExpense, type Expense } from "./money";
import { dollars, type Ctx, type GroupCtx } from "./types";

export { cartTotal, computeCartSplits, type SplitItem } from "./cart-split";

const { cartItems, cartCheckouts, members, recipes } = schema;

export type CartItem = {
  id: string;
  name: string;
  qty: string;
  addedByName: string;
  shared: boolean;
  estCents: number | null;
  addedBy?: string;
  createdAt?: Date;
  /** Set when it came from a Recipe. */
  recipeId?: string | null;
  recipeTitle?: string | null;
  quantity?: number | null;
  unit?: string | null;
};

/* ---------- services ---------- */

type Row = typeof cartItems.$inferSelect;

async function namesFor(groupId: string): Promise<Map<string, string>> {
  // Every Member of the Group, including anyone who moved out, so old items still show a name.
  const rows = await db.select({ id: members.id, name: members.displayName }).from(members).where(eq(members.groupId, groupId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function recipeTitles(groupId: string): Promise<Map<string, string>> {
  const rows = await db.select({ id: recipes.id, title: recipes.title }).from(recipes).where(eq(recipes.groupId, groupId));
  return new Map(rows.map((r) => [r.id, r.title]));
}

const toItem = (r: Row, names: Map<string, string>, titles: Map<string, string>): CartItem => ({
  id: r.id,
  name: r.name,
  qty: r.qty,
  addedByName: names.get(r.addedBy) ?? "Someone",
  shared: r.shared,
  estCents: r.estCents,
  addedBy: r.addedBy,
  createdAt: r.createdAt,
  recipeId: r.recipeId,
  recipeTitle: r.recipeId ? (titles.get(r.recipeId) ?? null) : null,
  quantity: r.quantity === null ? null : Number(r.quantity),
  unit: r.unit,
});

async function openRows(groupId: string): Promise<Row[]> {
  return db
    .select()
    .from(cartItems)
    .where(and(eq(cartItems.groupId, groupId), eq(cartItems.status, "open")))
    .orderBy(asc(cartItems.createdAt), asc(cartItems.id));
}

/** Open items with adder names (and Recipe titles), oldest first. */
export async function listOpenItems(ctx: GroupCtx): Promise<CartItem[]> {
  const [rows, names, titles] = await Promise.all([openRows(ctx.groupId), namesFor(ctx.groupId), recipeTitles(ctx.groupId)]);
  return rows.map((r) => toItem(r, names, titles));
}

/** Items are attributed to ctx.memberId. estCents comes from lib/prices (catalog), not the LLM. */
export async function addItems(ctx: Ctx, input: { items: { name: string; qty?: string }[]; shared?: boolean }): Promise<CartItem[]> {
  await requireActive(ctx);
  const items = input.items
    .map((i) => ({ name: i.name.trim().replace(/\s+/g, " "), qty: (i.qty ?? "").trim() || "1" }))
    .filter((i) => i.name);
  if (items.length === 0) throw new Error("Add what? Give me at least one item name.");
  const rows = await db
    .insert(cartItems)
    .values(
      items.map((i) => {
        const amount = parseAmount(i.qty);
        return {
          groupId: ctx.groupId,
          name: i.name,
          qty: i.qty,
          quantity: amount ? String(amount.quantity) : null,
          unit: amount?.unit ?? null,
          addedBy: ctx.memberId,
          shared: !!input.shared,
          estCents: estimate(i.name, i.qty),
        };
      }),
    )
    .returning();
  const names = await namesFor(ctx.groupId);
  return rows.map((r) => toItem(r, names, new Map()));
}

/** Whoever added an item, or an Admin, can take it off. */
function checkRemove(actor: { id: string; role: string }, item: { addedBy: string; name: string }, adderName: string) {
  if (actor.role === "admin" || item.addedBy === actor.id) return;
  throw new NotAllowedError(`Only ${adderName} (who added ${item.name}) or an admin can take it off the Cart.`, "not-yours");
}

/**
 * Remove the newest open item whose name matches: exact (case-insensitive) first, then contains. Among matches, one
 * the sender may remove wins; if they may remove none of them, it's refused.
 */
export async function removeItem(ctx: Ctx, input: { name: string }): Promise<boolean> {
  const actor = await requireActive(ctx);
  const q = input.name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return false;
  const rows = await db
    .select({ id: cartItems.id, name: cartItems.name, addedBy: cartItems.addedBy })
    .from(cartItems)
    .where(and(eq(cartItems.groupId, ctx.groupId), eq(cartItems.status, "open")))
    .orderBy(desc(cartItems.createdAt), desc(cartItems.id));
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const exact = rows.filter((r) => norm(r.name) === q);
  const hits = exact.length ? exact : rows.filter((r) => norm(r.name).includes(q) || q.includes(norm(r.name)));
  if (hits.length === 0) return false;
  const mine = hits.find((r) => actor.role === "admin" || r.addedBy === actor.id);
  if (!mine) checkRemove(actor, hits[0], (await namesFor(ctx.groupId)).get(hits[0].addedBy) ?? "whoever");
  await db.delete(cartItems).where(eq(cartItems.id, mine!.id));
  return true;
}

/** Remove one open item by id. Group-scoped, so a stale or foreign id can't touch another Group's Cart. */
export async function removeItemById(ctx: Ctx, input: { id: string }): Promise<boolean> {
  const actor = await requireActive(ctx);
  const id = input.id.trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const [item] = await db
    .select({ id: cartItems.id, name: cartItems.name, addedBy: cartItems.addedBy })
    .from(cartItems)
    .where(and(eq(cartItems.id, id), eq(cartItems.groupId, ctx.groupId), eq(cartItems.status, "open")));
  if (!item) return false;
  checkRemove(actor, item, (await namesFor(ctx.groupId)).get(item.addedBy) ?? "whoever");
  const gone = await db.delete(cartItems).where(and(eq(cartItems.id, id), eq(cartItems.status, "open"))).returning({ id: cartItems.id });
  return gone.length > 0;
}

/** Open items grouped by who added them ("Shared" for shared items). Shared group last. */
export async function viewCart(ctx: GroupCtx): Promise<Record<string, CartItem[]>> {
  const items = await listOpenItems(ctx);
  const groups: Record<string, CartItem[]> = {};
  for (const i of items.filter((x) => !x.shared)) (groups[i.addedByName] ??= []).push(i);
  const shared = items.filter((x) => x.shared);
  if (shared.length) groups.Shared = shared;
  return groups;
}

/* ---------- Checkout ---------- */

export type Checkout = {
  id: string;
  /** Null when Instacart couldn't be reached; `unavailable` says why. */
  url: string | null;
  unavailable?: string;
  itemCount: number;
  estCents: number;
  items: CheckoutItem[];
  createdAt: Date;
};

const snapshotOf = (r: Row): CheckoutItem => ({
  id: r.id,
  name: r.name,
  qty: r.qty,
  quantity: r.quantity === null ? null : Number(r.quantity),
  unit: r.unit,
  shared: r.shared,
  addedBy: r.addedBy,
  estCents: r.estCents,
  recipeId: r.recipeId,
});

/** The Instacart line for a Cart item: its structured amount, else parsed from the free-text qty, else 1 each. */
export function lineItemFor(i: Pick<CheckoutItem, "name" | "qty" | "quantity" | "unit">) {
  const amount = i.quantity !== null && i.unit ? measurementOrEach(i.quantity, i.unit) : (parseAmount(i.qty) ?? { quantity: 1, unit: "each" as const });
  return { name: i.name.toLowerCase(), displayText: i.qty && i.qty !== "1" ? `${i.name} (${i.qty})` : i.name, measurements: [amount] };
}

/**
 * Check out: snapshot the open Cart, make an Instacart shopping list from it and record a Checkout, so "I paid"
 * can point at what was ordered. The same open items as the last unpaid Checkout reuse its link. When Instacart
 * can't be reached the Checkout is still recorded (url null) and `unavailable` says why.
 */
export async function checkout(ctx: Ctx): Promise<Checkout> {
  await requireActive(ctx);
  const rows = await openRows(ctx.groupId);
  if (rows.length === 0) throw new Error("The cart is empty, so there's nothing to check out. Add items first ('roomie, add milk').");
  const items = rows.map(snapshotOf);
  const estCents = cartTotal(items);
  const sameItems = (snap: CheckoutItem[]) => snap.length === items.length && snap.every((s, k) => s.id === items[k].id && s.qty === items[k].qty);
  const [last] = await db
    .select()
    .from(cartCheckouts)
    .where(and(eq(cartCheckouts.groupId, ctx.groupId), isNull(cartCheckouts.paidAt)))
    .orderBy(desc(cartCheckouts.createdAt))
    .limit(1);
  if (last?.instacartUrl && sameItems(last.itemsSnapshot)) {
    return { id: last.id, url: last.instacartUrl, itemCount: items.length, estCents, items, createdAt: last.createdAt };
  }

  let url: string | null = null;
  let unavailable: string | undefined;
  try {
    const linkback = dashboardUrl(`/g/${ctx.groupId}/cart`);
    url = (await instacartClient().shoppingListPage({ title: "Roomie Cart", lineItems: items.map(lineItemFor), linkbackUrl: linkback && /^https?:\/\//.test(linkback) ? linkback : null })).url;
  } catch (e) {
    if (!(e instanceof InstacartUnavailableError)) throw e;
    unavailable = e.message;
  }
  const [row] = await db.insert(cartCheckouts).values({ groupId: ctx.groupId, createdBy: ctx.memberId, itemsSnapshot: items, estCents, instacartUrl: url }).returning();
  await record(ctx.groupId, ctx.memberId, "cart.checkout", `checked out the Cart (${items.length} item${items.length === 1 ? "" : "s"}, about ${dollars(estCents)})`, { table: "cart_checkouts", id: row.id });
  return { id: row.id, url, ...(unavailable ? { unavailable } : {}), itemCount: items.length, estCents, items, createdAt: row.createdAt };
}

/** The newest Checkout nobody has paid for yet. */
export async function lastUnpaidCheckout(ctx: GroupCtx): Promise<Checkout | undefined> {
  const [row] = await db
    .select()
    .from(cartCheckouts)
    .where(and(eq(cartCheckouts.groupId, ctx.groupId), isNull(cartCheckouts.paidAt)))
    .orderBy(desc(cartCheckouts.createdAt))
    .limit(1);
  if (!row) return undefined;
  return { id: row.id, url: row.instacartUrl, itemCount: row.itemsSnapshot.length, estCents: row.estCents, items: row.itemsSnapshot, createdAt: row.createdAt };
}

/* ---------- paying for it ---------- */

/**
 * Payer bought the cart: one Expense (exact Shares, category groceries) split by who added what, weighted by
 * estCents and scaled to the real total; shared items split evenly. With `checkoutId` only that Checkout's items
 * (still open) are charged; otherwise every open item, and the newest unpaid Checkout they cover is marked paid.
 *
 * Atomic against retries and double-clicks. Inside one transaction the items are flipped to "purchased" FIRST
 * (`UPDATE ... WHERE status = 'open' RETURNING *`); the rows that came back are the only items this purchase may
 * charge for, and zero rows means someone else already bought it (or the cart is empty), so we throw and the second
 * click fails cleanly. Only then is the Expense written through money.logExpense, which stays the single writer of
 * Expenses. If logExpense throws (bad payer, bad splits, DB error) the surrounding transaction rolls the UPDATE back
 * and the items stay open. A concurrent call blocks on the row locks until the first one commits, then its UPDATE
 * sees status = "purchased" and matches nothing.
 *
 * Trade-off: logExpense runs its own transaction on a second connection, so the one remaining window is the outer
 * commit failing after the Expense committed; items would stay open with an Expense logged, which is visible and
 * fixable, unlike a double charge.
 */
export async function markPurchased(ctx: Ctx, input: { totalCents: number; payerId?: string; checkoutId?: string }): Promise<Expense> {
  await requireActive(ctx);
  if (!Number.isInteger(input.totalCents) || input.totalCents <= 0) {
    throw new Error("The grocery total has to be more than $0.00 (whole cents).");
  }
  const payerId = input.payerId ?? ctx.memberId;
  let only: string[] | null = null;
  if (input.checkoutId) {
    const [c] = await db.select().from(cartCheckouts).where(and(eq(cartCheckouts.id, input.checkoutId), eq(cartCheckouts.groupId, ctx.groupId)));
    if (!c) throw new Error("That checkout isn't here anymore.");
    if (c.paidAt) throw new Error("That checkout was already paid for.");
    only = c.itemsSnapshot.map((i) => i.id);
  }
  return db.transaction(async (tx) => {
    const items = await tx
      .update(cartItems)
      .set({ status: "purchased" })
      .where(and(eq(cartItems.groupId, ctx.groupId), eq(cartItems.status, "open"), ...(only ? [inArray(cartItems.id, only.length ? only : ["00000000-0000-0000-0000-000000000000"])] : [])))
      .returning();
    if (items.length === 0) {
      throw new Error("The cart is empty, so there's nothing to mark purchased. Add items first ('roomie, add milk').");
    }
    const people = await listMembers(ctx);
    const splits = computeCartSplits(
      items.map((i) => ({ addedBy: i.addedBy, shared: i.shared, estCents: i.estCents })),
      people.map((m) => m.id),
      input.totalCents,
      payerId,
    );
    const expense = await logExpense(ctx, {
      payerId,
      cents: input.totalCents,
      description: `Groceries (${items.length} item${items.length === 1 ? "" : "s"})`,
      method: "exact",
      splits,
      category: "groceries",
      source: "cart",
    });
    const bought = new Set(items.map((i) => i.id));
    let checkoutId = input.checkoutId;
    if (!checkoutId) {
      const [c] = await tx
        .select({ id: cartCheckouts.id, snap: cartCheckouts.itemsSnapshot })
        .from(cartCheckouts)
        .where(and(eq(cartCheckouts.groupId, ctx.groupId), isNull(cartCheckouts.paidAt)))
        .orderBy(desc(cartCheckouts.createdAt))
        .limit(1);
      if (c && c.snap.some((s) => bought.has(s.id))) checkoutId = c.id;
    }
    if (checkoutId) await tx.update(cartCheckouts).set({ expenseId: expense.id, paidAt: new Date() }).where(eq(cartCheckouts.id, checkoutId));
    return expense;
  });
}
