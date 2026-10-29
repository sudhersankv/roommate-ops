// Reminders: one-off or repeating (daily, weekly, monthly), for the whole Group (posted in the Chat) or for one
// Member (sent to them privately). The scheduler delivers them (jobs/scheduler.ts); repeats keep their wall-clock time
// in the Group's zone across DST.
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, schema } from "@/db";
import type { ReminderRepeat } from "@/db/schema";
import { addDaysInZone, formatInZone, zonedParts, zonedTimeToUtc } from "@/lib/time";
import { record } from "./activity";
import { NotAllowedError, requireActive } from "./authz";
import { groupTimezone } from "./schedule";
import type { Ctx, GroupCtx } from "./types";

const { reminders, members } = schema;
const setter = alias(members, "setter");

export type Reminder = {
  id: string;
  groupId: string;
  text: string;
  dueAt: Date;
  memberId: string | null;
  /** null = for everyone */
  memberName: string | null;
  recurring: ReminderRepeat | null;
  createdBy: string | null;
  createdByName: string | null;
};

const MAX_TEXT = 200;
const PAST_SLACK_MS = 2 * 60_000;

// ---------- pure (reminders.test.ts) ----------

/** The next time a repeating reminder fires after `due`, same wall-clock time in `tz`; monthly clamps the day to 28. */
export function nextAfter(due: Date, repeat: ReminderRepeat, tz: string): Date {
  if (repeat === "daily") return addDaysInZone(tz, due, 1);
  if (repeat === "weekly") return addDaysInZone(tz, due, 7);
  const p = zonedParts(tz, due);
  return zonedTimeToUtc(tz, { year: p.year, month: p.month + 1, day: Math.min(p.day, 28), hour: p.hour, minute: p.minute, second: p.second });
}

/** The first occurrence strictly after `now` (a scheduler that was off for a while doesn't fire a backlog). */
export function nextOccurrence(due: Date, repeat: ReminderRepeat, tz: string, now = new Date()): Date {
  let next = nextAfter(due, repeat, tz);
  for (let i = 0; i < 2000 && next.getTime() <= now.getTime(); i++) next = nextAfter(next, repeat, tz);
  return next;
}

/** Small stable string hash so the same reminder always gets the same line. */
export function hashId(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s: string) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const GROUP_LINES = [(t: string) => `⏰ ${cap(t)}, everyone`, (t: string) => `⏰ Heads up, all: ${lower(t)}`, (t: string) => `⏰ Reminder for the group: ${lower(t)}`];
const PRIVATE_LINES = [(t: string) => `⏰ Reminder: ${lower(t)}`, (t: string, who: string) => `⏰ Hey ${who}, ${lower(t)}`, (t: string, who: string) => `⏰ ${who}, quick one: ${lower(t)}`];

/**
 * What Roomie sends when a reminder fires: short, in its voice, picked by id (no randomness). "(set by Maya)" when
 * someone set it for another Member.
 */
export function reminderLine(r: Pick<Reminder, "id" | "text" | "memberId" | "memberName" | "createdBy" | "createdByName">): string {
  const text = r.text.trim().replace(/[.!]+$/, "");
  const lines = r.memberId ? PRIVATE_LINES : GROUP_LINES;
  const line = lines[hashId(r.id) % lines.length](text, r.memberName ?? "everyone");
  const setBy = r.memberId && r.createdBy && r.createdBy !== r.memberId && r.createdByName ? ` (set by ${r.createdByName})` : "";
  return `${line}${setBy}`;
}

/** "Tue Nov 3, 8:00 PM" plus the repeat, for tool results and the dashboard. */
export function whenLabel(r: Pick<Reminder, "dueAt" | "recurring">, tz: string): string {
  return `${formatInZone(r.dueAt, tz)}${r.recurring ? `, then ${r.recurring}` : ""}`;
}

/** Who may cancel: whoever it's for, whoever set it, any active Member for a whole-group one, or an Admin. */
export function canCancel(actor: { id: string; role: string; status: string }, r: Pick<Reminder, "memberId" | "createdBy">): boolean {
  if (actor.status !== "active") return false;
  return actor.role === "admin" || r.memberId === null || r.memberId === actor.id || r.createdBy === actor.id;
}

/** Whether `viewerId` sees a reminder: whole-group ones, their own, and the ones they set. */
export const visibleTo = (viewerId: string, r: Pick<Reminder, "memberId" | "createdBy">) => r.memberId === null || r.memberId === viewerId || r.createdBy === viewerId;

// ---------- queries ----------

const selectShape = {
  id: reminders.id,
  groupId: reminders.groupId,
  text: reminders.text,
  dueAt: reminders.dueAt,
  memberId: reminders.memberId,
  memberName: members.displayName,
  recurring: reminders.recurring,
  createdBy: reminders.createdBy,
  createdByName: setter.displayName,
};

const baseQuery = () =>
  db.select(selectShape).from(reminders).leftJoin(members, eq(members.id, reminders.memberId)).leftJoin(setter, eq(setter.id, reminders.createdBy));

const toReminder = (r: Omit<Reminder, "memberName" | "createdByName" | "recurring"> & { memberName: string | null; createdByName: string | null; recurring: ReminderRepeat | null }): Reminder => ({
  ...r,
  memberName: r.memberName ?? null,
  createdByName: r.createdByName ?? null,
  recurring: r.recurring ?? null,
});

export async function setReminder(
  ctx: Ctx,
  input: { text: string; dueAt: Date; memberId?: string; recurring?: ReminderRepeat | null },
  now = new Date(),
): Promise<Reminder & { when: string }> {
  const actor = await requireActive(ctx);
  const text = input.text.trim().replace(/\s+/g, " ");
  if (!text) throw new Error("Reminder needs some text.");
  if (text.length > MAX_TEXT) throw new Error("That reminder is long. A shorter line?");
  if (Number.isNaN(input.dueAt.getTime())) throw new Error("That's not a real date.");
  const tz = await groupTimezone(ctx.groupId);
  if (input.dueAt.getTime() < now.getTime() - PAST_SLACK_MS) {
    throw new Error(`That time has already passed (it's ${formatInZone(now, tz)} in ${tz}). When should it go off?`);
  }

  let memberName: string | null = null;
  if (input.memberId) {
    const [m] = await db
      .select({ name: members.displayName, status: members.status })
      .from(members)
      .where(and(eq(members.id, input.memberId), eq(members.groupId, ctx.groupId)));
    if (!m || m.status === "removed") throw new Error("That person isn't in this group.");
    memberName = m.name;
  }

  const [row] = await db
    .insert(reminders)
    .values({ groupId: ctx.groupId, text, dueAt: input.dueAt, memberId: input.memberId ?? null, recurring: input.recurring ?? null, createdBy: ctx.memberId })
    .returning();
  const forWho = memberName ? (input.memberId === ctx.memberId ? "themselves" : memberName) : "everyone";
  await record(ctx.groupId, ctx.memberId, "reminder.set", `set a reminder for ${forWho}: ${text}`, { table: "reminders", id: row.id });
  const r = toReminder({ ...row, memberName, createdByName: actor.displayName });
  return { ...r, when: whenLabel(r, tz) };
}

/** Upcoming reminders, soonest first. With `viewerId`, only what that Member may see (whole-group, theirs, set by them). */
export async function listReminders(ctx: GroupCtx, opts: { viewerId?: string; groupOnly?: boolean } = {}): Promise<Reminder[]> {
  const rows = await baseQuery()
    .where(and(eq(reminders.groupId, ctx.groupId), isNull(reminders.sentAt), opts.groupOnly ? isNull(reminders.memberId) : undefined))
    .orderBy(asc(reminders.dueAt));
  const list = rows.map(toReminder);
  return opts.viewerId ? list.filter((r) => visibleTo(opts.viewerId!, r)) : list;
}

export async function cancelReminder(ctx: Ctx, input: { reminderId: string }): Promise<{ cancelled: string }> {
  const actor = await requireActive(ctx);
  const [r] = await baseQuery().where(and(eq(reminders.id, input.reminderId), eq(reminders.groupId, ctx.groupId), isNull(reminders.sentAt)));
  if (!r) throw new Error("That reminder isn't coming up anymore.");
  if (!canCancel(actor, r)) throw new NotAllowedError(`That one's ${r.memberName}'s reminder. ${r.memberName}${r.createdByName && r.createdBy !== r.memberId ? `, ${r.createdByName}` : ""} or an admin can cancel it.`, "not-yours");
  await db.delete(reminders).where(and(eq(reminders.id, r.id), eq(reminders.groupId, ctx.groupId)));
  await record(ctx.groupId, ctx.memberId, "reminder.cancelled", `cancelled the reminder "${r.text}"`, { table: "reminders", id: r.id });
  return { cancelled: r.text };
}

/** Scheduler only: every Group's unsent reminders with dueAt <= now. */
export async function dueReminders(now = new Date(), groupId?: string): Promise<Reminder[]> {
  const rows = await baseQuery()
    .where(and(isNull(reminders.sentAt), lte(reminders.dueAt, now), groupId ? eq(reminders.groupId, groupId) : undefined))
    .orderBy(asc(reminders.dueAt));
  return rows.map(toReminder);
}

/** Scheduler only: mark sent; a repeating one gets its next occurrence (after `now`) as a new row. */
export async function markSent(reminderId: string, now = new Date()): Promise<Date | null> {
  const [row] = await db
    .update(reminders)
    .set({ sentAt: now })
    .where(and(eq(reminders.id, reminderId), isNull(reminders.sentAt)))
    .returning();
  if (!row?.recurring) return null;
  const tz = await groupTimezone(row.groupId);
  const dueAt = nextOccurrence(row.dueAt, row.recurring, tz, now);
  await db.insert(reminders).values({ groupId: row.groupId, text: row.text, memberId: row.memberId, recurring: row.recurring, createdBy: row.createdBy, dueAt });
  return dueAt;
}
