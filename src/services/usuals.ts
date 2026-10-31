// The usuals someone said (#36, combined with #62): what a bare "Pepsi" means for a Member (their own) or the house
// (shared items), stored only when a person told Roomie: an answer to its question, "from now on", an edit on the Cart
// page. Everything else is derived from Cart history (cart-usuals.ts usualFor); a row beats history. cart.ts addAsSaid
// is the one add path that reads and writes them. Long-term, not chat: forget me (a Member's own) and delete group
// data remove them, retention doesn't. No prices.
import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { normalizeItem } from "@/lib/items";
import { parseAmount } from "@/lib/units";
import { record, sourceOf } from "./activity";
import { NotAllowedError, requireActive } from "./authz";
import type { Usual } from "./usual-rules";
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
  createdAt: r.createdAt,
});

const scopeIs = (memberId: string | null) => (memberId ? eq(groceryUsuals.memberId, memberId) : isNull(groceryUsuals.memberId));

/** One scope's rows: a Member's own (memberId) or the house's (null), A to Z. */
export async function usualsFor(groupId: string, memberId: string | null, exec: Exec = db): Promise<Usual[]> {
  const rows = await exec.select().from(groceryUsuals).where(and(eq(groceryUsuals.groupId, groupId), scopeIs(memberId))).orderBy(asc(groceryUsuals.name));
  return rows.map(toUsual);
}

const MAX_TEXT = 80;
const clip = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);

/** Write a row (insert, or replace the one for that thing and scope). The callers have checked who may. */
export async function saveUsual(exec: Exec, groupId: string, u: { memberId: string | null; name: string; qty: string }): Promise<Usual> {
  const name = clip(u.name);
  const qty = clip(u.qty);
  const item = normalizeItem(name);
  if (!item || !qty) throw new Error("A usual needs a name and how much.");
  const amount = parseAmount(qty);
  const values = { name, qty, quantity: amount ? String(amount.quantity) : null, unit: amount?.unit ?? null };
  const same = and(eq(groceryUsuals.groupId, groupId), eq(groceryUsuals.item, item), scopeIs(u.memberId));
  const [updated] = await exec.update(groceryUsuals).set(values).where(same).returning();
  if (updated) return toUsual(updated);
  const [inserted] = await exec.insert(groceryUsuals).values({ groupId, item, memberId: u.memberId, ...values }).onConflictDoNothing().returning();
  if (inserted) return toUsual(inserted);
  // Someone wrote the same one at the same moment: theirs is there now, so this one updates it.
  const [after] = await exec.update(groceryUsuals).set(values).where(same).returning();
  return toUsual(after);
}

/* ---------- the question Roomie just asked ---------- */

/**
 * The bare mentions clarifyQuantities asked about, per Group, scope and thing, for ANSWER_MS: a quantity for the same
 * thing in that window is the answer, so it's remembered (usual-rules shouldRemember). In this process's memory, like
 * the admin ask's confirmations; a restart forgets them, and then only remember = true writes a row.
 */
const asked = new Map<string, number>();
export const ANSWER_MS = 10 * 60_000;
const askKey = (groupId: string, memberId: string | null, name: string) => `${groupId}:${memberId ?? "shared"}:${normalizeItem(name)}`;

export function noteAsked(groupId: string, memberId: string | null, names: readonly string[], now = Date.now()): void {
  for (const n of names) asked.set(askKey(groupId, memberId, n), now);
  if (asked.size > 5000) for (const [k, at] of asked) if (now - at > ANSWER_MS) asked.delete(k);
}

/** Was this thing asked about for this scope within ANSWER_MS? Taking the answer clears it. */
export function takeAnswer(groupId: string, memberId: string | null, name: string, now = Date.now()): boolean {
  const k = askKey(groupId, memberId, name);
  const at = asked.get(k);
  asked.delete(k);
  return at !== undefined && now - at <= ANSWER_MS;
}

/* ---------- the Cart page's Usuals section ---------- */

/** A row of this Group the sender may change: their own, or the house's (any active Member). Someone else's is theirs. */
async function changeable(ctx: Ctx, id: string): Promise<Row> {
  await requireActive(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("That usual isn't here anymore.");
  const [row] = await db.select().from(groceryUsuals).where(and(eq(groceryUsuals.id, id), eq(groceryUsuals.groupId, ctx.groupId)));
  if (!row) throw new Error("That usual isn't here anymore.");
  if (row.memberId && row.memberId !== ctx.memberId) throw new NotAllowedError("That's someone else's usual; only they can change it.", "not-yours");
  return row;
}

/**
 * Pin a usual from the Cart page: an edit of one derived from history (or a new one) becomes a row for the viewer's
 * own items, or the house's with `shared`.
 */
export async function pinUsual(ctx: Ctx, input: { name: string; qty: string; shared: boolean }): Promise<Usual> {
  await requireActive(ctx);
  const u = await saveUsual(db, ctx.groupId, { memberId: input.shared ? null : ctx.memberId, name: input.name, qty: input.qty });
  if (input.shared) await record(ctx.groupId, ctx.memberId, "usual.changed", `set the house's usual ${u.item} to ${u.name}, ${u.qty}`, undefined, sourceOf(ctx));
  return u;
}

/** Edit a row from the Cart page. */
export async function updateUsual(ctx: Ctx, input: { id: string; name?: string; qty?: string }): Promise<Usual> {
  const row = await changeable(ctx, input.id);
  const name = clip(input.name ?? row.name);
  const qty = clip(input.qty ?? row.qty);
  if (!name || !qty) throw new Error("A usual needs a name and how much.");
  const item = normalizeItem(name);
  const amount = parseAmount(qty);
  const [clash] = item === row.item ? [] : await db.select({ id: groceryUsuals.id }).from(groceryUsuals).where(and(eq(groceryUsuals.groupId, ctx.groupId), eq(groceryUsuals.item, item), scopeIs(row.memberId)));
  if (clash) throw new Error(`There's already a usual for ${item}; change that one instead.`);
  const [next] = await db
    .update(groceryUsuals)
    .set({ item, name, qty, quantity: amount ? String(amount.quantity) : null, unit: amount?.unit ?? null })
    .where(eq(groceryUsuals.id, row.id))
    .returning();
  // A Member's own usuals are theirs: only the house's show in the Activity.
  if (!row.memberId) await record(ctx.groupId, ctx.memberId, "usual.changed", `changed the house's usual ${row.item} to ${name}, ${qty}`, undefined, sourceOf(ctx));
  return toUsual(next);
}

/** Remove a row: the next bare mention goes back to history, then the question. */
export async function removeUsual(ctx: Ctx, input: { id: string }): Promise<boolean> {
  const row = await changeable(ctx, input.id);
  const gone = await db.delete(groceryUsuals).where(eq(groceryUsuals.id, row.id)).returning({ id: groceryUsuals.id });
  if (gone.length && !row.memberId) await record(ctx.groupId, ctx.memberId, "usual.removed", `removed the house's usual ${row.item}`, undefined, sourceOf(ctx));
  return gone.length > 0;
}

/** Forget me: a Member's own rows go (the house's stay: they're the Group's). */
export async function forgetMemberUsuals(ctx: GroupCtx, memberId: string): Promise<number> {
  const gone = await db.delete(groceryUsuals).where(and(eq(groceryUsuals.groupId, ctx.groupId), eq(groceryUsuals.memberId, memberId))).returning({ id: groceryUsuals.id });
  return gone.length;
}
