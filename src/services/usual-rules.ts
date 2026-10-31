// Pure rules for grocery usuals (#36, no DB import): when a bare mention needs one question, what an add does with the
// adder's (or the house's) usual, what a purchase may teach, and the line Roomie says back. services/usuals.ts and
// services/cart.ts addWithUsuals run them against the table.
import { normalizeItem, sameItem } from "@/lib/items";
import { covers } from "./recipe-math";

export type UsualSource = "asked" | "corrected" | "purchase";

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
  brand: string | null;
  source: UsualSource;
  lastUsedAt: Date;
};

/** What someone asked to add: the name and quantity as said, and whether a change is "from now on" or "just this time". */
export type AddWish = { name: string; qty?: string; brand?: string; remember?: boolean };

/**
 * Things that come in sizes or kinds, so a bare mention can't be bought right: the one short question to ask. Matched
 * with the Pantry's word rule (the last word is the thing: "milk" covers "oat milk", not "milk chocolate"), in order.
 */
const ASK: readonly [readonly string[], string][] = [
  [["soda", "pop", "pepsi", "coke", "cola", "sprite", "fanta", "dr pepper", "mountain dew", "la croix", "seltzer", "sparkling water", "ginger ale", "root beer", "red bull", "beer"], "cans or a bottle, and how many?"],
  [["eggs"], "a dozen or 18?"],
  [["milk"], "what kind, and how much? (a gallon of whole, a half gallon of 2%…)"],
  [["bread"], "what kind? (a sandwich loaf, sourdough…)"],
  [["water"], "a case of bottles or a gallon jug?"],
  [["coffee"], "beans or ground, and what size bag?"],
  [["toilet paper", "paper towels"], "how many rolls?"],
];

/** "Pepsi" -> "Pepsi: cans or a bottle, and how many?"; null when the name alone is clear enough ("dish soap"). */
export function questionFor(name: string): string | null {
  const n = name.trim();
  const hit = ASK.find(([terms]) => terms.some((t) => covers(t, n)));
  return hit ? `${n}: ${hit[1]}` : null;
}

/**
 * The usual among `list` for this name (the same thing, plurals aside), or undefined. `loose` (a bare mention) also
 * takes a more exact usual the name covers: "bread" is the house's "Sourdough bread", "Pepsi" is "Diet Pepsi"; the
 * most recently used wins.
 */
export function matchUsual(list: readonly Usual[], name: string, loose = false): Usual | undefined {
  const key = normalizeItem(name);
  const exact = list.find((u) => u.item === key) ?? list.find((u) => sameItem(u.item, name));
  if (exact || !loose || !key) return exact;
  return [...list].filter((u) => covers(key, u.item)).sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())[0];
}

const bare = (qty: string | undefined) => !(qty ?? "").trim();
const sameText = (a: string, b: string) => a.trim().toLowerCase().replace(/\s+/g, " ") === b.trim().toLowerCase().replace(/\s+/g, " ");

export type AddPlan =
  /** A bare mention with a usual: add the usual and say so. */
  | { kind: "usual"; usual: Usual }
  /** A bare mention of something with sizes or kinds and no usual: hold it back and ask. */
  | { kind: "ask"; question: string }
  /** Add as said; `write` stores it as the usual (asked = the first clear mention or an answer, corrected = "from now on"). */
  | { kind: "add"; name: string; qty: string; brand: string | null; write: "asked" | "corrected" | null; touch: Usual | null };

/**
 * One wish against its usual. Bare: the usual, else a question (sized things), else "1" as today. With a quantity and
 * no usual it becomes the usual (an answer to Roomie's question, or a first clear mention) unless remember is false.
 * With a usual that differs, only remember = true ("make it 24 from now on") overwrites; otherwise it's a one-off
 * ("just a 2-liter this time").
 */
export function planAdd(wish: AddWish, usual: Usual | undefined): AddPlan {
  const name = wish.name.trim().replace(/\s+/g, " ");
  const brand = wish.brand?.trim() || null;
  if (bare(wish.qty)) {
    if (usual) return { kind: "usual", usual };
    const question = questionFor(name);
    if (question) return { kind: "ask", question };
    return { kind: "add", name, qty: "1", brand, write: null, touch: null };
  }
  const qty = wish.qty!.trim();
  if (!usual) return { kind: "add", name, qty, brand, write: wish.remember === false ? null : "asked", touch: null };
  const same = sameText(usual.qty, qty) && sameText(usual.name, name) && (!brand || sameText(usual.brand ?? "", brand));
  if (same) return { kind: "add", name, qty, brand, write: null, touch: usual };
  return { kind: "add", name, qty, brand, write: wish.remember === true ? "corrected" : null, touch: null };
}

/** What a purchase (an "I paid" item, a receipt line matched to one) does to the usual: create, update or nothing. */
export function learnFromPurchase(existing: Usual | undefined, bought: { name: string; qty: string }): "create" | "update" | null {
  // A bare "1" says nothing about how much they buy.
  if (bare(bought.qty) || sameText(bought.qty, "1")) return null;
  if (!existing) return "create";
  if (existing.source !== "purchase") return null;
  return sameText(existing.qty, bought.qty) && sameText(existing.name, bought.name) ? null : "update";
}

/** "your usual", "Dev's usual", "the house's usual". */
export function usualOwner(shared: boolean, adderName: string, mine: boolean): string {
  return shared ? "the house's usual" : mine ? "your usual" : `${adderName}'s usual`;
}

const list = (parts: string[]) => (parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

/**
 * The line after an add: "Added your usual: Pepsi, 12 cans." for one usual, else "Added your usual Pepsi (12 cans)
 * and eggs." Null when nothing went in.
 */
export function addedLine(items: readonly { name: string; qty: string; usual?: string }[]): string | null {
  if (items.length === 0) return null;
  if (items.length === 1 && items[0].usual) return `Added ${items[0].usual}: ${items[0].name}, ${items[0].qty}.`;
  const parts = items.map((i) => (i.usual ? `${i.usual} ${i.name} (${i.qty})` : i.qty && i.qty !== "1" ? `${i.name} (${i.qty})` : i.name));
  return `Added ${list(parts)}.`;
}
