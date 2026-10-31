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
import { usualFor, type PastAdd, type UsualScope } from "./cart-usuals";
import { listMembers } from "./members";
import { logExpense, type Expense } from "./money";
import { insertPurchases, localDay } from "./restock";
import type { ReportPart } from "./report";
import { moneyIn, type Ctx, type GroupCtx } from "./types";
import { currencyOf, getGroup } from "./groups";
import type { ExpenseCategory } from "@/db/enums";
import { normalizeItem, sameItem } from "@/lib/items";
import { matchItem, splitReceiptLines, type ItemAssignment, type ParsedReceipt, type ReceiptItem } from "./receipts";
import type { SplitRow } from "./split";
import { matchUsual, shouldRemember, type Usual } from "./usual-rules";
import { noteAsked, saveUsual, takeAnswer, usualsFor } from "./usuals";

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

/** The Group's Cart history (open and purchased), newest first, for the Usuals. */
async function pastAdds(groupId: string): Promise<PastAdd[]> {
  return db
    .select({ name: cartItems.name, qty: cartItems.qty, addedBy: cartItems.addedBy, shared: cartItems.shared, createdAt: cartItems.createdAt })
    .from(cartItems)
    .where(eq(cartItems.groupId, groupId))
    .orderBy(desc(cartItems.createdAt))
    .limit(1000);
}

/** Whose usual: a Member's own items, or the house's shared ones. */
export type UsualOwner = { shared: true } | { memberId: string };

/**
 * The usual for each bare name in a scope, in order (#36 + #62): first the row someone said (usuals.ts; a bare "bread"
 * also finds the house's "Sourdough bread"), then Cart history (cart-usuals.ts usualFor), else none. addAsSaid and a
 * Recipe's Cart items both ask here, so a thing never has two usuals.
 */
export async function usualsOf(groupId: string, owner: UsualOwner, names: readonly string[]): Promise<Map<string, { name: string; qty: string; quantity: number | null; unit: string | null }>> {
  const out = new Map<string, { name: string; qty: string; quantity: number | null; unit: string | null }>();
  if (!names.length) return out;
  const rows = await usualsFor(groupId, "shared" in owner ? null : owner.memberId);
  let history: PastAdd[] | null = null;
  for (const name of names) {
    const row = matchUsual(rows, name, true);
    if (row) {
      out.set(name, { name: row.name, qty: row.qty, quantity: row.quantity, unit: row.unit });
      continue;
    }
    history ??= await pastAdds(groupId);
    const qty = usualFor(name, owner as UsualScope, history);
    if (qty) {
      const amount = parseAmount(qty);
      out.set(name, { name: name.trim(), qty, quantity: amount?.quantity ?? null, unit: amount?.unit ?? null });
    }
  }
  return out;
}

export type PageUsual = { id: string | null; name: string; qty: string; scope: "mine" | "shared"; pinned: boolean };

/**
 * The Cart page's Usuals for the signed-in Member: their own, then the house's. Rows someone said are `pinned` (edit,
 * remove); the rest are derived from Cart history the same way an add derives them (usualFor), one per thing.
 */
export async function pageUsuals(ctx: Ctx): Promise<PageUsual[]> {
  const [mineRows, houseRows, history] = await Promise.all([usualsFor(ctx.groupId, ctx.memberId), usualsFor(ctx.groupId, null), pastAdds(ctx.groupId)]);
  const scoped = (owner: UsualOwner, rows: Usual[], scope: PageUsual["scope"]): PageUsual[] => {
    const pinned = rows.map((r) => ({ id: r.id, name: r.name, qty: r.qty, scope, pinned: true }));
    const seen = new Set(rows.map((r) => r.item));
    const derived: PageUsual[] = [];
    for (const a of history) {
      if (("shared" in owner ? !a.shared : a.shared || a.addedBy !== owner.memberId)) continue;
      const item = normalizeItem(a.name);
      if (!item || seen.has(item) || rows.some((r) => sameItem(r.item, a.name))) continue;
      seen.add(item);
      const qty = usualFor(a.name, owner as UsualScope, history);
      if (qty) derived.push({ id: null, name: a.name, qty, scope, pinned: false });
    }
    return [...pinned, ...derived];
  };
  return [...scoped({ memberId: ctx.memberId }, mineRows, "mine"), ...scoped({ shared: true }, houseRows, "shared")];
}

export type AddWish = { name: string; qty?: string; remember?: boolean };

/**
 * The one add path (cart_add, the dashboard's Add, photos). A said quantity always wins; an item with none takes its
 * usual (usualsOf: the row someone said, else history) and comes back in `usedUsual` so Roomie can say "like usual".
 * Then items whose quantity can't be read one way ("eggs, 12, 18"), or with none for something where it matters
 * ("eggs", "Pepsi": lib/units clarifyQuantities, the only place questions come from) are held back with one short
 * question each, and noted as asked; the rest go in. An add with a quantity writes the row only when someone said it
 * (usual-rules shouldRemember): the answer to that question, or `remember` true; never a plain clear add, which is
 * history already. `kinds: false` (photos of a written list) asks only about counts, not kinds.
 */
export async function addAsSaid(
  ctx: Ctx,
  input: { items: AddWish[]; shared?: boolean; forMemberId?: string; kinds?: boolean },
): Promise<{ added: CartItem[]; needsClarification: string[]; usedUsual: { name: string; qty: string }[] }> {
  const addedBy = input.forMemberId ?? ctx.memberId;
  const owner: UsualOwner = input.shared ? { shared: true } : { memberId: addedBy };
  const rowScope = input.shared ? null : addedBy;
  const bare = input.items.filter((i) => !(i.qty ?? "").trim()).map((i) => i.name);
  const usuals = await usualsOf(ctx.groupId, owner, bare);
  const filled = input.items.map((i) => {
    const u = (i.qty ?? "").trim() ? undefined : usuals.get(i.name);
    return { wish: i, item: u ? { name: u.name, qty: u.qty } : { name: i.name, qty: i.qty }, usual: !!u };
  });
  const { ok, questions } = clarifyQuantities(filled.map((f) => ({ ...f.item, f })), { kinds: input.kinds });
  const going = ok.map((o) => o.f);
  const held = filled.filter((f) => !going.includes(f));
  if (held.length) noteAsked(ctx.groupId, rowScope, held.map((f) => f.wish.name));
  const added = going.length ? await addItems(ctx, { items: going.map((g) => g.item), shared: input.shared, forMemberId: input.forMemberId }) : [];
  const said = going.filter((g) => !g.usual && (g.wish.qty ?? "").trim());
  if (said.length) {
    const rows = await usualsFor(ctx.groupId, rowScope);
    for (const g of said) {
      const answered = takeAnswer(ctx.groupId, rowScope, g.wish.name);
      if (shouldRemember(g.wish, matchUsual(rows, g.wish.name), answered)) await saveUsual(db, ctx.groupId, { memberId: rowScope, name: g.wish.name, qty: g.wish.qty! });
    }
  }
  return { added, needsClarification: questions, usedUsual: going.filter((g) => g.usual).map((g) => ({ name: g.item.name.trim(), qty: g.item.qty! })) };
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

/* ---------- the receipt closes the Cart (#39) ---------- */

export type ReceiptCartMatch<I> = { pairs: { line: number; item: I }[]; unmatchedLines: number[]; unmatchedItems: I[] };

/**
 * Receipt lines against the open Cart, one to one. First the same thing by the Pantry / Restock names (lib/items
 * sameItem: "Oat milk" = "oat milk"), then the receipt matcher (receipts.ts matchItem: exact, contains, a word), the
 * most specific Cart names first so "Whole milk" isn't taken by "OAT MILK". Pure.
 */
export function matchReceiptToCart<I extends { name: string }>(lines: readonly ReceiptItem[], open: readonly I[]): ReceiptCartMatch<I> {
  const taken = new Set<number>();
  const pairs: { line: number; item: I }[] = [];
  const rest: I[] = [];
  for (const item of open) {
    const k = lines.findIndex((l, i) => !taken.has(i) && sameItem(l.name, item.name));
    if (k === -1) rest.push(item);
    else {
      taken.add(k);
      pairs.push({ line: k, item });
    }
  }
  const words = (s: string) => s.trim().split(/\s+/).length;
  const unmatchedItems: I[] = [];
  for (const item of [...rest].sort((a, b) => words(b.name) - words(a.name))) {
    let k = matchItem([...lines], item.name, taken);
    if (k === -1 && normalizeItem(item.name) !== item.name.toLowerCase()) k = matchItem([...lines], normalizeItem(item.name), taken);
    if (k === -1) unmatchedItems.push(item);
    else {
      taken.add(k);
      pairs.push({ line: k, item });
    }
  }
  pairs.sort((a, b) => a.line - b.line);
  const order = new Map(open.map((o, k) => [o, k]));
  unmatchedItems.sort((a, b) => order.get(a)! - order.get(b)!);
  return { pairs, unmatchedLines: lines.map((_, i) => i).filter((i) => !taken.has(i)), unmatchedItems };
}

export type CartReceiptLine = { name: string; cents: number; memberIds: string[]; cartItem: { id: string; name: string; qty: string; shared: boolean; addedBy: string } | null; answered: boolean };
export type CartReceiptPlan = {
  lines: CartReceiptLine[];
  /** Lines on neither the Cart nor in `assignments`: ask once, else they're shared. */
  unanswered: CartReceiptLine[];
  /** Open Cart items the receipt doesn't have: they stay in the Cart. */
  notOnReceipt: CartItem[];
  rows: SplitRow[];
  everyone: string[];
};

/**
 * What a grocery receipt does to the open Cart, without writing anything: each line matched to a Cart item goes to its
 * owner (personal) or everyone (shared, or its adder isn't active any more); `assignments` ("the chips were Dev's")
 * win; the rest are shared until someone answers. Shares per line, tax and tip in proportion (receipts.ts
 * splitReceiptLines). Null when nothing on the receipt is in the Cart.
 */
export async function planCartReceipt(
  ctx: Ctx,
  input: { receipt: Pick<ParsedReceipt, "items">; totalCents: number; assignments?: ItemAssignment[]; payerId?: string },
): Promise<CartReceiptPlan | null> {
  const open = await listOpenItems(ctx);
  if (!open.length) return null;
  const match = matchReceiptToCart(input.receipt.items, open);
  if (!match.pairs.length) return null;
  const everyone = (await listMembers(ctx)).map((m) => m.id);
  const active = new Set(everyone);
  const said = new Map<number, string[]>();
  const taken = new Set<number>();
  for (const a of input.assignments ?? []) {
    const i = matchItem(input.receipt.items, a.item, taken);
    if (i === -1) throw new Error(`No item like "${a.item}" on the receipt. Items: ${input.receipt.items.map((x) => x.name).join(", ")}.`);
    taken.add(i);
    said.set(i, a.memberIds.length ? a.memberIds : everyone);
  }
  const byLine = new Map(match.pairs.map((p) => [p.line, p.item]));
  const lines: CartReceiptLine[] = input.receipt.items.map((l, i) => {
    const item = byLine.get(i);
    const owner = item && !item.shared && item.addedBy && active.has(item.addedBy) ? [item.addedBy] : everyone;
    const cartItem = item ? { id: item.id, name: item.name, qty: item.qty, shared: item.shared, addedBy: item.addedBy ?? "" } : null;
    return { name: l.name, cents: l.cents, memberIds: said.get(i) ?? owner, cartItem, answered: said.has(i) || !!item };
  });
  const { rows } = splitReceiptLines(input.receipt, lines.map((l) => l.memberIds), input.payerId ?? ctx.memberId, input.totalCents);
  return { lines, unanswered: lines.filter((l) => !l.answered), notOnReceipt: match.unmatchedItems, rows, everyone };
}

/** The one question about lines the Cart didn't have: "Not on the Cart: Doritos ($5.99). Shared, or whose?" Pure. */
export function unmatchedQuestion(lines: readonly { name: string; cents: number }[], money: (cents: number) => string): string | null {
  if (!lines.length) return null;
  const parts = lines.map((l) => `${l.name} (${money(l.cents)})`);
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `Not on the Cart: ${list}. ${lines.length === 1 ? "Shared, or whose?" : "Shared, or whose are they?"}`;
}

/**
 * Close the Cart with a grocery receipt, in one transaction: the matched Cart items are marked purchased FIRST (as
 * markPurchased does: the rows that come back are the only ones this receipt may close, a second click finds none),
 * then ONE Expense with exact Shares per line (planCartReceipt), the receipt Document linked through receiptUrl, the
 * newest unpaid Checkout it covers marked paid and a purchase event per line (personal = the one Member it went to);
 * the bought items stay in Cart history, which is what the usuals are derived from. Unanswered lines are shared. Items the receipt doesn't have stay open.
 * A second click or a retry gets fewer rows back from the open-status update and throws before anything is logged; as in
 * markPurchased, logExpense commits on its own connection, so the one remaining window is the outer commit failing after
 * the Expense committed: the items stay open with an Expense logged, which is visible and fixable, never a double charge.
 */
export async function closeCartWithReceipt(
  ctx: Ctx,
  input: {
    receipt: Pick<ParsedReceipt, "items" | "merchant">;
    totalCents: number;
    receiptUrl: string;
    assignments?: ItemAssignment[];
    payerId?: string;
    description?: string;
    category?: ExpenseCategory;
    occurredOn?: string;
    note?: string;
  },
): Promise<{ expense: Expense; purchased: number; checkoutId: string | null; notOnReceipt: CartItem[]; plan: CartReceiptPlan }> {
  await requireActive(ctx);
  const payerId = input.payerId ?? ctx.memberId;
  const plan = await planCartReceipt(ctx, { ...input, payerId });
  if (!plan) throw new Error("Nothing on that receipt is in the Cart.");
  const matched = plan.lines.flatMap((l) => (l.cartItem ? [l.cartItem.id] : []));
  const today = await localDay(ctx.groupId);
  let checkoutId: string | null = null;
  const expense = await db.transaction(async (tx) => {
    const items = await tx
      .update(cartItems)
      .set({ status: "purchased" })
      .where(and(eq(cartItems.groupId, ctx.groupId), eq(cartItems.status, "open"), inArray(cartItems.id, matched)))
      .returning();
    if (items.length !== matched.length) throw new Error("Someone already marked some of these bought. Look at the Cart and try again.");
    const expense = await logExpense(ctx, {
      payerId,
      cents: input.totalCents,
      description: input.description ?? input.receipt.merchant,
      method: "exact",
      splits: plan.rows,
      category: input.category ?? "groceries",
      occurredOn: input.occurredOn,
      receiptUrl: input.receiptUrl,
      note: input.note ?? null,
      source: "cart",
    });
    const bought = new Set(matched);
    const [c] = await tx
      .select({ id: cartCheckouts.id, snap: cartCheckouts.itemsSnapshot })
      .from(cartCheckouts)
      .where(and(eq(cartCheckouts.groupId, ctx.groupId), isNull(cartCheckouts.paidAt)))
      .orderBy(desc(cartCheckouts.createdAt))
      .limit(1);
    if (c && c.snap.some((s) => bought.has(s.id))) {
      checkoutId = c.id;
      await tx.update(cartCheckouts).set({ expenseId: expense.id, paidAt: new Date() }).where(eq(cartCheckouts.id, c.id));
    }
    // Restock learns from it: the Cart's own name for a matched line, one Member's line is theirs.
    const solo = (ids: string[]) => (ids.length === 1 && plan.everyone.length > 1 ? ids[0] : null);
    await insertPurchases(
      tx,
      ctx.groupId,
      plan.lines.map((l) => ({ name: l.cartItem?.name ?? l.name, memberId: solo(l.memberIds), occurredOn: expense.occurredOn ?? today, source: "receipt" as const, sourceId: expense.id })),
    );
    return expense;
  });
  const money = moneyIn(await currencyOf(ctx.groupId));
  await record(ctx.groupId, ctx.memberId, "cart.purchased", `closed the Cart with the ${input.receipt.merchant} receipt (${matched.length} item${matched.length === 1 ? "" : "s"}, ${money(input.totalCents)})`, { table: "expenses", id: expense.id }, sourceOf(ctx));
  return { expense, purchased: matched.length, checkoutId, notOnReceipt: plan.notOnReceipt, plan };
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
    count = items.length;
    return expense;
  });
  await record(ctx.groupId, ctx.memberId, "cart.purchased", `marked the Cart bought (${count} item${count === 1 ? "" : "s"}, ${moneyIn(await currencyOf(ctx.groupId))(input.totalCents)})`, { table: "expenses", id: expense.id }, sourceOf(ctx));
  return expense;
}
