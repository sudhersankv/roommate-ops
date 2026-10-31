// Pure: a Usual is the quantity someone usually adds of a thing, derived from the Group's own Cart history (open and
// purchased items), never stored and never guessed by the model (#57, #62). Scope matters: Dev's oat milk and the
// house's milk are separate usuals. No DB import: cart.ts feeds it rows.
import { sameItem } from "@/lib/items";

/** A past Cart item, as cart_items keeps it. */
export type PastAdd = { name: string; qty: string; addedBy: string; shared: boolean; createdAt: Date };

/** Whose usual: one Member's own items, or the house's shared ones. */
export type UsualScope = { shared: true } | { memberId: string };

/** cart_items.qty defaults to "1" when nobody said a quantity, so a bare 1 says nothing about a usual. */
const said = (qty: string) => {
  const q = qty.trim().replace(/\s+/g, " ");
  return q && q !== "1" ? q : null;
};
const key = (qty: string) => qty.toLowerCase();

/**
 * The usual quantity of `name` in `scope`: the one used in at least 2 of the latest 3 adds that had a quantity, or
 * the only one when there's been exactly one; null otherwise (then nothing is filled in). Returns the newest wording.
 */
export function usualFor(name: string, scope: UsualScope, history: readonly PastAdd[]): string | null {
  const inScope = (a: PastAdd) => ("shared" in scope ? a.shared : !a.shared && a.addedBy === scope.memberId);
  const qtys = history
    .filter((a) => inScope(a) && sameItem(a.name, name) && said(a.qty))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((a) => said(a.qty)!);
  if (qtys.length === 1) return qtys[0];
  const last3 = qtys.slice(0, 3);
  return last3.find((q) => last3.filter((x) => key(x) === key(q)).length >= 2) ?? null;
}
