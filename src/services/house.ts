// The House Trick as one thing (ADR 0015): the chore chart (chores.ts) and upkeep (upkeep.ts) together. What House
// says on its own: its line in the morning Bundle (the chores nudge, only when something is due or late) and its
// sections of the weekly Group Report; and what a Group starts with when it's taught (the three starter chores and
// the usual five upkeep items, once). The text builders are pure (house.test.ts).
import { addStarterChores, bestStreaks, choresDue, choreStatus, hallOfShame, type ChoreStatus, type ShameRow } from "./chores";
import { listMembers } from "./members";
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

/** House's line in the morning Bundle. */
export async function houseBundleLine(ctx: GroupCtx, now = new Date()): Promise<string | null> {
  return choresNudgeText(await choresDue(ctx, now));
}

/** House's sections of the weekly Group Report: the chart, then upkeep. */
export async function houseReportParts(ctx: GroupCtx, now = new Date()): Promise<ReportPart[]> {
  const [chores, shame, people, upkeep] = await Promise.all([choreStatus(ctx, now), hallOfShame(ctx, now), listMembers(ctx), dueMaintenance(ctx, now)]);
  const streaks = bestStreaks(chores, people.map((p) => ({ id: p.id, name: p.displayName })));
  return [...choresReportParts(chores, shame, streaks), ...upkeepReportParts(upkeep)];
}

/**
 * House's onEnable: the three starter chores (only on an empty chart) and the usual five upkeep items (only the ones
 * not tracked yet). Teaching it twice adds nothing. Returns how many of each went in.
 */
export async function startHouse(ctx: Ctx): Promise<{ chores: number; upkeep: number }> {
  return { chores: await addStarterChores(ctx), upkeep: await addDefaults(ctx) };
}
