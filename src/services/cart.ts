// The shared grocery Cart. Items are attributed to whoever added them; a Checkout snapshots the open Cart into an
// Instacart shopping list; "I paid" logs ONE Expense split by who added what (by item count, shared items split
// evenly across active Members). The split math is pure, in cart-split.ts, so the dashboard previews with it. No
// prices here: real money comes from the receipt (or "I paid 84"). Every change is an Activity row with its source.
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CheckoutItem } from "@/db/schema";
import { clarifyQuantities, measurementOrEach, parseAmount } from "@/lib/units";
import { dashboardUrl } from "@/lib/urls";
import { InstacartUnavailableError, instacartClient } from "@/integrations/instacart";
import { record, sourceOf } from "./activity";
import { NotAllowedError, requireActive } from "./authz";
import { canRemoveItem, computeCartSplits } from "./cart-split";
import { listMembers } from "./members";
import { logExpense, type Expense } from "./money";
import { insertPurchases, localDay } from "./restock";
import type { ReportPart } from "./report";
import { moneyIn, type Ctx, type GroupCtx } from "./types";
import { currencyOf, getGroup } from "./groups";
import { addedLine, matchUsual, planAdd, usualOwner, type Usual, type UsualSource } from "./usual-rules";
import { learnFromPurchases, saveUsual, touchUsual, usualsFor } from "./usuals";

export { canRemoveItem, computeCartSplits, type SplitItem } from "./cart-split";

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

/**
 * The Cart as a list to take to the store or paste anywhere (#38): the Group's name, then one "☐" line per open item,
 * its quantity as stored, shared things first (in the order they went in), then each person's, labelled "(Dev)". Pure:
 * the chat (cart_view list) and the Cart page's Share button both post this text.
 */
export function cartListText(groupName: string, items: readonly Pick<CartItem, "name" | "qty" | "shared" | "addedByName">[]): string {
  if (items.length === 0) return `${groupName}'s Cart is empty: nothing to buy.`;
  const line = (i: (typeof items)[number]) => `☐ ${i.name}${i.qty && i.qty.trim() !== "1" ? `, ${i.qty}` : ""}${i.shared ? "" : ` (${i.addedByName})`}`;
  const personal = items.filter((i) => !i.shared).map((i, k) => ({ i, k })).sort((a, b) => a.i.addedByName.localeCompare(b.i.addedByName) || a.k - b.k).map((x) => x.i);
  return [`${groupName} shopping list`, ...items.filter((i) => i.shared).map(line), ...personal.map(line)].join("\n");
}

/** The open Cart as that list, for the chat and the dashboard alike. */
export async function cartList(ctx: GroupCtx): Promise<{ text: string; itemCount: number }> {
  const [items, group] = await Promise.all([listOpenItems(ctx), getGroup(ctx.groupId)]);
  return { text: cartListText(group?.name ?? "The group", items), itemCount: items.length };
}

/** Groceries' section of the weekly Group Report: the Cart's size (no prices). Pure. */
export function cartReportParts(openCount: number): ReportPart[] {
  return [{ icon: "🛒", text: openCount ? `${openCount} thing${openCount === 1 ? "" : "s"} in the Cart.` : "The Cart's empty." }];
}

/** "eggs", "eggs and milk", "eggs, milk, bread and 2 more" (lower case, for Activity lines). */
export function itemList(names: string[], max = 3): string {
  const n = names.map((s) => s.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 40)).filter(Boolean);
  if (n.length <= 1) return n[0] ?? "nothing";
  if (n.length <= max) return `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  return `${n.slice(0, max).join(", ")} and ${n.length - max} more`;
}

/**
 * Items are attributed to ctx.memberId, or to `forMemberId` ("add oat milk for Dev"). Quantities are kept as said
 * ("2 cartons"); there are no prices (estCents stays null): real money comes from the receipt.
 */
export async function addItems(ctx: Ctx, input: { items: { name: string; qty?: string }[]; shared?: boolean; forMemberId?: string }): Promise<CartItem[]> {
  await requireActive(ctx);
  const items = input.items
    .map((i) => ({ name: i.name.trim().replace(/\s+/g, " "), qty: (i.qty ?? "").trim() || "1" }))
    .filter((i) => i.name);
  if (items.length === 0) throw new Error("Add what? Give me at least one item name.");
  const addedBy = input.forMemberId ?? ctx.memberId;
  const names = await namesFor(ctx.groupId);
  if (!names.has(addedBy)) throw new Error("That person isn't in this group.");
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
          addedBy,
          shared: !!input.shared,
          estCents: null,
        };
      }),
    )
    .returning();
  const forWhom = input.shared ? " for everyone" : addedBy !== ctx.memberId ? ` for ${names.get(addedBy)}` : "";
  await record(ctx.groupId, ctx.memberId, "cart.added", `put ${itemList(items.map((i) => i.name))} on the Cart${forWhom}`, rows.length === 1 ? { table: "cart_items", id: rows[0].id } : undefined, sourceOf(ctx));
  return rows.map((r) => toItem(r, names, new Map()));
}

/**
 * What people say, added as said: items whose quantity can't be read one way ("eggs, 12, 18") are held back with one
 * short question each (lib/units clarifyQuantities); the rest go in.
 */
export async function addAsSaid(ctx: Ctx, input: { items: { name: string; qty?: string }[]; shared?: boolean; forMemberId?: string }): Promise<{ added: CartItem[]; needsClarification: string[] }> {
  const { ok, questions } = clarifyQuantities(input.items);
  const added = ok.length ? await addItems(ctx, { ...input, items: ok }) : [];
  return { added, needsClarification: questions };
}

export type WishItem = { name: string; qty?: string; brand?: string; remember?: boolean };
export type AddedItem = CartItem & { usual?: string };

/**
 * The add path behind cart_add and the dashboard's Add (#36): each item against the adder's own usual (or the house's,
 * for shared items). A bare mention with a usual adds the usual ("your usual"); one of something that comes in sizes or
 * kinds with none is held back with one question (the same `needsClarification` as ambiguous quantities); a clear one
 * goes in as said and becomes the usual unless `remember` is false; a change to a usual overwrites it only with
 * `remember` true ("from now on"). `say` is the line to post ("Added your usual: Pepsi, 12 cans.").
 */
export async function addWithUsuals(ctx: Ctx, input: { items: WishItem[]; shared?: boolean; forMemberId?: string }): Promise<{ added: AddedItem[]; needsClarification: string[]; say: string | null }> {
  await requireActive(ctx);
  const addedBy = input.forMemberId ?? ctx.memberId;
  const scope = input.shared ? null : addedBy;
  const { ok, questions } = clarifyQuantities(input.items);
  const wishes = ok as WishItem[];
  const known = await usualsFor(ctx.groupId, scope);
  const plans = wishes.map((w) => ({ wish: w, plan: planAdd(w, matchUsual(known, w.name, !(w.qty ?? "").trim())) }));
  type Going = { name: string; qty: string; usual: Usual | null; brand: string | null; write: UsualSource | null; touch: Usual | null };
  const going = plans.flatMap(({ plan }): Going[] => {
    if (plan.kind === "ask") return [];
    if (plan.kind === "usual") return [{ name: plan.usual.name, qty: plan.usual.qty, usual: plan.usual, brand: plan.usual.brand, write: null, touch: plan.usual }];
    return [{ name: plan.name, qty: plan.qty, usual: null, brand: plan.brand, write: plan.write, touch: plan.touch }];
  });
  const asked = plans.flatMap(({ plan }) => (plan.kind === "ask" ? [plan.question] : []));
  const rows = going.length ? await addItems(ctx, { items: going.map((g) => ({ name: g.name, qty: g.qty })), shared: input.shared, forMemberId: input.forMemberId }) : [];
  for (const g of going) {
    if (g.write) await saveUsual(db, ctx.groupId, { memberId: scope, name: g.name, qty: g.qty, brand: g.brand, source: g.write });
    else if (g.touch) await touchUsual(g.touch.id);
  }
  const adderName = rows[0]?.addedByName ?? "";
  const added = rows.map((r, k) => (going[k].usual ? { ...r, usual: usualOwner(!!input.shared, adderName, addedBy === ctx.memberId) } : r));
  return { added, needsClarification: [...questions, ...asked], say: addedLine(added) };
}

async function recordRemoved(ctx: Ctx, item: { id: string; name: string; addedBy: string }) {
  const whose = item.addedBy === ctx.memberId ? "" : ` (${(await namesFor(ctx.groupId)).get(item.addedBy) ?? "someone"}'s)`;
  await record(ctx.groupId, ctx.memberId, "cart.removed", `took ${itemList([item.name])}${whose} off the Cart`, { table: "cart_items", id: item.id }, sourceOf(ctx));
}

function checkRemove(actor: { id: string; role: string }, item: { addedBy: string; name: string }, adderName: string) {
  if (canRemoveItem(actor, item)) return;
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
  const mine = hits.find((r) => canRemoveItem(actor, r));
  if (!mine) checkRemove(actor, hits[0], (await namesFor(ctx.groupId)).get(hits[0].addedBy) ?? "whoever");
  const gone = await db.delete(cartItems).where(and(eq(cartItems.id, mine!.id), eq(cartItems.status, "open"))).returning({ id: cartItems.id });
  if (gone.length) await recordRemoved(ctx, mine!);
  return gone.length > 0;
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
  if (gone.length) await recordRemoved(ctx, item);
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
  const sameItems = (snap: CheckoutItem[]) => snap.length === items.length && snap.every((s, k) => s.id === items[k].id && s.qty === items[k].qty);
  const [last] = await db
    .select()
    .from(cartCheckouts)
    .where(and(eq(cartCheckouts.groupId, ctx.groupId), isNull(cartCheckouts.paidAt)))
    .orderBy(desc(cartCheckouts.createdAt))
    .limit(1);
  if (last?.instacartUrl && sameItems(last.itemsSnapshot)) {
    return { id: last.id, url: last.instacartUrl, itemCount: items.length, items, createdAt: last.createdAt };
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
  const [row] = await db.insert(cartCheckouts).values({ groupId: ctx.groupId, createdBy: ctx.memberId, itemsSnapshot: items, estCents: 0, instacartUrl: url }).returning();
  await record(ctx.groupId, ctx.memberId, "cart.checkout", `made the Instacart list (${items.length} item${items.length === 1 ? "" : "s"})`, { table: "cart_checkouts", id: row.id }, sourceOf(ctx));
  return { id: row.id, url, ...(unavailable ? { unavailable } : {}), itemCount: items.length, items, createdAt: row.createdAt };
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
  return { id: row.id, url: row.instacartUrl, itemCount: row.itemsSnapshot.length, items: row.itemsSnapshot, createdAt: row.createdAt };
}

/* ---------- paying for it ---------- */

/**
 * Payer bought the cart: one Expense (exact Shares, category groceries) split by who added what (each item counts
 * the same, see computeCartSplits) and scaled to the real total; shared items split evenly. With `checkoutId` only that Checkout's items
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
  let count = 0;
  const today = await localDay(ctx.groupId);
  const expense = await db.transaction(async (tx) => {
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
    // Restock learns from it: one purchase per item, personal to whoever added it unless shared.
    await insertPurchases(
      tx,
      ctx.groupId,
      items.map((i) => ({ name: i.name, memberId: i.shared ? null : i.addedBy, occurredOn: today, source: "cart" as const, sourceId: i.id })),
    );
    // And the usuals: what was bought, unless someone told Roomie otherwise (usual-rules learnFromPurchase).
    await learnFromPurchases(tx, ctx.groupId, items.map((i) => ({ name: i.name, qty: i.qty, memberId: i.shared ? null : i.addedBy })));
    count = items.length;
    return expense;
  });
  await record(ctx.groupId, ctx.memberId, "cart.purchased", `marked the Cart bought (${count} item${count === 1 ? "" : "s"}, ${moneyIn(await currencyOf(ctx.groupId))(input.totalCents)})`, { table: "expenses", id: expense.id }, sourceOf(ctx));
  return expense;
}
