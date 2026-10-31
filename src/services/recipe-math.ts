// Pure Recipe helpers (no DB import, so the dashboard can use them too): Pantry matching, have/need, scaling to
// servings and the fingerprint that decides when an Instacart recipe link is stale. Unit-tested in recipes.test.ts.
import type { RecipeIngredient } from "@/db/schema";
import { formatAmount, normalizeUnit, roundQuantity } from "@/lib/units";

const normalizeName = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

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

/* ---------- what a Recipe puts in the Cart: amounts you can buy (#37) ---------- */

/**
 * Things almost every kitchen has (salt, oil, the common spices): a Recipe's Cart items leave them out and Roomie names
 * them once ("I assumed you have salt and cumin"). Matched like the Pantry ("oil" covers "olive oil"); `EXACT` ones only
 * by their own name ("pepper" isn't "red bell pepper").
 */
const ASSUMED_COVERS = [
  "salt", "black pepper", "ground pepper", "peppercorns", "oil", "cooking spray", "sugar", "flour", "baking soda", "baking powder", "vanilla extract",
  "cumin", "chili powder", "paprika", "smoked paprika", "oregano", "cinnamon", "garlic powder", "onion powder", "red pepper flakes", "chili flakes",
  "cayenne", "cayenne pepper", "thyme", "dried basil", "bay leaves", "nutmeg", "curry powder", "turmeric", "italian seasoning",
];
const ASSUMED_EXACT = new Set(["pepper", "water", "ice", "salt and pepper"]);

/**
 * Assumed in the house, unless the Pantry says otherwise: `notKept` is what the Group took out of its Pantry ("we're
 * out of cumin for good" -> pantry_set remove), so a staple they told Roomie they don't keep goes in the Cart.
 */
export function assumedInHouse(name: string, notKept: readonly string[] = []): boolean {
  if (coveredBy(name, notKept)) return false;
  const n = normalizeName(name);
  return ASSUMED_EXACT.has(n) || coveredBy(name, ASSUMED_COVERS);
}

/** What a small amount of something comes in, and roughly how many cups one holds ("4 tbsp sour cream" -> 1 tub). */
const PACKAGES: readonly [readonly string[], string, number][] = [
  [["sour cream", "yogurt", "greek yogurt", "cream cheese", "cottage cheese", "ricotta", "hummus", "whipped cream"], "tub", 2],
  [["heavy cream", "cream", "half and half", "milk", "buttermilk", "broth", "stock", "coconut milk"], "carton", 4],
  [["soy sauce", "vinegar", "lime juice", "lemon juice", "fish sauce", "hot sauce", "ketchup", "mustard", "worcestershire sauce", "sriracha", "syrup", "wine", "juice"], "bottle", 2],
  [["honey", "mayonnaise", "mayo", "jam", "peanut butter", "salsa", "pesto", "tahini", "capers", "paste"], "jar", 2],
  [["butter"], "package", 2],
];
const CUPS: Partial<Record<string, number>> = { teaspoon: 1 / 48, tablespoon: 1 / 16, cup: 1, "fl oz": 1 / 8, milliliter: 1 / 236.6, pint: 2 };
const OUNCES: Partial<Record<string, number>> = { ounce: 1, pound: 16 };
const GRAMS: Partial<Record<string, number>> = { gram: 1, kilogram: 1000 };

export type BuyLine = { name: string; qty: string; quantity: number; unit: string };

/**
 * One ingredient as something you can buy, building on lib/units (cloves are already heads there): spoons and cups of a
 * liquid or dairy become the smallest package that holds them ("4 tbsp sour cream" -> "1 tub", "6 cups broth" -> "2
 * cartons"), weights round up to package sizes (8 oz, then whole pounds; 250 g, 500 g, then whole kilos), counts to whole
 * ones. Quarts, liters and gallons are bought as they are, rounded up.
 */
export function buyableAmount(i: { name: string; quantity: number; unit: string }): BuyLine {
  const unit = normalizeUnit(i.unit) ?? "each";
  const q = Number.isFinite(i.quantity) && i.quantity > 0 ? i.quantity : 1;
  const up = (x: number) => Math.max(1, Math.ceil(x - 1e-9));
  // "6 garlic cloves" as a count: heads, ten cloves to one.
  if (/\bcloves?\b/.test(i.name) && (unit === "each" || unit === "head")) {
    const name = i.name.replace(/\s*\bcloves?( of)?\b\s*/g, " ").trim() || "garlic";
    const heads = unit === "head" ? up(q) : up(q / 10);
    return { name, qty: formatAmount(heads, "head"), quantity: heads, unit: "head" };
  }
  const cups = CUPS[unit];
  if (cups !== undefined) {
    const [, word, holds] = PACKAGES.find(([names]) => coveredBy(i.name, names)) ?? [[], "package", 2];
    const n = up((q * cups) / holds);
    return { name: i.name, qty: `${n} ${n > 1 ? `${word}s` : word}`, quantity: n, unit: "package" };
  }
  const oz = OUNCES[unit];
  if (oz !== undefined) {
    const total = q * oz;
    if (total <= 8 + 1e-9) return { name: i.name, qty: "8 oz", quantity: 8, unit: "ounce" };
    const lb = up(total / 16);
    return { name: i.name, qty: formatAmount(lb, "pound"), quantity: lb, unit: "pound" };
  }
  const g = GRAMS[unit];
  if (g !== undefined) {
    const total = q * g;
    const size = [250, 500, 1000].find((s) => total <= s + 1e-9);
    if (size && size < 1000) return { name: i.name, qty: formatAmount(size, "gram"), quantity: size, unit: "gram" };
    const kg = up(total / 1000);
    return { name: i.name, qty: formatAmount(kg, "kilogram"), quantity: kg, unit: "kilogram" };
  }
  const n = up(q);
  return { name: i.name, qty: formatAmount(n, unit), quantity: n, unit };
}

/** A Recipe's missing ingredients -> what goes in the Cart (buyable amounts) and what's assumed in the house. */
export function recipeBuyList<T extends { name: string; quantity: number; unit: string }>(need: readonly T[], notKept: readonly string[] = []): { buy: { ingredient: T; line: BuyLine }[]; assumed: string[] } {
  const buy: { ingredient: T; line: BuyLine }[] = [];
  const assumed: string[] = [];
  for (const i of need) {
    if (assumedInHouse(i.name, notKept)) assumed.push(i.name);
    else buy.push({ ingredient: i, line: buyableAmount(i) });
  }
  return { buy, assumed };
}

const andList = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** The one line naming what was assumed, with the Pantry offer; null when nothing was. */
export function assumedLine(assumed: readonly string[]): string | null {
  if (!assumed.length) return null;
  return `I assumed you have ${andList(assumed)}; say if you're out. Want me to keep ${assumed.length === 1 ? "it" : "them"} in the Pantry?`;
}

/** recipe_add_to_cart's line: what went in, then the assumed ones named once. */
export function recipeAddedLine(title: string, added: number, assumed: readonly string[]): string {
  const first = added ? `Added ${added} thing${added === 1 ? "" : "s"} for ${title} to the Cart.` : `Nothing new to add for ${title}: it's in the Cart or the Pantry.`;
  return [first, assumedLine(assumed)].filter(Boolean).join(" ");
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
