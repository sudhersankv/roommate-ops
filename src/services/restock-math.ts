// Pure Restock math (#26, no DB import, so the Cart page can preview with it): how often a Group buys each thing and
// whether it's probably low today. Days are the Group's local days ("YYYY-MM-DD"); the caller turns `now` into one.
import { sameItem } from "@/lib/items";
import { addDaysToDay, daysBetweenDays } from "@/lib/time";

/** One purchase: the normalized item, who it was for (null = shared) and the local day. */
export type PurchaseEvent = { item: string; memberId: string | null; occurredOn: string };

/** "shared", or the Member whose personal habit it is. */
export type RestockScope = "shared" | string;

export type RestockCandidate = {
  item: string;
  lastBought: string;
  /** The last purchase plus the usual gap. */
  expectedOn: string;
  scope: RestockScope;
  /** Days past expectedOn (negative = not quite due, but inside the 0.9 margin). */
  overdueDays: number;
};

export type RestockOptions = {
  /** Nothing is guessed from fewer purchases (on distinct days) than this. */
  minEvents?: number;
  /** Probably low from this share of the usual gap on. */
  margin?: number;
  /** Bought this many days ago or less: never low. */
  freshDays?: number;
};

export const RESTOCK_DEFAULTS: Required<RestockOptions> = { minEvents: 3, margin: 0.9, freshDays: 2 };

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

type Habit = { item: string; scope: RestockScope; days: Set<string>; latest: { day: string; item: string } };

/**
 * What's probably low on `today`: per item and scope (shared, or one Member's own) with purchases on at least three
 * distinct days, the median gap between them is the habit. Low once the days since the last purchase reach
 * floor(0.9 x median) (purchases are whole days, so 0.9 x 9 = 8.1 falls on day 8), unless it was bought in the last
 * two days, a same-item line is open in the Cart (any scope), or the item is muted. Most overdue first.
 */
export function restockCandidates(
  events: readonly PurchaseEvent[],
  openCart: readonly { name: string }[],
  mutes: readonly string[],
  today: string,
  opts: RestockOptions = {},
): RestockCandidate[] {
  const { minEvents, margin, freshDays } = { ...RESTOCK_DEFAULTS, ...opts };
  const habits: Habit[] = [];
  for (const e of events) {
    const scope = e.memberId ?? "shared";
    let h = habits.find((x) => x.scope === scope && sameItem(x.item, e.item));
    if (!h) habits.push((h = { item: e.item, scope, days: new Set(), latest: { day: e.occurredOn, item: e.item } }));
    h.days.add(e.occurredOn);
    if (e.occurredOn >= h.latest.day) h.latest = { day: e.occurredOn, item: e.item };
  }

  const out: RestockCandidate[] = [];
  for (const h of habits) {
    if (h.days.size < minEvents) continue;
    const days = [...h.days].sort();
    const usual = median(days.slice(1).map((d, k) => daysBetweenDays(days[k], d)));
    const last = days[days.length - 1];
    const since = daysBetweenDays(last, today);
    if (since <= freshDays || since < Math.floor(margin * usual)) continue;
    const item = h.latest.item;
    if (openCart.some((c) => sameItem(c.name, item)) || mutes.some((m) => sameItem(m, item))) continue;
    const expectedOn = addDaysToDay(last, Math.round(usual));
    out.push({ item, lastBought: last, expectedOn, scope: h.scope, overdueDays: daysBetweenDays(expectedOn, today) });
  }
  return out.sort((a, b) => b.overdueDays - a.overdueDays || a.item.localeCompare(b.item));
}

/** "Probably low: milk, dish soap. Add them?" At most `max` names, then "+N more". No prices, no amounts. */
export function restockLine(candidates: readonly Pick<RestockCandidate, "item">[], max = 4): string | null {
  if (!candidates.length) return null;
  const names = candidates.slice(0, max).map((c) => c.item);
  const more = candidates.length - names.length;
  return `Probably low: ${names.join(", ")}${more ? ` +${more} more` : ""}. ${candidates.length === 1 ? "Add it?" : "Add them?"}`;
}
