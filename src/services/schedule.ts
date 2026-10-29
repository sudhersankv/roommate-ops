// When Roomie posts on its own: the daily chores nudge (group_toolkits "chores".settings.nudgeHour, default 9 local, null
// = off) and the weekly Group Report (group_toolkits "core".settings.report = { weekday, hour }, default Sunday 18:00
// local). Both are claimed in scheduled_posts before sending, so each goes out at most once per local day / week
// (ADR 0001). The window checks are pure (schedule.test.ts).
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { dayInZone, WEEKDAY_NAMES, zonedParts } from "@/lib/time";
import { record } from "./activity";
import { requireAdmin } from "./authz";
import type { Ctx, GroupCtx } from "./types";

const { groupToolkits, groups, scheduledPosts } = schema;

export const DEFAULT_TIMEZONE = "America/Chicago";
export type Schedule = { nudgeHour: number | null; reportWeekday: number; reportHour: number };
export const DEFAULT_SCHEDULE: Schedule = { nudgeHour: 9, reportWeekday: 0, reportHour: 18 };
export type PostKind = (typeof scheduledPosts.$inferInsert)["kind"];

/* ---------- pure ---------- */

const hourOk = (h: unknown) => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;

/** Throws a message Roomie or the Settings page can show. `nudgeHour: null` switches the nudge off. */
export function validateSchedule(patch: Partial<Schedule>): Partial<Schedule> {
  const out: Partial<Schedule> = {};
  if (patch.nudgeHour !== undefined) {
    if (patch.nudgeHour !== null && !hourOk(patch.nudgeHour)) throw new Error("The nudge hour is 0 to 23 (9 = 9 AM), or off.");
    out.nudgeHour = patch.nudgeHour;
  }
  if (patch.reportWeekday !== undefined) {
    if (!Number.isInteger(patch.reportWeekday) || patch.reportWeekday < 0 || patch.reportWeekday > 6) throw new Error("The report day is 0 (Sunday) to 6 (Saturday).");
    out.reportWeekday = patch.reportWeekday;
  }
  if (patch.reportHour !== undefined) {
    if (!hourOk(patch.reportHour)) throw new Error("The report hour is 0 to 23 (18 = 6 PM).");
    out.reportHour = patch.reportHour;
  }
  return out;
}

/** Stored settings -> a Schedule, defaults for anything missing or odd. */
export function readSchedule(chores: Record<string, unknown> | undefined, core: Record<string, unknown> | undefined): Schedule {
  const nudge = chores?.nudgeHour;
  const report = (core?.report ?? {}) as { weekday?: unknown; hour?: unknown };
  return {
    nudgeHour: nudge === null ? null : hourOk(nudge) ? (nudge as number) : DEFAULT_SCHEDULE.nudgeHour,
    reportWeekday: Number.isInteger(report.weekday) && (report.weekday as number) >= 0 && (report.weekday as number) <= 6 ? (report.weekday as number) : DEFAULT_SCHEDULE.reportWeekday,
    reportHour: hourOk(report.hour) ? (report.hour as number) : DEFAULT_SCHEDULE.reportHour,
  };
}

/** The chores nudge goes out in the nudge hour (local); `period` is the local day it belongs to. */
export function choresNudgeWindow(now: Date, tz: string, nudgeHour: number | null): { open: boolean; period: string } {
  const period = dayInZone(tz, now);
  return { open: nudgeHour !== null && zonedParts(tz, now).hour === nudgeHour, period };
}

/** The weekly report goes out in its hour on its weekday (local); `period` is that local day. */
export function weeklyReportWindow(now: Date, tz: string, weekday: number, hour: number): { open: boolean; period: string } {
  const p = zonedParts(tz, now);
  return { open: p.weekday === weekday && p.hour === hour, period: dayInZone(tz, now) };
}

const hourLabel = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h} AM` : `${h - 12} PM`);
export const describeSchedule = (s: Schedule) => ({
  nudge: s.nudgeHour === null ? "off" : `daily at ${hourLabel(s.nudgeHour)}`,
  report: `${WEEKDAY_NAMES[s.reportWeekday]}s at ${hourLabel(s.reportHour)}`,
});

/* ---------- DB ---------- */

export async function groupTimezone(groupId: string): Promise<string> {
  const [g] = await db.select({ tz: groups.timezone }).from(groups).where(eq(groups.id, groupId));
  return g?.tz ?? DEFAULT_TIMEZONE;
}

async function settingsOf(groupId: string, toolkit: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await db
    .select({ settings: groupToolkits.settings })
    .from(groupToolkits)
    .where(and(eq(groupToolkits.groupId, groupId), eq(groupToolkits.toolkit, toolkit)));
  return row?.settings;
}

export async function getSchedule(ctx: GroupCtx): Promise<Schedule> {
  const [chores, core] = await Promise.all([settingsOf(ctx.groupId, "chores"), settingsOf(ctx.groupId, "core")]);
  return readSchedule(chores, core);
}

async function mergeSettings(groupId: string, toolkit: string, value: Record<string, unknown>) {
  await db
    .insert(groupToolkits)
    .values({ groupId, toolkit, enabled: true, settings: value })
    .onConflictDoUpdate({
      target: [groupToolkits.groupId, groupToolkits.toolkit],
      set: { settings: sql`${groupToolkits.settings} || ${JSON.stringify(value)}::jsonb` },
    });
}

/** Admin: the nudge hour and the report's day and hour. */
export async function updateSchedule(ctx: Ctx, patch: Partial<Schedule>): Promise<Schedule> {
  await requireAdmin(ctx);
  const clean = validateSchedule(patch);
  if (clean.nudgeHour !== undefined) await mergeSettings(ctx.groupId, "chores", { nudgeHour: clean.nudgeHour });
  if (clean.reportWeekday !== undefined || clean.reportHour !== undefined) {
    const now = await getSchedule(ctx);
    await mergeSettings(ctx.groupId, "core", { report: { weekday: clean.reportWeekday ?? now.reportWeekday, hour: clean.reportHour ?? now.reportHour } });
  }
  const next = await getSchedule(ctx);
  const d = describeSchedule(next);
  await record(ctx.groupId, ctx.memberId, "group.settings", `set the chores nudge to ${d.nudge} and the weekly report to ${d.report}`, { table: "groups", id: ctx.groupId });
  return next;
}

/** Claim a scheduled post. False = already posted (or being posted) for that period. */
export async function claimPost(groupId: string, kind: PostKind, period: string): Promise<boolean> {
  const rows = await db.insert(scheduledPosts).values({ groupId, kind, period }).onConflictDoNothing().returning({ period: scheduledPosts.period });
  return rows.length > 0;
}

/** Give a claim back after a failed send, so a later tick in the same window can retry. */
export async function releasePost(groupId: string, kind: PostKind, period: string): Promise<void> {
  await db.delete(scheduledPosts).where(and(eq(scheduledPosts.groupId, groupId), eq(scheduledPosts.kind, kind), eq(scheduledPosts.period, period)));
}
