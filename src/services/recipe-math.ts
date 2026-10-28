// Pure Recipe helpers (no DB import, so the dashboard can use them too): Pantry matching, have/need, scaling to
// servings and the fingerprint that decides when an Instacart recipe link is stale. Unit-tested in recipes.test.ts.
import type { RecipeIngredient } from "@/db/schema";
import { normalizeName } from "@/lib/prices";
import { normalizeUnit, roundQuantity } from "@/lib/units";

const singular = (s: string) => (s.length > 3 && s.endsWith("es") && /(ch|sh|ss|x|o)es$/.test(s) ? s.slice(0, -2) : s.length > 3 && s.endsWith("s") && !s.endsWith("ss") ? s.slice(0, -1) : s);
const words = (s: string) => normalizeName(s).split(" ").filter(Boolean).map(singular);

/** "  Olive OIL " -> "olive oil": how Pantry items are stored and compared. */
export const pantryName = (s: string) => normalizeName(s).slice(0, 60);

/**
 * Does an ingredient count as this Pantry (or skip) item? Every word of the item has to be in the ingredient, and the
 * ingredient's last word (the thing itself) has to be one of the item's words: "oil" covers "olive oil" and "salt"
 * covers "kosher salt", but "rice" doesn't cover "rice vinegar" and "chicken" doesn't cover "chicken broth".
 */
export function covers(item: string, ingredient: string): boolean {
  const a = words(item);
  const b = words(ingredient);
  if (a.length === 0 || b.length === 0) return false;
  return a.every((w) => b.includes(w)) && a.includes(b[b.length - 1]);
}

export const coveredBy = (ingredient: string, list: readonly string[]) => list.some((item) => covers(item, ingredient));

export type HaveNeed<T extends { name: string }> = { have: T[]; need: T[] };

/** Ingredients the Group already has (Pantry, or "we have onions") vs the ones to buy. */
export function haveNeed<T extends { name: string }>(ingredients: T[], pantry: readonly string[], skip: readonly string[] = []): HaveNeed<T> {
  const have: T[] = [];
  const need: T[] = [];
  for (const i of ingredients) (coveredBy(i.name, pantry) || coveredBy(i.name, skip) ? have : need).push(i);
  return { have, need };
}

/** Countable units round up to whole ones (you can't buy 2.4 limes); measured ones keep two decimals. */
const COUNTABLE = new Set(["each", "can", "bunch", "head", "ears", "large", "medium", "small", "package", "packet"]);

function scaleText(text: string, before: number, after: number, from: number, to: number): string {
  // Only the leading amount is rewritten ("2 lb ground beef" -> "3 lb ground beef"); the rest stays as written. When
  // it's the ingredient's own quantity, it becomes the new (rounded) quantity, so "3 limes" reads "4 limes".
  return text.replace(/^\s*(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?/, (_m, a: string, b?: string) => {
    const n = b ? Number(a) / Number(b) : Number(a);
    return String(Math.abs(n - before) < 0.01 ? after : roundQuantity((n * to) / from));
  });
}

/** Ingredients for `to` servings from a recipe written for `from`. */
export function scaleIngredients(ingredients: RecipeIngredient[], from: number, to: number): RecipeIngredient[] {
  if (!(from > 0) || !(to > 0) || from === to) return ingredients;
  return ingredients.map((i) => {
    const unit = normalizeUnit(i.unit) ?? i.unit;
    const raw = (i.quantity * to) / from;
    const quantity = COUNTABLE.has(unit) ? Math.max(1, Math.ceil(raw - 1e-9)) : roundQuantity(raw);
    return { ...i, quantity, display_text: scaleText(i.display_text, i.quantity, quantity, from, to) };
  });
}

/** FNV-1a over what an Instacart recipe page is made from. A different key means the cached link is stale. */
export function recipeKey(r: { title: string; servings: number; ingredients: RecipeIngredient[] }): string {
  const s = JSON.stringify([r.title, r.servings, r.ingredients.map((i) => [i.name, i.quantity, i.unit])]);
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
