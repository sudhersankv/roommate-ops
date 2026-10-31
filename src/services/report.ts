// The Group Report: the weekly post (jobs/scheduler.ts, at the Group's report day and hour) and group_report on
// demand print the same text. One message, about a dozen lines at most, composed from parts: each enabled Toolkit's
// `report()` sections (the manifest contract, ADR 0017: Money's Settle plan, House's chores and upkeep, the Cart's
// size), in post order, then core's own line (the next week's whole-group Reminders). Core never names a Toolkit.
// composeReport / formatGroupReport are pure (report.test.ts).
import { dayInZone, formatInZone } from "@/lib/time";
import { getGroup } from "./groups";
import { listReminders, type Reminder } from "./reminders";
import { DEFAULT_TIMEZONE } from "./schedule";
import { enabledToolkitEntries } from "./toolkits";
import type { GroupCtx } from "./types";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** One section of the report: an emoji and a sentence. */
export type ReportPart = { icon: string; text: string };

export type GroupReport = { groupName: string | null; tz: string; now: Date; parts: ReportPart[] };

export async function groupReport(ctx: GroupCtx, now = new Date()): Promise<GroupReport> {
  const [group, upcoming, toolkits] = await Promise.all([getGroup(ctx.groupId), listReminders(ctx, { groupOnly: true }), enabledToolkitEntries(ctx)]);
  const tz = group?.timezone ?? DEFAULT_TIMEZONE;
  const sections = await Promise.all(toolkits.map((t) => t.report?.(ctx, now) ?? Promise.resolve([])));
  return { groupName: group?.name ?? null, tz, now, parts: composeReport(sections, coreReportParts(upcoming, tz, now)) };
}

/* ---------- pure ---------- */

/** "Maya", "Maya and Dev", "Maya, Dev and Sam". */
export const joinNames = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** "today", "tomorrow", "Thu", "2 days late" from days-until. */
export function dueWord(dueIn: number, dueDay: string): string {
  if (dueIn < 0) return `${-dueIn} day${dueIn === -1 ? "" : "s"} late`;
  if (dueIn === 0) return "today";
  if (dueIn === 1) return "tomorrow";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${dueDay}T12:00:00Z`));
}

/** The Toolkits' sections in the order given (post order), then core's. */
export function composeReport(sections: readonly ReportPart[][], core: readonly ReportPart[] = []): ReportPart[] {
  return [...sections.flat(), ...core];
}

/** Core's line: the next week's whole-group Reminders, at most three. */
export function coreReportParts(upcoming: Pick<Reminder, "text" | "dueAt">[], tz: string, now: Date): ReportPart[] {
  const soon = upcoming.filter((r) => r.dueAt.getTime() - now.getTime() <= WEEK_MS).slice(0, 3);
  if (!soon.length) return [];
  const list = soon.map((u) => `${u.text} (${formatInZone(u.dueAt, tz, { weekday: "short", hour: "numeric", minute: "2-digit" }).replace(":00", "")})`);
  return [{ icon: "⏰", text: `Coming up: ${list.join(", ")}.` }];
}

/**
 * Plain text for the Chat. One line per section with an emoji in front; when the Group style says the chat is casual,
 * no list look at all: the same sentences run together in two short lines. Pure and deterministic.
 */
export function formatGroupReport(r: GroupReport, opts: { casual?: boolean } = {}): string {
  const title = `Group report${r.groupName ? ` · ${r.groupName}` : ""}`;
  if (opts.casual) {
    const half = Math.ceil(r.parts.length / 2);
    const sentence = (p: ReportPart[]) => p.map((x) => x.text).join(" ");
    return [`${title}:`, sentence(r.parts.slice(0, half)), sentence(r.parts.slice(half))].filter(Boolean).join("\n");
  }
  return [`📋 ${title}`, ...r.parts.map((p) => `${p.icon} ${p.text}`)].join("\n");
}

/** The report's local day for idempotency ("2026-11-01"). */
export const reportPeriod = (r: Pick<GroupReport, "tz" | "now">) => dayInZone(r.tz, r.now);
