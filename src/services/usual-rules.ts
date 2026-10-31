// Pure rules for the usuals someone said (#36, combined with #62; no DB import): which row a name means, and when an
// add writes one. Everything else about a usual is derived from Cart history (cart-usuals.ts usualFor); the questions
// come from lib/units clarifyQuantities only.
import { normalizeItem, sameItem } from "@/lib/items";
import { covers } from "./recipe-math";

/** A usual someone told Roomie (grocery_usuals). */
export type Usual = {
  id: string;
  /** normalizeItem's name: the key. */
  item: string;
  /** Null = the house's (shared items). */
  memberId: string | null;
  name: string;
  qty: string;
  quantity: number | null;
  unit: string | null;
  createdAt: Date;
};

/**
 * The row among `list` for this name (the same thing, plurals aside), or undefined. `loose` (a bare mention) also takes
 * a more exact row the name covers: "bread" is the house's "Sourdough bread", "Pepsi" is "Diet Pepsi"; newest wins.
 */
export function matchUsual(list: readonly Usual[], name: string, loose = false): Usual | undefined {
  const key = normalizeItem(name);
  const exact = list.find((u) => u.item === key) ?? list.find((u) => sameItem(u.item, name));
  if (exact || !loose || !key) return exact;
  return [...list].filter((u) => covers(key, u.item)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

const same = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Does this add (with a quantity) write the row? Only what someone said counts: an answer to Roomie's question
 * (`answered`: it asked about this thing, for this scope, a few minutes ago) or remember = true ("make it 24 from now
 * on"). remember = false ("just a 2-liter this time") never writes; a plain clear add is history, not a row; and the
 * row it would write is already there.
 */
export function shouldRemember(wish: { name: string; qty?: string; remember?: boolean }, row: Usual | undefined, answered: boolean): boolean {
  const qty = (wish.qty ?? "").trim();
  if (!qty || wish.remember === false) return false;
  if (row && same(row.qty, qty) && same(row.name, wish.name)) return false;
  return wish.remember === true || answered;
}
