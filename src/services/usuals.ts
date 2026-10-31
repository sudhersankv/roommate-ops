// Grocery usuals (#36): what "Pepsi" means for a Member (their own) or for the house (shared items), so a bare mention
// becomes a clear Cart item. The rules are pure, in usual-rules.ts; the Cart's add path (cart.ts addWithUsuals) asks
// and remembers, purchases teach purchase-learned ones, and the Cart page shows and edits them. Long-term data, not
// chat: forget me (a Member's own) and delete group data remove them, retention doesn't. No prices.
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeItem } from "@/lib/items";
import { parseAmount } from "@/lib/units";
import { record, sourceOf } from "./activity";
import { NotAllowedError, requireActive } from "./authz";
import { learnFromPurchase, matchUsual, type Usual, type UsualSource } from "./usual-rules";
import type { Ctx, GroupCtx } from "./types";

export type { Usual } from "./usual-rules";

const { groceryUsuals } = schema;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exec = typeof db | Tx;
type Row = typeof groceryUsuals.$inferSelect;

const toUsual = (r: Row): Usual => ({
  id: r.id,
  item: r.item,
  memberId: r.memberId,
  name: r.name,
  qty: r.qty,
  quantity: r.quantity === null ? null : Number(r.quantity),
  unit: r.unit,
  brand: r.brand,
  source: r.source,
  lastUsedAt: r.lastUsedAt,
});

const scopeIs = (memberId: string | null) => (memberId ? eq(groceryUsuals.memberId, memberId) : isNull(groceryUsuals.memberId));

/** One scope's usuals: a Member's own (memberId) or the house's (null). */
export async function usualsFor(groupId: string, memberId: string | null, exec: Exec = db): Promise<Usual[]> {
  const rows = await exec.select().from(groceryUsuals).where(and(eq(groceryUsuals.groupId, groupId), scopeIs(memberId))).orderBy(asc(groceryUsuals.name));
  return rows.map(toUsual);
}

/** The usual for this name in that scope, if any. */
export async function findUsual(groupId: string, name: string, memberId: string | null): Promise<Usual | undefined> {
  return matchUsual(await usualsFor(groupId, memberId), name);
}

const MAX_TEXT = 80;
const clip = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);

/**
 * Write a usual (insert, or update the one for that thing and scope). Not a permission check: the callers (an add, a
 * purchase, an edit) have done theirs.
 */
export async function saveUsual(
  exec: Exec,
  groupId: string,
  u: { memberId: string | null; name: string; qty: string; brand?: string | null; source: UsualSource },
): Promise<Usual> {
  const name = clip(u.name);
  const qty = clip(u.qty) || "1";
  const item = normalizeItem(name);
  if (!item) throw new Error("A usual needs a name.");
  const amount = parseAmount(qty);
  const values = { name, qty, quantity: amount ? String(amount.quantity) : null, unit: amount?.unit ?? null, brand: u.brand ? clip(u.brand) : null, source: u.source, lastUsedAt: new Date() };
  const same = and(eq(groceryUsuals.groupId, groupId), eq(groceryUsuals.item, item), scopeIs(u.memberId));
  const [updated] = await exec.update(groceryUsuals).set(values).where(same).returning();
  if (updated) return toUsual(updated);
  const [inserted] = await exec.insert(groceryUsuals).values({ groupId, item, memberId: u.memberId, ...values }).onConflictDoNothing().returning();
  if (inserted) return toUsual(inserted);
  // Someone wrote the same one at the same moment: theirs is there now, so this one updates it.
  const [after] = await exec.update(groceryUsuals).set(values).where(same).returning();
  return toUsual(after);
}

/** A usual was used: it stays at the top of the list (last used). */
export async function touchUsual(id: string): Promise<void> {
  await db.update(groceryUsuals).set({ lastUsedAt: new Date() }).where(eq(groceryUsuals.id, id));
}

/**
 * What was bought teaches the usuals (markPurchased, the receipt closing the Cart), inside the purchase's transaction:
 * a purchase-learned usual follows what was bought; an asked or corrected one is never overwritten; a bare "1" teaches
 * nothing. Personal items teach their owner's, shared ones the house's.
 */
export async function learnFromPurchases(exec: Exec, groupId: string, items: readonly { name: string; qty: string; memberId: string | null }[]): Promise<number> {
  let n = 0;
  const cache = new Map<string, Usual[]>();
  for (const i of items) {
    const scope = i.memberId ?? "";
    if (!cache.has(scope)) cache.set(scope, await usualsFor(groupId, i.memberId, exec));
    const existing = matchUsual(cache.get(scope)!, i.name);
    const what = learnFromPurchase(existing, i);
    if (!what) continue;
    const saved = await saveUsual(exec, groupId, { memberId: i.memberId, name: i.name, qty: i.qty, brand: existing?.brand ?? null, source: "purchase" });
    cache.set(scope, [...cache.get(scope)!.filter((u) => u.id !== saved.id), saved]);
    n++;
  }
  return n;
}

/* ---------- the Cart page's Usuals section ---------- */

/** The signed-in Member's own usuals and the house's, last used first. */
export async function listUsuals(ctx: Ctx): Promise<{ mine: Usual[]; house: Usual[] }> {
  const byUse = (a: Usual, b: Usual) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime() || a.name.localeCompare(b.name);
  const [mine, house] = await Promise.all([usualsFor(ctx.groupId, ctx.memberId), usualsFor(ctx.groupId, null)]);
  return { mine: mine.sort(byUse), house: house.sort(byUse) };
}

/** A usual of this Group the sender may change: their own, or the house's (any active Member). Someone else's is theirs. */
async function changeable(ctx: Ctx, id: string): Promise<Row> {
  await requireActive(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("That usual isn't here anymore.");
  const [row] = await db.select().from(groceryUsuals).where(and(eq(groceryUsuals.id, id), eq(groceryUsuals.groupId, ctx.groupId)));
  if (!row) throw new Error("That usual isn't here anymore.");
  if (row.memberId && row.memberId !== ctx.memberId) throw new NotAllowedError("That's someone else's usual; only they can change it.", "not-yours");
  return row;
}

/** Edit a usual from the Cart page (or "make it 24 from now on" said there): it counts as corrected. */
export async function updateUsual(ctx: Ctx, input: { id: string; name?: string; qty?: string; brand?: string | null }): Promise<Usual> {
  const row = await changeable(ctx, input.id);
  const name = clip(input.name ?? row.name);
  const qty = clip(input.qty ?? row.qty);
  if (!name || !qty) throw new Error("A usual needs a name and how much.");
  const item = normalizeItem(name);
  const amount = parseAmount(qty);
  const brand = input.brand === undefined ? row.brand : input.brand ? clip(input.brand) : null;
  const [clash] = item === row.item ? [] : await db.select({ id: groceryUsuals.id }).from(groceryUsuals).where(and(eq(groceryUsuals.groupId, ctx.groupId), eq(groceryUsuals.item, item), scopeIs(row.memberId)));
  if (clash) throw new Error(`There's already a usual for ${item}; change that one instead.`);
  const [next] = await db
    .update(groceryUsuals)
    .set({ item, name, qty, quantity: amount ? String(amount.quantity) : null, unit: amount?.unit ?? null, brand, source: "corrected" })
    .where(eq(groceryUsuals.id, row.id))
    .returning();
  // A Member's own usuals are theirs: only the house's show in the Activity.
  if (!row.memberId) await record(ctx.groupId, ctx.memberId, "usual.changed", `changed the house's usual ${row.item} to ${name}, ${qty}`, undefined, sourceOf(ctx));
  return toUsual(next);
}

/** Remove a usual: the next bare mention asks again. */
export async function removeUsual(ctx: Ctx, input: { id: string }): Promise<boolean> {
  const row = await changeable(ctx, input.id);
  const gone = await db.delete(groceryUsuals).where(eq(groceryUsuals.id, row.id)).returning({ id: groceryUsuals.id });
  if (gone.length && !row.memberId) await record(ctx.groupId, ctx.memberId, "usual.removed", `removed the house's usual ${row.item}`, undefined, sourceOf(ctx));
  return gone.length > 0;
}

/** Forget me: a Member's own usuals go (the house's stay: they're the Group's). */
export async function forgetMemberUsuals(ctx: GroupCtx, memberId: string): Promise<number> {
  const gone = await db.delete(groceryUsuals).where(and(eq(groceryUsuals.groupId, ctx.groupId), eq(groceryUsuals.memberId, memberId))).returning({ id: groceryUsuals.id });
  return gone.length;
}
