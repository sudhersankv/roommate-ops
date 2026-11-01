// The House Trick as one thing (ADR 0015): the chore chart (chores.ts) and upkeep (upkeep.ts) together. What House
// says on its own: its line in the morning Bundle (the chores nudge, only when something is due or late, and upkeep
// coming up with whoever's turn it is: upkeepBundleText) and its
// sections of the weekly Group Report; and what a Group starts with when it's taught (the three starter chores and
// the usual five upkeep items, once). The text builders are pure (house.test.ts).
import { and, eq, gt, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { daytimeHour, inQuietHours } from "@/lib/quiet-hours";
import { dayInZone, zonedParts } from "@/lib/time";
import { addStarterChores, bestStreaks, choresDue, choreStatus, hallOfShame, nudgePlans, rhythmMismatches, rhythmOfferText, type ChoreStatus, type ShameRow } from "./chores";
import { listMembers } from "./members";
import { canNudge } from "./nudges";
import { mayPost, sendDms, type DmOutcome } from "./rent";
import { claimPost, getSchedule, groupTimezone, releasePost, weeklyReportWindow } from "./schedule";
import { dueWord, joinNames, type ReportPart } from "./report";
import type { Ctx, GroupCtx } from "./types";
import { addDefaults, dueMaintenance, isQuickUpkeep, listMaintenance, upkeepLabel, type MaintenanceItem } from "./upkeep";

/* ---------- pure ---------- */

type DueChore = Pick<ChoreStatus, "name" | "whoseTurn" | "dueIn" | "dueDay">;
type Streak = { name: string; streak: number; chore: string };

/**
 * The daily "chores due today" line, or null when nothing is due or late (then House has nothing to say). Names
 * whose turn it is; at most four chores.
 */
export function choresNudgeText(due: readonly DueChore[]): string | null {
  if (!due.length) return null;
  const list = due.slice(0, 4).map((c) => {
    const notes = [c.whoseTurn, c.dueIn < 0 ? dueWord(c.dueIn, c.dueDay) : null].filter(Boolean);
    return `${c.name.toLowerCase()}${notes.length ? ` (${notes.join(", ")})` : ""}`;
  });
  const more = due.length > 4 ? ` +${due.length - 4} more` : "";
  return `🧹 On the chart today: ${joinNames(list)}${more}. Tell me when it's done.`;
}

/** The chart this week: done counts, the best streak, what's up now, who's catching up. Nothing when the chart is empty. */
export function choresReportParts(chores: readonly ChoreStatus[], shame: readonly ShameRow[], streaks: readonly Streak[]): ReportPart[] {
  if (!chores.length) return [];
  const parts: ReportPart[] = [];
  const counts = [...shame].sort((a, b) => b.choresThisWeek - a.choresThisWeek || a.name.localeCompare(b.name));
  if (counts.length) parts.push({ icon: "🧹", text: `Chores this week: ${counts.map((s) => `${s.name} ${s.choresThisWeek}`).join(", ")}.` });
  const top = streaks[0];
  if (top && top.streak >= 2) parts.push({ icon: "🔥", text: `${top.name}'s on a ${top.streak}-turn streak (${top.chore.toLowerCase()}).` });
  const due = chores.filter((c) => c.state !== "ok");
  if (due.length === 0) parts.push({ icon: "✅", text: "Nothing due on the chart." });
  else {
    const list = due.slice(0, 3).map((c) => `${c.name} (${c.whoseTurn ? `${c.whoseTurn}, ` : ""}${dueWord(c.dueIn, c.dueDay)})`);
    parts.push({ icon: "⏳", text: `Up now: ${list.join(", ")}${due.length > 3 ? `, +${due.length - 3} more` : ""}.` });
  }
  const slackers = shame.filter((s) => s.choresThisWeek === 0);
  if (slackers.length && slackers.length < shame.length) {
    parts.push({ icon: "📉", text: `The chart says ${joinNames(slackers.slice(0, 2).map((s) => s.name))} ${slackers.length === 1 ? "has" : "have"} some catching up to do.` });
  }
  return parts;
}

/** Upkeep due soon or late, at most three named, each with whoever's up. Nothing when the house is fine. */
export function upkeepReportParts(due: readonly (Pick<MaintenanceItem, "item" | "dueIn" | "dueDay"> & { whoseTurn?: string | null })[]): ReportPart[] {
  if (!due.length) return [];
  const list = due.slice(0, 3).map((m) => `${upkeepLabel(m.item)} (${m.whoseTurn ? `${firstName(m.whoseTurn)}, ` : ""}${dueWord(m.dueIn, m.dueDay)})`);
  return [{ icon: "🔧", text: `Upkeep due soon: ${list.join(", ")}${due.length > 3 ? `, +${due.length - 3} more` : ""}.` }];
}

type BundleUpkeep = Pick<MaintenanceItem, "item" | "dueIn" | "dueDay" | "lastDone"> & { whoseTurn: string | null };

/** At most this many upkeep items in one morning's Bundle. */
const BUNDLE_UPKEEP_MAX = 2;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Which upkeep items the morning Bundle mentions: one that has been done before, two local days ahead ("due Sunday"),
 * on the day, and once a week while it's late. Never-done items (the usual five on day one) stay in the weekly report,
 * or the Bundle would list them every morning.
 */
export function upkeepForBundle<T extends Pick<MaintenanceItem, "dueIn" | "lastDone">>(items: readonly T[]): T[] {
  return items.filter((m) => m.lastDone && (m.dueIn === 2 || m.dueIn === 0 || (m.dueIn < 0 && -m.dueIn % 7 === 0)));
}

/** "today", "tomorrow", else the weekday ("Sunday"). */
function whenWord(dueIn: number, dueDay: string): string {
  if (dueIn === 0) return "today";
  if (dueIn === 1) return "tomorrow";
  return WEEKDAYS[new Date(`${dueDay}T12:00:00Z`).getUTCDay()];
}

/** "a week", "2 weeks", "3 days". */
const lateBy = (days: number) => (days % 7 === 0 ? (days === 7 ? "a week" : `${days / 7} weeks`) : days === 1 ? "a day" : `${days} days`);

/** A small stable pick per item and due day, so the same morning reads the same and the next item differs. */
const pick = (seed: string, n: number) => [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % n;

/** One sentence per item, varied: "Air filter's due Sunday. Dev, you're up." / "Smoke alarm test Saturday. Takes a minute, Sam." */
export function upkeepSentence(m: BundleUpkeep, variant: number): string {
  const label = upkeepLabel(m.item);
  const who = m.whoseTurn ? firstName(m.whoseTurn) : null;
  if (m.dueIn < 0) {
    const late = lateBy(-m.dueIn);
    if (!who) return `${label}'s ${late} late.`;
    return [`${label}'s ${late} late. ${who}, you're up.`, `${who}, ${lowerFirst(label)} is ${late} late; it's yours.`][variant % 2];
  }
  const when = whenWord(m.dueIn, m.dueDay);
  if (!who) return `${label}'s due ${when}.`;
  if (isQuickUpkeep(m.item)) return [`${label} ${when}. Takes a minute, ${who}.`, `${label} ${when}, ${who}. Takes a minute.`][variant % 2];
  return [`${label}'s due ${when}. ${who}, you're up.`, `${label} ${when}. ${who}'s turn.`, `${who}, ${lowerFirst(label)}'s on you ${when}.`][variant % 3];
}

/** House's upkeep sentences for the morning Bundle, or null when nothing's worth a mention today. */
export function upkeepBundleText(items: readonly BundleUpkeep[]): string | null {
  const due = upkeepForBundle(items);
  if (!due.length) return null;
  // The next item takes the next wording, so two in one morning never open the same way.
  const base = pick(`${due[0].item}:${due[0].dueDay}`, 6);
  const out = due.slice(0, BUNDLE_UPKEEP_MAX).map((m, i) => upkeepSentence(m, base + i));
  if (due.length > BUNDLE_UPKEEP_MAX) out.push(`${due.length - BUNDLE_UPKEEP_MAX} more upkeep on the list.`);
  return out.join(" ");
}

/* ---------- DB ---------- */

/**
 * House's line in the morning Bundle: the chores due or late that nobody hears about privately. A chore with a history
 * whose turn is on a Member Roomie can DM is theirs (choreDmJob); a never-done chore, or a Member with nudges off or
 * no DM path yet (Telegram before Start), stays on the group line. Null when that leaves nothing.
 */
export async function houseBundleLine(ctx: GroupCtx, now = new Date()): Promise<string | null> {
  const [due, upkeep] = await Promise.all([choresDue(ctx, now), listMaintenance(ctx, now)]);
  const reach = new Map<string, Promise<boolean>>();
  const privately = (id: string) => reach.get(id) ?? (reach.set(id, canNudge(id)), reach.get(id)!);
  const kept: typeof due = [];
  for (const c of due) if (!c.lastDoneAt || !c.whoseTurnId || !(await privately(c.whoseTurnId))) kept.push(c);
  const lines = [choresNudgeText(kept), upkeepBundleText(upkeep)].filter((l): l is string => !!l);
  return lines.length ? lines.join("\n") : null;
}

/** Groups with nothing left to DM in this local hour (an in-process shortcut: the scheduler asks every minute). */
const quietUntil = new Map<string, string>();

/**
 * The chore nudges (#60): each due or late chore's DM to whoever's turn it is (choreNudgePlan), once the local hour
 * reaches the chore's usual hour. House's tick() runs it every scheduler minute. Claimed as scheduled_posts "chore.dm"
 * with period "<day>:<choreId>:<memberId>"; sent through sendDms (sendNudge: quiet hours, "stop nudging me", a paused
 * Group; no DM path -> the neutral Start hint, at most weekly). Nothing while the nudge hour is off (null).
 */
export async function choreDmJob(ctx: GroupCtx, now = new Date()): Promise<DmOutcome[]> {
  const [tz, sched] = await Promise.all([groupTimezone(ctx.groupId), getSchedule(ctx)]);
  if (sched.nudgeHour === null || inQuietHours(now, tz)) return [];
  const day = dayInZone(tz, now);
  const slot = `${day}:${zonedParts(tz, now).hour}`;
  if (quietUntil.get(ctx.groupId) === slot) return [];
  const hour = zonedParts(tz, now).hour;
  const ready = (await nudgePlans(ctx, now, daytimeHour(sched.nudgeHour))).filter((p) => hour >= p.hour);
  if (!ready.length || !(await mayPost(ctx.groupId))) {
    quietUntil.set(ctx.groupId, slot);
    return [];
  }
  const out: DmOutcome[] = [];
  for (const p of ready) {
    const period = `${day}:${p.choreId}:${p.memberId}`;
    if (!(await claimPost(ctx.groupId, "chore.dm", period))) continue;
    const [r] = await sendDms(ctx.groupId, [{ memberId: p.memberId, text: p.text, buttons: [] }], now);
    if (r?.outcome === "failed") await releasePost(ctx.groupId, "chore.dm", period).catch(() => {});
    if (r) out.push(r);
  }
  if (!out.some((r) => r.outcome === "failed")) quietUntil.set(ctx.groupId, slot);
  return out;
}

/** A rhythm offer per chore at most once in this long. */
const RHYTHM_OFFER_DAYS = 30;

/**
 * The report's rhythm offer (#61): the first chore whose real rhythm differs from the chart ("Trash actually goes out
 * every 3 days. Want me to change it?"), only in the weekly report's own hour (group_report at other times doesn't
 * spend it), at most once per chore per 30 days (scheduled_posts "chore.rhythm", period "<choreId>:<day>"). A yes is
 * chore_update (House's skill).
 */
export async function rhythmOfferParts(ctx: GroupCtx, now = new Date()): Promise<ReportPart[]> {
  const [tz, sched] = await Promise.all([groupTimezone(ctx.groupId), getSchedule(ctx)]);
  if (!weeklyReportWindow(now, tz, sched.reportWeekday, sched.reportHour).open) return [];
  const since = new Date(now.getTime() - RHYTHM_OFFER_DAYS * 24 * 3600_000);
  const day = dayInZone(tz, now);
  for (const m of await rhythmMismatches(ctx)) {
    const recent = await db
      .select({ period: schema.scheduledPosts.period })
      .from(schema.scheduledPosts)
      .where(and(eq(schema.scheduledPosts.groupId, ctx.groupId), eq(schema.scheduledPosts.kind, "chore.rhythm"), like(schema.scheduledPosts.period, `${m.choreId}:%`), gt(schema.scheduledPosts.createdAt, since)))
      .limit(1);
    if (recent.length) continue;
    if (await claimPost(ctx.groupId, "chore.rhythm", `${m.choreId}:${day}`)) return [{ icon: "📅", text: rhythmOfferText(m.name, m.observed) }];
  }
  return [];
}

/** House's sections of the weekly Group Report: the chart, the rhythm offer, then upkeep. */
export async function houseReportParts(ctx: GroupCtx, now = new Date()): Promise<ReportPart[]> {
  const [chores, shame, people, upkeep] = await Promise.all([choreStatus(ctx, now), hallOfShame(ctx, now), listMembers(ctx), dueMaintenance(ctx, now)]);
  const streaks = bestStreaks(chores, people.map((p) => ({ id: p.id, name: p.displayName })));
  const offer = await rhythmOfferParts(ctx, now).catch((e) => (console.error("[house] rhythm offer failed", e), []));
  return [...choresReportParts(chores, shame, streaks), ...offer, ...upkeepReportParts(upkeep)];
}

/**
 * House's onEnable: the three starter chores (only on an empty chart) and the usual five upkeep items (only the ones
 * not tracked yet). Teaching it twice adds nothing. Returns how many of each went in.
 */
export async function startHouse(ctx: Ctx): Promise<{ chores: number; upkeep: number }> {
  return { chores: await addStarterChores(ctx), upkeep: await addDefaults(ctx) };
}
