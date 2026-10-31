// The House Trick as one thing (ADR 0015): the chore chart (chores.ts) and upkeep (upkeep.ts) together. What House
// says on its own: its line in the morning Bundle (the chores nudge, only when something is due or late) and its
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
import { addDefaults, dueMaintenance, type MaintenanceItem } from "./upkeep";

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

/** Upkeep due soon or late, at most three named. Nothing when the house is fine. */
export function upkeepReportParts(due: readonly Pick<MaintenanceItem, "item" | "dueIn" | "dueDay">[]): ReportPart[] {
  if (!due.length) return [];
  const list = due.slice(0, 3).map((m) => `${m.item} (${dueWord(m.dueIn, m.dueDay)})`);
  return [{ icon: "🔧", text: `Upkeep due soon: ${list.join(", ")}${due.length > 3 ? `, +${due.length - 3} more` : ""}.` }];
}

/* ---------- DB ---------- */

/**
 * House's line in the morning Bundle: the chores due or late that nobody hears about privately. A chore with a history
 * whose turn is on a Member Roomie can DM is theirs (choreDmJob); a never-done chore, or a Member with nudges off or
 * no DM path yet (Telegram before Start), stays on the group line. Null when that leaves nothing.
 */
export async function houseBundleLine(ctx: GroupCtx, now = new Date()): Promise<string | null> {
  const due = await choresDue(ctx, now);
  const reach = new Map<string, Promise<boolean>>();
  const privately = (id: string) => reach.get(id) ?? (reach.set(id, canNudge(id)), reach.get(id)!);
  const kept: typeof due = [];
  for (const c of due) if (!c.lastDoneAt || !c.whoseTurnId || !(await privately(c.whoseTurnId))) kept.push(c);
  return choresNudgeText(kept);
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
