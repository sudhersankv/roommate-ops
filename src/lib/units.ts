// Units of measurement Instacart accepts (docs.instacart.com/developer_platform_api/api/units_of_measurement), and the
// synonyms people and models actually write. Pure and client-safe: Recipes, the Cart and the Instacart client use it.

export const INSTACART_UNITS = [
  "cup", "fl oz", "gallon", "milliliter", "liter", "pint", "quart", "tablespoon", "teaspoon",
  "gram", "kilogram", "ounce", "pound",
  "bunch", "can", "each", "ears", "head", "large", "medium", "small", "package", "packet",
] as const;
export type InstacartUnit = (typeof INSTACART_UNITS)[number];

const SYNONYMS: Record<string, InstacartUnit> = {
  c: "cup", cups: "cup",
  "fluid ounce": "fl oz", "fluid ounces": "fl oz", floz: "fl oz",
  gallons: "gallon", gal: "gallon", gals: "gallon",
  millilitre: "milliliter", milliliters: "milliliter", millilitres: "milliliter", ml: "milliliter", mls: "milliliter",
  litre: "liter", liters: "liter", litres: "liter", l: "liter",
  pints: "pint", pt: "pint", pts: "pint",
  quarts: "quart", qt: "quart", qts: "quart",
  tablespoons: "tablespoon", tbsp: "tablespoon", tbsps: "tablespoon", tb: "tablespoon", tbs: "tablespoon", tbl: "tablespoon",
  teaspoons: "teaspoon", tsp: "teaspoon", tsps: "teaspoon", ts: "teaspoon", tspn: "teaspoon",
  grams: "gram", g: "gram", gs: "gram", gr: "gram",
  kilograms: "kilogram", kg: "kilogram", kgs: "kilogram", kilo: "kilogram", kilos: "kilogram",
  ounces: "ounce", oz: "ounce",
  pounds: "pound", lb: "pound", lbs: "pound",
  bunches: "bunch",
  cans: "can", tin: "can", tins: "can",
  ea: "each", pc: "each", pcs: "each", piece: "each", pieces: "each", whole: "each", unit: "each", units: "each", x: "each", count: "each", ct: "each",
  ear: "ears",
  heads: "head",
  lrg: "large", lge: "large", lg: "large",
  med: "medium", md: "medium",
  sm: "small",
  packages: "package", pkg: "package", pkgs: "package", pack: "package", packs: "package", box: "package", boxes: "package", bag: "package", bags: "package", jar: "package", jars: "package", bottle: "package", bottles: "package", carton: "package", cartons: "package", container: "package", containers: "package", loaf: "package", loaves: "package", dozen: "package",
  packets: "packet", sachet: "packet", sachets: "packet", envelope: "packet",
};

/**
 * Units Instacart doesn't sell by, turned into one that it does (a recipe says "3 cloves garlic", the store sells
 * heads). The display text keeps what the recipe said.
 */
const BUY_AS: Record<string, (q: number) => { quantity: number; unit: InstacartUnit }> = {
  clove: (q) => ({ quantity: Math.max(1, Math.ceil(q / 10)), unit: "head" }),
  cloves: (q) => ({ quantity: Math.max(1, Math.ceil(q / 10)), unit: "head" }),
  slice: () => ({ quantity: 1, unit: "package" }),
  slices: () => ({ quantity: 1, unit: "package" }),
  sprig: () => ({ quantity: 1, unit: "bunch" }),
  sprigs: () => ({ quantity: 1, unit: "bunch" }),
  stalk: () => ({ quantity: 1, unit: "bunch" }),
  stalks: () => ({ quantity: 1, unit: "bunch" }),
  pinch: (q) => ({ quantity: roundQuantity(q / 8), unit: "teaspoon" }),
  pinches: (q) => ({ quantity: roundQuantity(q / 8), unit: "teaspoon" }),
  dash: (q) => ({ quantity: roundQuantity(q / 8), unit: "teaspoon" }),
  dashes: (q) => ({ quantity: roundQuantity(q / 8), unit: "teaspoon" }),
};

const clean = (u: string) => u.trim().toLowerCase().replace(/\.$/, "").replace(/\s+/g, " ");

/** "tbsp" -> "tablespoon", "Lbs" -> "pound"; null when it isn't one of Instacart's units or a known synonym. */
export function normalizeUnit(raw: string | null | undefined): InstacartUnit | null {
  if (!raw) return null;
  const u = clean(raw);
  if ((INSTACART_UNITS as readonly string[]).includes(u)) return u as InstacartUnit;
  return SYNONYMS[u] ?? null;
}

/** 0.333 -> 0.33, 2.0 -> 2: quantities are kept to two decimals. */
export const roundQuantity = (q: number) => Math.round(q * 100) / 100;

/**
 * A quantity + unit Instacart will take. Known units and synonyms map straight across; clove/slice/pinch-style units
 * become what you'd buy; anything else is null so the caller can reject it (or fall back to `each`).
 */
export function toInstacartMeasurement(quantity: number, unit: string | null | undefined): { quantity: number; unit: InstacartUnit } | null {
  const q = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
  const u = normalizeUnit(unit);
  if (u) return { quantity: roundQuantity(q), unit: u };
  const buy = unit ? BUY_AS[clean(unit)] : undefined;
  return buy ? buy(q) : null;
}

/** Like toInstacartMeasurement, but never null: an unknown unit is bought as `each` (count). */
export function measurementOrEach(quantity: number | null | undefined, unit: string | null | undefined): { quantity: number; unit: InstacartUnit } {
  return toInstacartMeasurement(quantity ?? 1, unit) ?? { quantity: roundQuantity(quantity && quantity > 0 ? quantity : 1), unit: "each" };
}

const FRACTIONS: Record<string, number> = { "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅛": 0.125 };

/**
 * Free-text Cart quantities ("2 lb", "3 bags", "1/2 cup", "12") -> a number and an Instacart unit. A bare number
 * is a count (`each`). Null when there's no leading number.
 */
export function parseAmount(qty: string | null | undefined): { quantity: number; unit: InstacartUnit } | null {
  const s = String(qty ?? "").trim().toLowerCase().replace(/[½⅓⅔¼¾⅛]/g, (f) => ` ${FRACTIONS[f]}`).trim();
  const m = /^(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?(?:\s*\/\s*(\d+))?\s*([a-z][a-z .]*)?/.exec(s);
  if (!m) return null;
  let n = Number(m[1]);
  if (m[3]) n = m[2] ? n + Number(m[2]) / Number(m[3]) : n / Number(m[3]);
  else if (m[2]) n += Number(m[2]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const words = (m[4] ?? "").trim();
  if (!words) return { quantity: roundQuantity(n), unit: "each" };
  // "2 bags of chips": the unit is the first word or two ("fl oz"), the rest is the item.
  const [first, second] = words.split(" ");
  // "12 pack" / "24 ct" size one item, they don't count twelve of them.
  if (/^(pack|packs|ct|count)$/.test(first)) return { quantity: 1, unit: "package" };
  return toInstacartMeasurement(n, second ? `${first} ${second}` : first) ?? toInstacartMeasurement(n, first) ?? { quantity: roundQuantity(n), unit: "each" };
}

/** What a bare count of the thing usually comes in, for the "12 and 18 what?" question. */
const PACKS: Record<string, string> = { egg: "cartons", eggs: "cartons", milk: "cartons", "oat milk": "cartons", water: "bottles", soda: "cans", beer: "cans", yogurt: "cups", bread: "loaves" };

export type QtyItem = { name: string; qty?: string };

/**
 * Free-text Cart quantities, stored as people said them ("2 cartons", "12", "1 lb"), except when they can't be
 * read one way: several bare numbers for one thing ("eggs, 12, 18" arrives as "12, 18", or as two eggs lines
 * with "12" and "18"). Those are held back with one short question each; everything else is fine as is.
 */
export function clarifyQuantities(items: QtyItem[]): { ok: QtyItem[]; questions: string[] } {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const bare = (q: string | undefined) => /^\s*\d+(?:\.\d+)?\s*$/.test(q ?? "");
  const numbersIn = (q: string | undefined) => {
    const parts = (q ?? "").split(/\s*(?:,|\bor\b|\band\b|&)\s*/i).map((p) => p.trim()).filter(Boolean);
    return parts.length > 1 && parts.every((p) => /^\d+(?:\.\d+)?$/.test(p)) ? parts : null;
  };
  const counts = new Map<string, string[]>();
  for (const i of items) if (bare(i.qty)) counts.set(key(i.name), [...(counts.get(key(i.name)) ?? []), i.qty!.trim()]);
  const ok: QtyItem[] = [];
  const asked = new Map<string, string[]>();
  for (const i of items) {
    const k = key(i.name);
    const several = numbersIn(i.qty) ?? (bare(i.qty) && new Set(counts.get(k)).size > 1 ? counts.get(k)! : null);
    if (several) asked.set(k, [...new Set([...(asked.get(k) ?? []), ...several])]);
    else ok.push(i);
  }
  const questions = [...asked].map(([name, nums]) => `${name}: ${nums.join(" and ")} what? ${PACKS[name] ?? "packs"} or ${name}?`);
  return { ok, questions };
}

const PLURAL: Partial<Record<InstacartUnit, string>> = { cup: "cups", gallon: "gallons", milliliter: "ml", liter: "liters", pint: "pints", quart: "quarts", tablespoon: "tbsp", teaspoon: "tsp", gram: "g", kilogram: "kg", ounce: "oz", pound: "lb", bunch: "bunches", can: "cans", head: "heads", package: "packages", packet: "packets" };
const SHORT: Partial<Record<InstacartUnit, string>> = { tablespoon: "tbsp", teaspoon: "tsp", gram: "g", kilogram: "kg", ounce: "oz", pound: "lb", milliliter: "ml" };

/** 1.5, "pound" -> "1.5 lb"; 3, "each" -> "3"; 0.5, "cup" -> "1/2 cup". For the Cart's qty text. */
export function formatAmount(quantity: number, unit: string): string {
  const q = roundQuantity(quantity);
  const frac: Record<number, string> = { 0.25: "1/4", 0.33: "1/3", 0.5: "1/2", 0.67: "2/3", 0.75: "3/4" };
  const whole = Math.floor(q);
  const rest = roundQuantity(q - whole);
  const num = frac[rest] ? (whole ? `${whole} ${frac[rest]}` : frac[rest]) : String(q);
  const u = normalizeUnit(unit);
  if (!u || u === "each") return num;
  const word = q > 1 ? (PLURAL[u] ?? u) : (SHORT[u] ?? u);
  return `${num} ${word}`;
}
