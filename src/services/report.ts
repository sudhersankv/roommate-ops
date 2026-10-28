// P3 · Sudhersan. The Group Report: chat tool, home page cards, and the weekly scheduled post all use this.
// formatGroupReport / shouldPostWeeklyReport are pure (no DB, no randomness) so report.test.ts can run them.
import { dollars, type GroupCtx } from "./types";
import { getBalances, getSettlePlan } from "./money";
import { choreStatus, hallOfShame } from "./chores";
import { listReminders } from "./reminders";
import { dueMaintenance } from "./upkeep";

export async function groupReport(ctx: GroupCtx) {
  const [balances, settlePlan, chores, shame, upcoming, upkeep] = await Promise.all([
    getBalances(ctx),
    getSettlePlan(ctx),
    choreStatus(ctx),
    hallOfShame(ctx),
    listReminders(ctx),
    dueMaintenance(ctx),
  ]);
  return { balances, settlePlan, chores, shame, upcoming: upcoming.slice(0, 5), upkeep };
}

export type GroupReport = Awaited<ReturnType<typeof groupReport>>;

export const DEFAULT_TZ = "America/Chicago";

/* ---------- pure formatting ---------- */

/** "Fri Oct 10" in the Group's time zone. */
export function shortDate(d: Date, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: tz }).format(d).replace(",", "");
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/** A light jab for whoever tops the Hall of Shame. Deterministic: picked from the row, never random. */
export function shameJab(top: GroupReport["shame"][number]): string {
  if (top.daysSinceLastChore == null) return "hasn't logged a chore yet. Bold strategy 😅";
  if (top.daysSinceLastChore >= 14) return `${top.daysSinceLastChore} days since a chore. The dust has opinions now 😭`;
  if (top.daysSinceLastChore >= 7) return `${top.daysSinceLastChore} days since a chore 👀`;
  if (top.choresThisWeek === 0) return `${top.daysSinceLastChore}d ago, 0 this week.`;
  return `${top.choresThisWeek} this week, the fewest in the group.`;
}

/**
 * Plain-text Group Report for chat. Header + who pays whom (or "All square."),
 * overdue chores with whose turn, who's behind on chores (Hall of Shame top 1–2 with a jab), next 3 reminders, overdue upkeep.
 * Stays around a dozen lines. Pure and deterministic.
 */
export function formatGroupReport(r: GroupReport, opts: { groupName?: string; tz?: string } = {}): string {
  const tz = opts.tz ?? DEFAULT_TZ;
  const lines: string[] = [`📣 Group report${opts.groupName ? ` — ${opts.groupName}` : ""}`];

  // Money
  if (r.settlePlan.length === 0) lines.push("💸 All square. Love that for us.");
  else {
    const shown = r.settlePlan.slice(0, 3);
    for (const t of shown) lines.push(`💸 ${t.fromName} pays ${t.toName} ${dollars(t.cents)}`);
    if (r.settlePlan.length > shown.length) lines.push(`💸 …and ${r.settlePlan.length - shown.length} more. Time to settle up.`);
  }

  // Chores
  const overdue = r.chores.filter((c) => c.overdue);
  if (r.chores.length === 0) lines.push("🧹 No chores on the chart yet.");
  else if (overdue.length === 0) lines.push("🧹 Chores on track. Nice.");
  else
    lines.push(
      `🧹 Overdue: ${overdue
        .slice(0, 4)
        .map((c) => (c.whoseTurn ? `${c.name} (${c.whoseTurn}'s turn)` : c.name))
        .join(", ")}${overdue.length > 4 ? ` +${overdue.length - 4} more` : ""}`,
    );

  // Hall of Shame: only worth posting when someone is actually slacking.
  const slackers = r.shame.filter((s) => s.choresThisWeek === 0 || (s.daysSinceLastChore ?? Infinity) >= 7);
  if (slackers.length > 0 && r.chores.length > 0) {
    const top = slackers.slice(0, 2);
    const roll = top.length > 1 ? `${joinNames(top.map((s) => s.name))}. ${top[0].name}` : top[0].name;
    lines.push(`🚨 Behind on chores: ${roll} ${shameJab(top[0])}`);
  }

  // Upcoming
  if (r.upcoming.length === 0) lines.push("⏰ Nothing scheduled. Enjoy the quiet.");
  else
    for (const u of r.upcoming.slice(0, 3))
      lines.push(`⏰ ${shortDate(u.dueAt, tz)}: ${u.text}${u.memberName ? ` (${u.memberName})` : ""}`);

  // Upkeep
  const lateUpkeep = r.upkeep.filter((m) => m.status === "overdue");
  if (lateUpkeep.length > 0) lines.push(`🔧 Overdue upkeep: ${lateUpkeep.map((m) => m.item).join(", ")}`);

  return lines.join("\n");
}

/* ---------- scheduling helpers ---------- */

/** Local weekday ("Sun".."Sat"), hour (0–23) and calendar day ("2026-10-04") of `d` in `tz`. */
export function localParts(d: Date, tz = DEFAULT_TZ): { weekday: string; hour: number; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    weekday: get("weekday"),
    hour: Number(get("hour")) % 24, // some ICU builds print "24" for midnight
    day: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

const HOUR_MS = 60 * 60 * 1000;

/** Weekly post window: Sunday 18:00–18:59 in `tz`, and nothing posted in the last 20 hours. */
export function shouldPostWeeklyReport(now: Date, lastPostedAt: Date | null, tz = DEFAULT_TZ): boolean {
  const { weekday, hour } = localParts(now, tz);
  if (weekday !== "Sun" || hour !== 18) return false;
  return !lastPostedAt || now.getTime() - lastPostedAt.getTime() >= 20 * HOUR_MS;
}

/** Daily nudge window: 09:00–09:59 in `tz`, at most once per local calendar day. */
export function shouldPostUpkeepNudge(now: Date, lastPostedDay: string | null, tz = DEFAULT_TZ): boolean {
  const { hour, day } = localParts(now, tz);
  return hour === 9 && lastPostedDay !== day;
}
