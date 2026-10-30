// Pure Cart math (no DB import), so the dashboard's "I paid" drawer previews with the same function markPurchased
// uses. Unit-tested in cart.test.ts.
import type { SplitRow } from "./split";

/** The bits of an item the split needs. `estCents` is ignored: there are no prices in the Cart (old rows have one). */
export type SplitItem = { addedBy: string; shared: boolean; estCents?: number | null };

/** Whoever added an item, or an Admin, can take it off the Cart. */
export const canRemoveItem = (actor: { id: string; role: string }, item: { addedBy: string }) => actor.role === "admin" || item.addedBy === actor.id;

/**
 * Split `totalCents` across people by what they put in the cart, one share per item (the Cart has no prices; a
 * receipt photo through Splitting splits item by item with the real prices):
 *  - each person's own items count 1 each;
 *  - shared items (and items added by someone no longer active) are split evenly across `activeMemberIds`;
 *  - weights scale to totalCents; rounding remainder cents go one each, payer first, then by largest leftover fraction.
 * Members with zero weight are omitted. Rows always sum to exactly totalCents.
 */
export function computeCartSplits(items: SplitItem[], activeMemberIds: string[], totalCents: number, payerId?: string): SplitRow[] {
  const active = [...new Set(activeMemberIds)];
  if (active.length === 0 || items.length === 0) return [];
  const activeSet = new Set(active);

  // Integer weights: an item is `active.length` units, so a shared one is 1 unit each.
  const weight = new Map<string, number>();
  const bump = (id: string, w: number) => weight.set(id, (weight.get(id) ?? 0) + w);
  for (const i of items) {
    if (i.shared || !activeSet.has(i.addedBy)) for (const id of active) bump(id, 1);
    else bump(i.addedBy, active.length);
  }
  const totalWeight = [...weight.values()].reduce((s, w) => s + w, 0);
  if (totalWeight <= 0) return [];

  const order = active.filter((id) => (weight.get(id) ?? 0) > 0);
  if (payerId && order.includes(payerId)) order.splice(0, 0, ...order.splice(order.indexOf(payerId), 1));
  const rows = order.map((memberId, idx) => {
    const exact = (totalCents * (weight.get(memberId) ?? 0)) / totalWeight;
    const cents = Math.floor(exact + 1e-9);
    return { memberId, cents, frac: exact - cents, idx };
  });
  let remainder = totalCents - rows.reduce((s, r) => s + r.cents, 0);
  const byClaim = [...rows].sort((a, b) => {
    if (payerId && a.memberId !== b.memberId) {
      if (a.memberId === payerId) return -1;
      if (b.memberId === payerId) return 1;
    }
    return b.frac - a.frac || a.idx - b.idx;
  });
  for (let k = 0; remainder > 0; k = (k + 1) % byClaim.length) {
    byClaim[k].cents += 1;
    remainder -= 1;
  }
  return rows.map(({ memberId, cents }) => ({ memberId, cents }));
}
