// The Group Report: the weekly post (jobs/scheduler.ts, at the Group's report day and hour) and group_report on
// demand print the same text. One message, about a dozen lines at most: who owes whom (the Settle plan), chores this
// week (done counts, the best streak, what's due, the chart), upkeep due soon, the Cart's size and what's coming up.
// Sections of switched-off Toolkits are left out. formatGroupReport is pure (report.test.ts).
import { dayInZone, formatInZone } from "@/lib/time";
import { listOpenItems } from "./cart";
import { bestStreaks, choreStatus, hallOfShame } from "./chores";
import { enabledToolkits, getGroup } from "./groups";
import { listMembers } from "./members";
import { getSettlePlan } from "./money";
import { listReminders } from "./reminders";
import { DEFAULT_TIMEZONE } from "./schedule";
import { dollars, type GroupCtx } from "./types";
import { dueMaintenance } from "./upkeep";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export async function groupReport(ctx: GroupCtx, now = new Date()) {
  const [group, toolkits, settlePlan, chores, shame, upcoming, upkeep, cart, people] = await Promise.all([
    getGroup(ctx.groupId),
    enabledToolkits(ctx),
    getSettlePlan(ctx),
    choreStatus(ctx, now),
    hallOfShame(ctx, now),
    listReminders(ctx, { groupOnly: true }),
    dueMaintenance(ctx, now),
    listOpenItems(ctx),
    listMembers(ctx),
  ]);
  return {
    groupName: group?.name ?? null,
    tz: group?.timezone ?? DEFAULT_TIMEZONE,
    now,
    toolkits,
    settlePlan,
    chores,
    shame,
    streaks: bestStreaks(chores, people.map((p) => ({ id: p.id, name: p.displayName }))),
    upcoming: upcoming.filter((r) => r.dueAt.getTime() - now.getTime() <= WEEK_MS).slice(0, 3),
    upkeep,
    cartCount: cart.length,
  };
}

export type GroupReport = Awaited<ReturnType<typeof groupReport>>;

/* ---------- pure formatting ---------- */

const joinNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** "today", "tomorrow", "Thu", "2 days late" from days-until. */
export function dueWord(dueIn: number, dueDay: string): string {
  if (dueIn < 0) return `${-dueIn} day${dueIn === -1 ? "" : "s"} late`;
  if (dueIn === 0) return "today";
  if (dueIn === 1) return "tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${dueDay}T12:00:00Z`));
}

type Part = { icon: string; text: string };

/** The report's sections, in order. */
export function reportParts(r: GroupReport): Part[] {
  const on = (t: string) => r.toolkits.includes(t as GroupReport["toolkits"][number]);
  const parts: Part[] = [];

  if (on("splitting")) {
    if (r.settlePlan.length === 0) parts.push({ icon: "💸", text: "All square. Love that for us." });
    else {
      const shown = r.settlePlan.slice(0, 3).map((t) => `${t.fromName} pays ${t.toName} ${dollars(t.cents)}`);
      const more = r.settlePlan.length - shown.length;
      parts.push({ icon: "💸", text: `${joinNames(shown)}${more > 0 ? `, +${more} more` : ""}.` });
    }
  }

  if (on("chores") && r.chores.length) {
    const counts = [...r.shame].sort((a, b) => b.choresThisWeek - a.choresThisWeek || a.name.localeCompare(b.name));
    if (counts.length) parts.push({ icon: "🧹", text: `Chores this week: ${counts.map((s) => `${s.name} ${s.choresThisWeek}`).join(", ")}.` });
    const top = r.streaks[0];
    if (top && top.streak >= 2) parts.push({ icon: "🔥", text: `${top.name}'s on a ${top.streak}-turn streak (${top.chore.toLowerCase()}).` });
    const due = r.chores.filter((c) => c.state !== "ok");
    if (due.length === 0) parts.push({ icon: "✅", text: "Nothing due on the chart." });
    else {
      const list = due.slice(0, 3).map((c) => `${c.name} (${c.whoseTurn ? `${c.whoseTurn}, ` : ""}${dueWord(c.dueIn, c.dueDay)})`);
      parts.push({ icon: "⏳", text: `Up now: ${list.join(", ")}${due.length > 3 ? `, +${due.length - 3} more` : ""}.` });
    }
    const slackers = r.shame.filter((s) => s.choresThisWeek === 0);
    if (slackers.length && slackers.length < r.shame.length) {
      parts.push({ icon: "📉", text: `The chart says ${joinNames(slackers.slice(0, 2).map((s) => s.name))} ${slackers.length === 1 ? "has" : "have"} some catching up to do.` });
    }
  }

  if (on("upkeep") && r.upkeep.length) {
    const list = r.upkeep.slice(0, 3).map((m) => `${m.item} (${dueWord(m.dueIn, m.dueDay)})`);
    parts.push({ icon: "🔧", text: `Upkeep due soon: ${list.join(", ")}${r.upkeep.length > 3 ? `, +${r.upkeep.length - 3} more` : ""}.` });
  }

  if (on("groceries")) parts.push({ icon: "🛒", text: r.cartCount ? `${r.cartCount} thing${r.cartCount === 1 ? "" : "s"} in the Cart.` : "The Cart's empty." });

  if (r.upcoming.length) {
    const list = r.upcoming.map((u) => `${u.text} (${formatInZone(u.dueAt, r.tz, { weekday: "short", hour: "numeric", minute: "2-digit" }).replace(":00", "")})`);
    parts.push({ icon: "⏰", text: `Coming up: ${list.join(", ")}.` });
  }
  return parts;
}

/**
 * Plain text for the Chat. One line per section with an emoji in front; when the Group style says the chat is casual,
 * no list look at all: the same sentences run together in two short lines. Pure and deterministic.
 */
export function formatGroupReport(r: GroupReport, opts: { casual?: boolean } = {}): string {
  const parts = reportParts(r);
  const title = `Group report${r.groupName ? ` · ${r.groupName}` : ""}`;
  if (opts.casual) {
    const half = Math.ceil(parts.length / 2);
    const sentence = (p: Part[]) => p.map((x) => x.text).join(" ");
    return [`${title}:`, sentence(parts.slice(0, half)), sentence(parts.slice(half))].filter(Boolean).join("\n");
  }
  return [`📋 ${title}`, ...parts.map((p) => `${p.icon} ${p.text}`)].join("\n");
}

/** The report's local day for idempotency ("2026-11-01"). */
export const reportPeriod = (r: Pick<GroupReport, "tz" | "now">) => dayInZone(r.tz, r.now);

/* ---------- the chores nudge ---------- */

/**
 * The daily "chores due today" line, or null when nothing is due or late (then nothing is posted). Names whose turn
 * it is; at most four chores.
 */
export function choresNudgeText(due: Pick<GroupReport["chores"][number], "name" | "whoseTurn" | "dueIn" | "dueDay">[]): string | null {
  if (!due.length) return null;
  const list = due.slice(0, 4).map((c) => {
    const notes = [c.whoseTurn, c.dueIn < 0 ? dueWord(c.dueIn, c.dueDay) : null].filter(Boolean);
    return `${c.name.toLowerCase()}${notes.length ? ` (${notes.join(", ")})` : ""}`;
  });
  const more = due.length > 4 ? ` +${due.length - 4} more` : "";
  return `🧹 On the chart today: ${joinNames(list)}${more}. Tell me when it's done.`;
}
