// Pure Cart math (no DB import), so the dashboard's "I paid" drawer previews with the same function markPurchased
// uses. Unit-tested in cart.test.ts.
import type { SplitRow } from "./split";

/** The bits of an item the split needs. */
export type SplitItem = { addedBy: string; shared: boolean; estCents: number | null };

/** Whoever added an item, or an Admin, can take it off the Cart. */
export const canRemoveItem = (actor: { id: string; role: string }, item: { addedBy: string }) => actor.role === "admin" || item.addedBy === actor.id;

/** Sum of estimates (unknown = 0). */
export function cartTotal(items: { estCents: number | null }[]): number {
  return items.reduce((s, i) => s + (i.estCents ?? 0), 0);
}

/**
 * Split `totalCents` across people by what they put in the cart:
 *  - each person's own items weigh their estCents;
 *  - shared items (and items added by someone no longer active) are weighed evenly across `activeMemberIds`;
 *  - weights scale to totalCents; rounding remainder cents go one each, payer first, then by largest leftover fraction.
 * Members with zero weight are omitted. Rows always sum to exactly totalCents. If no item has an estimate, each
 * item counts 1 so the split is by item count.
 */
export function computeCartSplits(items: SplitItem[], activeMemberIds: string[], totalCents: number, payerId?: string): SplitRow[] {
  const active = [...new Set(activeMemberIds)];
  if (active.length === 0 || items.length === 0) return [];
  const activeSet = new Set(active);
  const noEstimates = items.every((i) => !((i.estCents ?? 0) > 0));
  const weightOf = (i: SplitItem) => (noEstimates ? 1 : Math.max(0, i.estCents ?? 0));

  const weight = new Map<string, number>();
  const bump = (id: string, w: number) => weight.set(id, (weight.get(id) ?? 0) + w);
  for (const i of items) {
    const w = weightOf(i);
    if (w <= 0) continue;
    if (i.shared || !activeSet.has(i.addedBy)) for (const id of active) bump(id, w / active.length);
    else bump(i.addedBy, w);
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
