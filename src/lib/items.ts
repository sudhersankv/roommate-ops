// Pure: one name per grocery thing, so "Milk 2%", "whole milk" and "milk, 1 gal" count as the same purchase (Restock,
// #26). Quantities and the units measuring them go (lib/units.ts), so do a few qualifiers; what makes it a different
// thing stays ("oat milk", "rice vinegar"). Comparing two names uses the Pantry's word rule (recipe-math.ts) both
// ways: same words, plurals aside. "milk" covers "oat milk" for a recipe, but they're different things to restock.
import { normalizeUnit } from "@/lib/units";
import { covers } from "@/services/recipe-math";

/** Words that say how good, how big or how much, not what. ("2%" and other numbers go as quantities.) */
const QUALIFIERS = new Set(["organic", "whole", "large", "small", "medium", "fresh", "jumbo", "extra", "family", "size"]);
const ARTICLES = new Set(["a", "an", "the", "some"]);
const NUMBER = /^(\d+(?:[./]\d+)?%?|[½⅓⅔¼¾⅛])$/;

const tokensOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[(),;:+&"*]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-z0-9½⅓⅔¼¾⅛]+|[^a-z0-9%]+$/g, ""))
    .filter(Boolean);

/** "Milk 2%" -> "milk", "a dozen eggs" -> "eggs", "bag of rice" -> "rice", "Oat Milk" -> "oat milk". */
export function normalizeItem(name: string): string {
  const tokens = tokensOf(name);
  const kept: string[] = [];
  let afterNumber = false;
  let afterUnit = false;
  tokens.forEach((t, k) => {
    const wasNumber = afterNumber;
    const wasUnit = afterUnit;
    afterNumber = afterUnit = false;
    if (NUMBER.test(t)) return void (afterNumber = true);
    if (ARTICLES.has(t)) return;
    if (t === "of" && (wasUnit || kept.length === 0)) return;
    // A unit only goes when it measures something: "2 lb", "a dozen", "bag of"; "paper cups" keeps its cups.
    if (normalizeUnit(t) && (wasNumber || t === "dozen" || tokens[k + 1] === "of")) return void (afterUnit = true);
    if (QUALIFIERS.has(t)) return;
    kept.push(t);
  });
  return (kept.length ? kept : tokens).join(" ");
}

/** The same thing to restock: the same words both ways, plurals aside ("egg" = "18 eggs"; "milk" != "oat milk"). */
export function sameItem(a: string, b: string): boolean {
  const x = normalizeItem(a);
  const y = normalizeItem(b);
  return x === y || (covers(x, y) && covers(y, x));
}
