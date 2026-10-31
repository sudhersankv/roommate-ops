// The Settle nudge (#25, ADR 0019): once a week, in the report's hour, anyone who has owed the same person more than
// the Group's threshold ($20 by default) for at least its days (7) gets one private DM per creditor with the amount
// and pay links; the group only hears a count in the report. The age of a debt is the day of its oldest unsettled
// contribution (older ones are taken as paid first), or the last Settlement between them if later: a partial payment
// starts the clock again. Members who said "stop nudging me" (member_notes.note.nudges = "off") are skipped.
// Settings: group_toolkits[splitting].settings.nudge. The rules are pure (settle-nudge.test.ts).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { payLinks } from "@/lib/pay-links";
import { splitting } from "@/toolkits/splitting/manifest";
import { recordFor } from "./activity";
import { requireAdmin } from "./authz";
import { listMembersWithHandles } from "./members";
import { computeSettlePlan, pairwiseDebts, type Transfer } from "./money";
import { mayPost, sendDms, type DmOutcome, type RentDm } from "./rent";
import { claimPost, getSchedule, groupTimezone, weeklyReportWindow } from "./schedule";
import { moneyIn, type Ctx, type GroupCtx } from "./types";
import { currencyOf } from "./groups";

const { expenses, expensePayers, expenseSplits, settlements, memberNotes, groupToolkits } = schema;
const DAY_MS = 86_400_000;

export type NudgeSettings = { thresholdCents: number; thresholdDays: number; enabled: boolean };
export const DEFAULT_NUDGE: NudgeSettings = { thresholdCents: 2000, thresholdDays: 7, enabled: true };

/** When each pair's debt was run up: one row per Share owed to a Payer, and the Settlements. */
export type LedgerDates = {
  contributions: { fromId: string; toId: string; cents: number; at: Date }[];
  settlements: { fromId: string; toId: string; at: Date }[];
};
export type NudgeCandidate = Transfer & { since: Date };

/* ---------- pure ---------- */

/** Each Expense's Shares owed to its Payers (the same per-Expense pairing pairwise debts use), dated by its day. */
export function contributionsOf(ledger: { occurredOn: string; payers: { memberId: string; cents: number }[]; shares: { memberId: string; cents: number }[] }[]): LedgerDates["contributions"] {
  const out: LedgerDates["contributions"] = [];
  for (const e of ledger) {
    const net = new Map<string, number>();
    for (const p of e.payers) net.set(p.memberId, (net.get(p.memberId) ?? 0) + p.cents);
    for (const s of e.shares) net.set(s.memberId, (net.get(s.memberId) ?? 0) - s.cents);
    const at = new Date(`${e.occurredOn}T12:00:00Z`);
    for (const t of computeSettlePlan([...net].map(([memberId, cents]) => ({ memberId, name: memberId, cents })))) out.push({ fromId: t.fromId, toId: t.toId, cents: t.cents, at });
  }
  return out;
}

/**
 * Who to nudge: each pairwise debt over `thresholdCents` whose age (see the top) is at least `thresholdDays`, minus
 * the opted-out debtors. In the debts' order.
 */
export function nudgeCandidates(
  debts: readonly Transfer[],
  dates: LedgerDates,
  now: Date,
  opts: Partial<Pick<NudgeSettings, "thresholdCents" | "thresholdDays">> & { optedOut?: ReadonlySet<string> } = {},
): NudgeCandidate[] {
  const minCents = opts.thresholdCents ?? DEFAULT_NUDGE.thresholdCents;
  const minAge = (opts.thresholdDays ?? DEFAULT_NUDGE.thresholdDays) * DAY_MS;
  const out: NudgeCandidate[] = [];
  for (const d of debts) {
    if (d.cents <= minCents || opts.optedOut?.has(d.fromId)) continue;
    // The newest contributions make up what's still owed; the one that completes it is the oldest unsettled.
    const mine = dates.contributions.filter((c) => c.fromId === d.fromId && c.toId === d.toId).sort((a, b) => b.at.getTime() - a.at.getTime());
    let left = d.cents;
    let since: Date | undefined;
    for (const c of mine) {
      since = c.at;
      left -= c.cents;
      if (left <= 0) break;
    }
    if (!since) continue;
    for (const s of dates.settlements) if (s.fromId === d.fromId && s.toId === d.toId && s.at > since) since = s.at;
    if (now.getTime() - since.getTime() >= minAge) out.push({ ...d, since });
  }
  return out;
}

/** The DM: their amount, who to, how to close it. */
export function nudgeText(c: Pick<NudgeCandidate, "toName" | "cents">, hasLink: boolean, currency = "USD"): string {
  const head = `Quick one: you owe ${c.toName} ${moneyIn(currency)(c.cents)}.`;
  return hasLink ? `${head} Tap to pay, then say "paid" here.` : `${head} No pay link yet: ${c.toName} can tell me their Venmo, PayPal or Cash App. Say "paid" here once it's done.`;
}

const wholeIn = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** Stored settings -> NudgeSettings, defaults for anything missing or odd. */
export function readNudgeSettings(settings: Record<string, unknown> | undefined): NudgeSettings {
  const n = (settings?.nudge ?? {}) as Partial<Record<keyof NudgeSettings, unknown>>;
  return {
    thresholdCents: wholeIn(n.thresholdCents, 0, 10_000_000) ? (n.thresholdCents as number) : DEFAULT_NUDGE.thresholdCents,
    thresholdDays: wholeIn(n.thresholdDays, 1, 60) ? (n.thresholdDays as number) : DEFAULT_NUDGE.thresholdDays,
    enabled: typeof n.enabled === "boolean" ? n.enabled : DEFAULT_NUDGE.enabled,
  };
}

/** Throws a message Roomie or Settings can show. */
export function validateNudgeSettings(patch: Partial<NudgeSettings>): Partial<NudgeSettings> {
  const out: Partial<NudgeSettings> = {};
  if (patch.thresholdCents !== undefined) {
    if (!Number.isInteger(patch.thresholdCents) || patch.thresholdCents < 0) throw new Error("The nudge amount is whole cents, $0 or more.");
    out.thresholdCents = patch.thresholdCents;
  }
  if (patch.thresholdDays !== undefined) {
    if (!wholeIn(patch.thresholdDays, 1, 60)) throw new Error("A debt gets nudged after 1 to 60 days.");
    out.thresholdDays = patch.thresholdDays;
  }
  if (patch.enabled !== undefined) out.enabled = !!patch.enabled;
  return out;
}

/* ---------- DB ---------- */

async function moneySettings(groupId: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await db
    .select({ settings: groupToolkits.settings })
    .from(groupToolkits)
    .where(and(eq(groupToolkits.groupId, groupId), eq(groupToolkits.toolkit, splitting.id)));
  return row?.settings;
}

export async function getNudgeSettings(ctx: GroupCtx): Promise<NudgeSettings> {
  return readNudgeSettings(await moneySettings(ctx.groupId));
}

/** Admin: the Group's threshold, days, and on/off. */
export async function updateNudgeSettings(ctx: Ctx, patch: Partial<NudgeSettings>): Promise<NudgeSettings> {
  await requireAdmin(ctx);
  const clean = validateNudgeSettings(patch);
  const next = { ...(await getNudgeSettings(ctx)), ...clean };
  const settings = { ...((await moneySettings(ctx.groupId)) ?? {}), nudge: next };
  await db
    .insert(groupToolkits)
    .values({ groupId: ctx.groupId, toolkit: splitting.id, enabled: true, settings })
    .onConflictDoUpdate({ target: [groupToolkits.groupId, groupToolkits.toolkit], set: { settings } });
  const what = next.enabled ? `set the settle nudge to over ${moneyIn(await currencyOf(ctx.groupId))(next.thresholdCents)} for ${next.thresholdDays} days` : "turned the settle nudge off";
  await recordFor(ctx, "group.settings", what, { table: "groups", id: ctx.groupId });
  return next;
}

/** The Group's ledger with dates (live Expenses, not variable parents; every Settlement). */
async function ledgerDates(groupId: string): Promise<LedgerDates> {
  const live = and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt), eq(expenses.variable, false));
  const [rows, payers, shares, paid] = await Promise.all([
    db.select({ id: expenses.id, occurredOn: expenses.occurredOn }).from(expenses).where(live),
    db.select({ expenseId: expensePayers.expenseId, memberId: expensePayers.memberId, cents: expensePayers.cents }).from(expensePayers).innerJoin(expenses, eq(expensePayers.expenseId, expenses.id)).where(live),
    db.select({ expenseId: expenseSplits.expenseId, memberId: expenseSplits.memberId, cents: expenseSplits.cents }).from(expenseSplits).innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id)).where(live),
    db.select({ fromId: settlements.fromId, toId: settlements.toId, at: settlements.createdAt }).from(settlements).where(eq(settlements.groupId, groupId)),
  ]);
  const by = new Map(rows.map((r) => [r.id, { occurredOn: r.occurredOn, payers: [] as { memberId: string; cents: number }[], shares: [] as { memberId: string; cents: number }[] }]));
  for (const p of payers) by.get(p.expenseId)?.payers.push(p);
  for (const s of shares) by.get(s.expenseId)?.shares.push(s);
  return { contributions: contributionsOf([...by.values()]), settlements: paid };
}

/** Members who turned their nudges off. */
async function optedOut(memberIds: string[]): Promise<Set<string>> {
  if (!memberIds.length) return new Set();
  const rows = await db.select({ id: memberNotes.memberId, note: memberNotes.note }).from(memberNotes).where(inArray(memberNotes.memberId, memberIds));
  return new Set(rows.filter((r) => r.note?.nudges === "off").map((r) => r.id));
}

/** Who'd be nudged right now under the Group's settings (empty when it's off). */
export async function settleNudgeCandidates(ctx: GroupCtx, now = new Date()): Promise<NudgeCandidate[]> {
  const settings = await getNudgeSettings(ctx);
  if (!settings.enabled) return [];
  const [debts, dates] = await Promise.all([pairwiseDebts(ctx), ledgerDates(ctx.groupId)]);
  return nudgeCandidates(debts, dates, now, { ...settings, optedOut: await optedOut([...new Set(debts.map((d) => d.fromId))]) });
}

/** The DMs for those candidates, pay links to each creditor's handles. */
export async function settleNudgeDms(ctx: GroupCtx, now = new Date()): Promise<RentDm[]> {
  const [candidates, people, currency] = await Promise.all([settleNudgeCandidates(ctx, now), listMembersWithHandles(ctx), currencyOf(ctx.groupId)]);
  const handlesOf = new Map(people.map((p) => [p.id, p.handles]));
  return candidates.map((c) => {
    const buttons = payLinks(handlesOf.get(c.toId) ?? {}, c.cents, { to: c.toName });
    return { memberId: c.fromId, cents: c.cents, text: nudgeText(c, buttons.length > 0, currency), buttons };
  });
}

/**
 * The weekly Settle nudge: only in the report's day and hour, claimed as scheduled_posts "nudge.settle" for that
 * local day, then one DM per pair. Called from Money's report() (the weekly report job builds it in that hour; the
 * scheduler is untouched). Returns what happened to each DM (none when it wasn't time).
 */
export async function settleNudgeJob(ctx: GroupCtx, now = new Date()): Promise<DmOutcome[]> {
  const [tz, sched, settings] = await Promise.all([groupTimezone(ctx.groupId), getSchedule(ctx), getNudgeSettings(ctx)]);
  if (!settings.enabled) return [];
  const w = weeklyReportWindow(now, tz, sched.reportWeekday, sched.reportHour);
  if (!w.open || !(await mayPost(ctx.groupId))) return [];
  if (!(await claimPost(ctx.groupId, "nudge.settle", w.period))) return [];
  return sendDms(ctx.groupId, await settleNudgeDms(ctx, now), now);
}
