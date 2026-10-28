// Pure split math with no DB import, so the dashboard's add-expense preview uses the same rule the service saves.
// Every function returns integer cents that sum to exactly the total (ADR 0007).
export type { SplitMethod } from "@/db/enums";
export type SplitRow = { memberId: string; cents: number };
export type PayerRow = { memberId: string; cents: number };
export type PercentRow = { memberId: string; percent: number };
export type SharesRow = { memberId: string; shares: number };

/** A split that doesn't add up. `remaining` > 0 means cents still to assign, < 0 means over by that much. */
export class SplitError extends Error {
  constructor(
    message: string,
    readonly remaining?: number,
  ) {
    super(message);
    this.name = "SplitError";
  }
}

const money = (cents: number) => `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** Leftover cents go to Payers first (in the given order), then by name, so the same input always splits the same way. */
export type TieBreak = { payerIds?: string[]; nameOf?: (memberId: string) => string };

/**
 * Split `total` cents evenly across `memberIds`. Leftover cents (total mod n) go one each,
 * starting with the payer if they're a participant, then the rest in the given order.
 * Example: 1000 across [a, b, c] with payer b -> b 334, a 333, c 333.
 */
export function splitEvenly(total: number, memberIds: string[], payerId?: string): SplitRow[] {
  const ids = [...new Set(memberIds)];
  if (ids.length === 0) return [];
  const base = Math.floor(total / ids.length);
  let remainder = total - base * ids.length;
  const order = payerId && ids.includes(payerId) ? [payerId, ...ids.filter((id) => id !== payerId)] : ids;
  const extra = new Map<string, number>();
  for (const id of order) {
    if (remainder <= 0) break;
    extra.set(id, 1);
    remainder -= 1;
  }
  return ids.map((memberId) => ({ memberId, cents: base + (extra.get(memberId) ?? 0) }));
}

function uniqueIds(ids: string[], nameOf?: (id: string) => string) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new SplitError(`${nameOf?.(id) ?? id} appears twice in the split.`);
    seen.add(id);
  }
}

/** Amounts typed with up to 4 decimals (33.3333%, 1.5 shares) become exact integers. */
const UNITS = 10_000;
const toUnits = (x: number) => Math.round(x * UNITS);

/**
 * Largest-remainder apportionment: each row gets floor(total * w / W); the leftover cents go one each to the rows
 * with the biggest remainders, ties broken by Payer first, then name, then input order. BigInt keeps it exact.
 */
export function apportion(total: number, rows: { memberId: string; weight: number }[], tie: TieBreak = {}): SplitRow[] {
  const live = rows.filter((r) => r.weight > 0);
  const W = live.reduce((s, r) => s + BigInt(r.weight), 0n);
  if (W === 0n) return [];
  const T = BigInt(total);
  const parts = live.map((r, idx) => {
    const num = T * BigInt(r.weight);
    return { memberId: r.memberId, cents: Number(num / W), rem: num % W, idx };
  });
  let leftover = total - parts.reduce((s, p) => s + p.cents, 0);
  const payerRank = (id: string) => {
    const i = tie.payerIds?.indexOf(id) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const name = (id: string) => tie.nameOf?.(id) ?? "";
  const order = [...parts].sort(
    (a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : 0) || payerRank(a.memberId) - payerRank(b.memberId) || name(a.memberId).localeCompare(name(b.memberId)) || a.idx - b.idx,
  );
  for (let k = 0; leftover > 0; k = (k + 1) % order.length, leftover--) order[k].cents += 1;
  return parts.map(({ memberId, cents }) => ({ memberId, cents }));
}

/** Exact amounts: they must add up to the total. Zero rows are dropped. */
export function splitExact(total: number, rows: SplitRow[], tie: TieBreak = {}): SplitRow[] {
  if (rows.length === 0) throw new SplitError("Who owes what? Give at least one amount.");
  uniqueIds(rows.map((r) => r.memberId), tie.nameOf);
  for (const r of rows) {
    if (!Number.isInteger(r.cents) || r.cents < 0) throw new SplitError(`Bad amount for ${tie.nameOf?.(r.memberId) ?? r.memberId}: ${r.cents} cents.`);
  }
  const sum = rows.reduce((s, r) => s + r.cents, 0);
  const remaining = total - sum;
  if (remaining > 0) throw new SplitError(`The amounts add up to ${money(sum)} but the total is ${money(total)}: ${money(remaining)} left to assign.`, remaining);
  if (remaining < 0) throw new SplitError(`The amounts add up to ${money(sum)}, ${money(-remaining)} more than the ${money(total)} total.`, remaining);
  return rows.filter((r) => r.cents > 0);
}

export const PERCENT_TOLERANCE = 0.01;

/** Percentages must sum to 100 (± 0.01, so 33.33 x 3 works). Leftover cents by largest remainder. */
export function splitPercent(total: number, rows: PercentRow[], tie: TieBreak = {}): SplitRow[] {
  if (rows.length === 0) throw new SplitError("Give each person a percentage.");
  uniqueIds(rows.map((r) => r.memberId), tie.nameOf);
  for (const r of rows) {
    if (!Number.isFinite(r.percent) || r.percent < 0) throw new SplitError(`Bad percentage for ${tie.nameOf?.(r.memberId) ?? r.memberId}: ${r.percent}.`);
  }
  const sum = rows.reduce((s, r) => s + r.percent, 0);
  if (Math.abs(sum - 100) > PERCENT_TOLERANCE + 1e-9) {
    const left = Math.round((100 - sum) * 100) / 100;
    throw new SplitError(`The percentages add up to ${Math.round(sum * 100) / 100}%, not 100% (${left > 0 ? `${left}% left` : `${-left}% over`}).`);
  }
  return apportion(total, rows.map((r) => ({ memberId: r.memberId, weight: toUnits(r.percent) })), tie);
}

/** Shares ("2:2:1"): each person's part is shares / total shares. Leftover cents by largest remainder. */
export function splitShares(total: number, rows: SharesRow[], tie: TieBreak = {}): SplitRow[] {
  if (rows.length === 0) throw new SplitError("Give each person a number of shares.");
  uniqueIds(rows.map((r) => r.memberId), tie.nameOf);
  for (const r of rows) {
    if (!Number.isFinite(r.shares) || r.shares < 0 || r.shares > 10_000) throw new SplitError(`Bad shares for ${tie.nameOf?.(r.memberId) ?? r.memberId}: ${r.shares}.`);
  }
  if (!rows.some((r) => r.shares > 0)) throw new SplitError("Somebody needs at least one share.");
  return apportion(total, rows.map((r) => ({ memberId: r.memberId, weight: toUnits(r.shares) })), tie);
}

/** Payers must cover the total exactly. Returns them biggest first (the first one is the primary Payer). */
export function checkPayers(total: number, payers: PayerRow[], nameOf?: (id: string) => string): PayerRow[] {
  if (payers.length === 0) throw new SplitError("Who paid?");
  uniqueIds(payers.map((p) => p.memberId), nameOf);
  for (const p of payers) {
    if (!Number.isInteger(p.cents) || p.cents < 0) throw new SplitError(`Bad amount paid by ${nameOf?.(p.memberId) ?? p.memberId}: ${p.cents} cents.`);
  }
  const sum = payers.reduce((s, p) => s + p.cents, 0);
  const remaining = total - sum;
  if (remaining !== 0) {
    throw new SplitError(
      remaining > 0
        ? `The payers cover ${money(sum)} of ${money(total)}: ${money(remaining)} unaccounted for.`
        : `The payers add up to ${money(sum)}, ${money(-remaining)} more than the ${money(total)} total.`,
      remaining,
    );
  }
  return payers
    .map((p, idx) => ({ ...p, idx }))
    .filter((p) => p.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.idx - b.idx)
    .map(({ memberId, cents }) => ({ memberId, cents }));
}

/** What the split's inputs look like for one method; the service and the dashboard both build Shares from this. */
export type SplitIntent =
  | { method: "equal"; among: string[] }
  | { method: "exact"; splits: SplitRow[] }
  | { method: "percent"; percents: PercentRow[] }
  | { method: "shares"; shares: SharesRow[] };

/** Shares for any method, plus the typed weight per member for percent/shares (stored so edits keep the method). */
export function computeShares(total: number, intent: SplitIntent, tie: TieBreak = {}): { rows: SplitRow[]; weights: Map<string, number> } {
  switch (intent.method) {
    case "equal": {
      if (intent.among.length === 0) throw new SplitError("Nobody to split with. Tick at least one person.");
      return { rows: splitEvenly(total, intent.among, tie.payerIds?.[0]), weights: new Map() };
    }
    case "exact":
      return { rows: splitExact(total, intent.splits, tie), weights: new Map() };
    case "percent":
      return { rows: splitPercent(total, intent.percents, tie), weights: new Map(intent.percents.filter((p) => p.percent > 0).map((p) => [p.memberId, p.percent])) };
    case "shares":
      return { rows: splitShares(total, intent.shares, tie), weights: new Map(intent.shares.filter((s) => s.shares > 0).map((s) => [s.memberId, s.shares])) };
  }
}
