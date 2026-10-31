// The Settle nudge (ADR 0021, supersedes the weekly batch of ADR 0017 §4 / 0019 §5): per pairwise debt over the
// Group's threshold ($5 by default), a private DM once the debt's newest contribution is 4 hours old, then every
// `everyDays` (2) while it's still over the line, 5 at most per episode. An episode starts when the debt goes over the
// threshold, or with a Settlement from the debtor that leaves it over (a partial payment starts the count again); the
// debt dropping to the threshold or under ends it. Each DM is shorter than the last and carries the payee's pay links.
// Sent in the Bundle's hour from Money's bundle(), claimed in scheduled_posts as "nudge.settle" with period
// "<localDay>:<fromId>:<toId>", which is also the history the cadence reads. Members who said "stop nudging me"
// (member_notes.note.nudges = "off") are skipped. Settings: group_toolkits[splitting].settings.nudge. The rules are
// pure (settle-nudge.test.ts).
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { payLinks } from "@/lib/pay-links";
import { daytimeHour } from "@/lib/quiet-hours";
import { dayInZone, daysBetweenDays } from "@/lib/time";
import { splitting } from "@/toolkits/splitting/manifest";
import { recordFor } from "./activity";
import { requireAdmin } from "./authz";
import { listMembersWithHandles } from "./members";
import { computeSettlePlan, pairwiseDebts, type Transfer } from "./money";
import { mayPost, sendDms, type DmOutcome, type RentDm } from "./rent";
import { bundleWindow, claimPost, getSchedule, groupTimezone, releasePost } from "./schedule";
import { moneyIn, type Ctx, type GroupCtx } from "./types";
import { currencyOf } from "./groups";

const { expenses, expensePayers, expenseSplits, settlements, memberNotes, groupToolkits, scheduledPosts } = schema;
const HOUR_MS = 3_600_000;
const KIND = "nudge.settle" as const;

export type NudgeSettings = { thresholdCents: number; everyDays: number; enabled: boolean };
export const DEFAULT_NUDGE: NudgeSettings = { thresholdCents: 500, everyDays: 2, enabled: true };
/** DMs per episode, and how old the newest contribution must be before the first (so a quick "paid" or edit wins). */
export const MAX_NUDGES = 5;
export const FIRST_AFTER_MS = 4 * HOUR_MS;

/** Each pair's ledger with times: one row per Share owed to a Payer (when the Expense was logged), and the Settlements. */
export type PairLedger = {
  contributions: { fromId: string; toId: string; cents: number; at: Date; description?: string }[];
  settlements: { fromId: string; toId: string; cents: number; at: Date }[];
};
/** One debt's current episode: since when, its newest contribution, and what it was for (newest first, lowercased). */
export type Episode = { start: Date; newestAt: Date; descriptions: string[] };
/** The nudges already sent for one pair: each claim's local day and when it was made. */
export type NudgeHistory = { day: string; at: Date }[];
export type NudgeDecision =
  | { due: true; step: number }
  | { due: false; reason: "off" | "opted-out" | "under" | "too-soon" | "waiting" | "sent-today" | "max" };

/* ---------- pure ---------- */

/** Each Expense's Shares owed to its Payers (the same per-Expense pairing pairwise debts use), at the Expense's time. */
export function contributionsOf(
  ledger: { at: Date; description?: string; payers: { memberId: string; cents: number }[]; shares: { memberId: string; cents: number }[] }[],
): PairLedger["contributions"] {
  const out: PairLedger["contributions"] = [];
  for (const e of ledger) {
    const net = new Map<string, number>();
    for (const p of e.payers) net.set(p.memberId, (net.get(p.memberId) ?? 0) + p.cents);
    for (const s of e.shares) net.set(s.memberId, (net.get(s.memberId) ?? 0) - s.cents);
    for (const t of computeSettlePlan([...net].map(([memberId, cents]) => ({ memberId, name: memberId, cents }))))
      out.push({ fromId: t.fromId, toId: t.toId, cents: t.cents, at: e.at, description: e.description });
  }
  return out;
}

/**
 * The debt's current episode (null when it's at the threshold or under): the pair's ledger replayed in time order,
 * from the debtor's side. It starts the last time the debt went over the threshold, or at a later Settlement from the
 * debtor that left it over. `descriptions`: up to two distinct descriptions of the newest contributions that make up
 * what's owed (older ones count as paid first).
 */
export function episodeOf(debt: Pick<Transfer, "fromId" | "toId" | "cents">, ledger: PairLedger, thresholdCents: number): Episode | null {
  if (debt.cents <= thresholdCents) return null;
  const { fromId, toId } = debt;
  const mine = ledger.contributions.filter((c) => c.fromId === fromId && c.toId === toId);
  if (!mine.length) return null;
  const events = [
    ...mine.map((c) => ({ at: c.at, cents: c.cents, settles: false })),
    ...ledger.contributions.filter((c) => c.fromId === toId && c.toId === fromId).map((c) => ({ at: c.at, cents: -c.cents, settles: false })),
    ...ledger.settlements.filter((s) => s.fromId === fromId && s.toId === toId).map((s) => ({ at: s.at, cents: -s.cents, settles: true })),
    ...ledger.settlements.filter((s) => s.fromId === toId && s.toId === fromId).map((s) => ({ at: s.at, cents: s.cents, settles: false })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  let net = 0;
  let start: Date | undefined;
  for (const e of events) {
    const was = net;
    net += e.cents;
    if (net <= thresholdCents) start = undefined;
    else if (was <= thresholdCents || e.settles) start = e.at;
  }
  const newest = [...mine].sort((a, b) => b.at.getTime() - a.at.getTime());
  const descriptions: string[] = [];
  let left = debt.cents;
  for (const c of newest) {
    const d = c.description?.trim().toLowerCase();
    if (d && !descriptions.includes(d) && descriptions.length < 2) descriptions.push(d);
    left -= c.cents;
    if (left <= 0) break;
  }
  // The replay should end over the line like the debt; if edits made it disagree, the oldest contribution starts it.
  return { start: start ?? newest[newest.length - 1].at, newestAt: newest[0].at, descriptions };
}

/**
 * Is a DM due for this debt today, and which one (1 = the episode's first)? The first once the newest contribution
 * is 4 hours old, then every `everyDays` local days after the last, at most `maxNudges`. Nudges sent before the
 * episode started don't count. `today` is the Group's local day.
 */
export function nudgeDue(
  debt: { cents: number; start: Date; newestAt: Date },
  history: NudgeHistory,
  now: Date,
  today: string,
  s: Pick<NudgeSettings, "thresholdCents" | "everyDays" | "enabled"> & { optedOut?: boolean; maxNudges?: number; firstAfterMs?: number },
): NudgeDecision {
  if (!s.enabled) return { due: false, reason: "off" };
  if (s.optedOut) return { due: false, reason: "opted-out" };
  if (debt.cents <= s.thresholdCents) return { due: false, reason: "under" };
  const sent = history.filter((h) => h.at.getTime() >= debt.start.getTime()).sort((a, b) => a.day.localeCompare(b.day));
  if (sent.some((h) => h.day === today)) return { due: false, reason: "sent-today" };
  if (sent.length >= (s.maxNudges ?? MAX_NUDGES)) return { due: false, reason: "max" };
  if (!sent.length) return now.getTime() - debt.newestAt.getTime() >= (s.firstAfterMs ?? FIRST_AFTER_MS) ? { due: true, step: 1 } : { due: false, reason: "too-soon" };
  return daysBetweenDays(sent[sent.length - 1].day, today) >= s.everyDays ? { due: true, step: sent.length + 1 } : { due: false, reason: "waiting" };
}

/** The DM for that step, shorter each time; "for wifi + groceries" when the Expenses are known. */
export function nudgeText(step: number, c: { fromName: string; toName: string; cents: number; descriptions?: string[] }, hasLink: boolean, currency = "USD"): string {
  const amount = `${moneyIn(currency)(c.cents)} to ${c.toName}`;
  if (step <= 1) {
    const first = c.fromName.trim().split(/\s+/)[0] || c.fromName;
    const what = c.descriptions?.length ? ` for ${c.descriptions.slice(0, 2).join(" + ")}` : "";
    return `Hey ${first}, quick one: ${amount}${what}. Whenever you can.`;
  }
  if (step === 2) return hasLink ? `Still ${amount}.` : `Still ${amount}. Say "paid" here once it's done.`;
  return `Friendly nudge: ${amount}.`;
}

/** When the job may send: the Bundle's hour, moved to 08:00 when it's inside quiet hours (22:00-08:00); never when the morning post is off. */
export function nudgeWindow(now: Date, tz: string, nudgeHour: number | null): boolean {
  return bundleWindow(now, tz, nudgeHour === null ? null : daytimeHour(nudgeHour)).open;
}

const wholeIn = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** Stored settings -> NudgeSettings, defaults for anything missing or odd. An old `thresholdDays` (the weekly nudge's age) is the spacing when it's 1-14. */
export function readNudgeSettings(settings: Record<string, unknown> | undefined): NudgeSettings {
  const n = (settings?.nudge ?? {}) as Partial<Record<keyof NudgeSettings | "thresholdDays", unknown>>;
  const every = wholeIn(n.everyDays, 1, 14) ? n.everyDays : wholeIn(n.thresholdDays, 1, 14) ? n.thresholdDays : DEFAULT_NUDGE.everyDays;
  return {
    thresholdCents: wholeIn(n.thresholdCents, 0, 10_000_000) ? (n.thresholdCents as number) : DEFAULT_NUDGE.thresholdCents,
    everyDays: every as number,
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
  if (patch.everyDays !== undefined) {
    if (!wholeIn(patch.everyDays, 1, 14)) throw new Error("Reminders go every 1 to 14 days.");
    out.everyDays = patch.everyDays;
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

/** Admin: the Group's threshold, spacing, and on/off. */
export async function updateNudgeSettings(ctx: Ctx, patch: Partial<NudgeSettings>): Promise<NudgeSettings> {
  await requireAdmin(ctx);
  const clean = validateNudgeSettings(patch);
  const next = { ...(await getNudgeSettings(ctx)), ...clean };
  const settings = { ...((await moneySettings(ctx.groupId)) ?? {}), nudge: next };
  await db
    .insert(groupToolkits)
    .values({ groupId: ctx.groupId, toolkit: splitting.id, enabled: true, settings })
    .onConflictDoUpdate({ target: [groupToolkits.groupId, groupToolkits.toolkit], set: { settings } });
  const every = next.everyDays === 1 ? "every day" : `every ${next.everyDays} days`;
  const what = next.enabled ? `set the settle nudge to over ${moneyIn(await currencyOf(ctx.groupId))(next.thresholdCents)}, ${every}` : "turned the settle nudge off";
  await recordFor(ctx, "group.settings", what, { table: "groups", id: ctx.groupId });
  return next;
}

/** The Group's ledger with times (live Expenses, not variable parents; every Settlement). */
async function pairLedger(groupId: string): Promise<PairLedger> {
  const live = and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt), eq(expenses.variable, false));
  const [rows, payers, shares, paid] = await Promise.all([
    db.select({ id: expenses.id, at: expenses.createdAt, description: expenses.description }).from(expenses).where(live),
    db.select({ expenseId: expensePayers.expenseId, memberId: expensePayers.memberId, cents: expensePayers.cents }).from(expensePayers).innerJoin(expenses, eq(expensePayers.expenseId, expenses.id)).where(live),
    db.select({ expenseId: expenseSplits.expenseId, memberId: expenseSplits.memberId, cents: expenseSplits.cents }).from(expenseSplits).innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id)).where(live),
    db.select({ fromId: settlements.fromId, toId: settlements.toId, cents: settlements.cents, at: settlements.createdAt }).from(settlements).where(eq(settlements.groupId, groupId)),
  ]);
  const by = new Map(rows.map((r) => [r.id, { at: r.at, description: r.description, payers: [] as { memberId: string; cents: number }[], shares: [] as { memberId: string; cents: number }[] }]));
  for (const p of payers) by.get(p.expenseId)?.payers.push(p);
  for (const s of shares) by.get(s.expenseId)?.shares.push(s);
  return { contributions: contributionsOf([...by.values()]), settlements: paid };
}

/** The nudges sent so far, by pair ("<from>:<to>"), from the claims. Old weekly claims (period = a day) are ignored. */
async function nudgeHistory(groupId: string): Promise<Map<string, NudgeHistory>> {
  const rows = await db
    .select({ period: scheduledPosts.period, at: scheduledPosts.createdAt })
    .from(scheduledPosts)
    .where(and(eq(scheduledPosts.groupId, groupId), eq(scheduledPosts.kind, KIND)));
  const out = new Map<string, NudgeHistory>();
  for (const r of rows) {
    const [day, fromId, toId] = r.period.split(":");
    if (!fromId || !toId) continue;
    const key = `${fromId}:${toId}`;
    out.set(key, [...(out.get(key) ?? []), { day, at: r.at }]);
  }
  return out;
}

/** Members who turned their nudges off. */
async function optedOut(memberIds: string[]): Promise<Set<string>> {
  if (!memberIds.length) return new Set();
  const rows = await db.select({ id: memberNotes.memberId, note: memberNotes.note }).from(memberNotes).where(inArray(memberNotes.memberId, memberIds));
  return new Set(rows.filter((r) => r.note?.nudges === "off").map((r) => r.id));
}

/** A DM that's due now, with the claim period it goes out under. */
export type SettleNudgeDm = RentDm & { period: string; step: number; toId: string };

/** Debts over the Group's line whose debtor hasn't opted out (the report's "I'm nudging people privately"). */
export async function nudgeableDebts(ctx: GroupCtx): Promise<Transfer[]> {
  const settings = await getNudgeSettings(ctx);
  if (!settings.enabled) return [];
  const debts = (await pairwiseDebts(ctx)).filter((d) => d.cents > settings.thresholdCents);
  const off = await optedOut([...new Set(debts.map((d) => d.fromId))]);
  return debts.filter((d) => !off.has(d.fromId));
}

/** The DMs due right now under the Group's settings (none when it's off), pay links to each payee's handles. */
export async function settleNudgeDms(ctx: GroupCtx, now = new Date()): Promise<SettleNudgeDm[]> {
  const settings = await getNudgeSettings(ctx);
  if (!settings.enabled) return [];
  const [debts, ledger, history, people, currency, tz] = await Promise.all([
    pairwiseDebts(ctx),
    pairLedger(ctx.groupId),
    nudgeHistory(ctx.groupId),
    listMembersWithHandles(ctx),
    currencyOf(ctx.groupId),
    groupTimezone(ctx.groupId),
  ]);
  const off = await optedOut([...new Set(debts.map((d) => d.fromId))]);
  const today = dayInZone(tz, now);
  const handlesOf = new Map(people.map((p) => [p.id, p.handles]));
  const out: SettleNudgeDm[] = [];
  for (const d of debts) {
    const ep = episodeOf(d, ledger, settings.thresholdCents);
    if (!ep) continue;
    const due = nudgeDue({ cents: d.cents, start: ep.start, newestAt: ep.newestAt }, history.get(`${d.fromId}:${d.toId}`) ?? [], now, today, { ...settings, optedOut: off.has(d.fromId) });
    if (!due.due) continue;
    const buttons = payLinks(handlesOf.get(d.toId) ?? {}, d.cents, { to: d.toName });
    const text = nudgeText(due.step, { fromName: d.fromName, toName: d.toName, cents: d.cents, descriptions: ep.descriptions }, buttons.length > 0, currency);
    out.push({ memberId: d.fromId, toId: d.toId, cents: d.cents, text, buttons, step: due.step, period: `${today}:${d.fromId}:${d.toId}` });
  }
  return out;
}

/**
 * The Settle nudge, daily: only in the Bundle's hour (clamped out of quiet hours like the Bundle), from Money's
 * bundle() (Home's Today calls bundle() too, which is why the hour is checked here). Each due DM claims
 * scheduled_posts "nudge.settle" for "<day>:<from>:<to>" before it goes; a failed send gives its claim back. Returns
 * what happened to each DM (none when it wasn't time). `opts.dms` is for tests.
 */
export async function settleNudgeJob(ctx: GroupCtx, now = new Date(), opts: { dms?: typeof settleNudgeDms } = {}): Promise<DmOutcome[]> {
  const [tz, sched, settings] = await Promise.all([groupTimezone(ctx.groupId), getSchedule(ctx), getNudgeSettings(ctx)]);
  if (!settings.enabled) return [];
  if (!nudgeWindow(now, tz, sched.nudgeHour) || !(await mayPost(ctx.groupId))) return [];
  const out: DmOutcome[] = [];
  for (const dm of await (opts.dms ?? settleNudgeDms)(ctx, now)) {
    if (!(await claimPost(ctx.groupId, KIND, dm.period))) continue;
    let sent: DmOutcome[];
    try {
      sent = await sendDms(ctx.groupId, [dm], now);
    } catch (e) {
      await releasePost(ctx.groupId, KIND, dm.period).catch(() => {});
      throw e;
    }
    // A send that failed gives the day's claim back, so the next tick in the hour tries again.
    if (sent.some((s) => s.outcome === "failed")) await releasePost(ctx.groupId, KIND, dm.period).catch(() => {});
    out.push(...sent);
  }
  return out;
}
