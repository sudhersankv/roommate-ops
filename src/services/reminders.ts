// Reminders. One-off and monthly nudges; the scheduler (src/jobs/scheduler.ts) delivers them.
import { and, asc, eq, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireActive } from "./authz";
import type { Ctx, GroupCtx } from "./types";

const { reminders, members } = schema;

export type Reminder = {
  id: string;
  groupId: string;
  text: string;
  dueAt: Date;
  memberId: string | null;
  memberName: string | null; // null = for everyone
  recurring: "monthly" | null;
};

// ---------- pure date math (unit tested, no DB) ----------

/** Same time-of-day, one calendar month later, day-of-month clamped to 28 so it never skips a month. All in UTC. */
export function addOneMonth(d: Date): Date {
  return new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      Math.min(d.getUTCDate(), 28),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  );
}

// ---------- queries ----------

const selectShape = {
  id: reminders.id,
  groupId: reminders.groupId,
  text: reminders.text,
  dueAt: reminders.dueAt,
  memberId: reminders.memberId,
  memberName: members.displayName,
  recurring: reminders.recurring,
};

const baseQuery = () => db.select(selectShape).from(reminders).leftJoin(members, eq(members.id, reminders.memberId));

const toReminder = (r: { memberName: string | null; recurring: "monthly" | null } & Omit<Reminder, "memberName" | "recurring">): Reminder => ({
  ...r,
  memberName: r.memberName ?? null,
  recurring: r.recurring ?? null,
});

export async function setReminder(
  ctx: Ctx,
  input: { text: string; dueAt: Date; memberId?: string; recurring?: "monthly" },
): Promise<Reminder> {
  await requireActive(ctx);
  const text = input.text.trim();
  if (!text) throw new Error("Reminder needs some text.");
  if (Number.isNaN(input.dueAt.getTime())) throw new Error("That's not a real date.");

  let memberName: string | null = null;
  if (input.memberId) {
    const [m] = await db
      .select({ name: members.displayName })
      .from(members)
      .where(and(eq(members.id, input.memberId), eq(members.groupId, ctx.groupId)));
    if (!m) throw new Error("That person isn't in this group.");
    memberName = m.name;
  }

  const [row] = await db
    .insert(reminders)
    .values({
      groupId: ctx.groupId,
      text,
      dueAt: input.dueAt,
      memberId: input.memberId ?? null,
      recurring: input.recurring ?? null,
    })
    .returning();

  return toReminder({ ...row, memberName });
}

export async function listReminders(ctx: GroupCtx): Promise<Reminder[]> {
  const rows = await baseQuery()
    .where(and(eq(reminders.groupId, ctx.groupId), isNull(reminders.sentAt)))
    .orderBy(asc(reminders.dueAt));
  return rows.map(toReminder);
}

export async function cancelReminder(ctx: Ctx, input: { reminderId: string }): Promise<void> {
  await requireActive(ctx);
  await db.delete(reminders).where(and(eq(reminders.id, input.reminderId), eq(reminders.groupId, ctx.groupId)));
}

/** Scheduler only: all groups' unsent reminders with dueAt <= now. */
export async function dueReminders(now = new Date()): Promise<Reminder[]> {
  const rows = await baseQuery()
    .where(and(isNull(reminders.sentAt), lte(reminders.dueAt, now)))
    .orderBy(asc(reminders.dueAt));
  return rows.map(toReminder);
}

/** Scheduler only: set sent_at; if recurring monthly, insert next month's copy. */
export async function markSent(reminderId: string): Promise<void> {
  const [row] = await db
    .update(reminders)
    .set({ sentAt: new Date() })
    .where(and(eq(reminders.id, reminderId), isNull(reminders.sentAt)))
    .returning();
  if (!row || row.recurring !== "monthly") return;
  await db.insert(reminders).values({
    groupId: row.groupId,
    text: row.text,
    memberId: row.memberId,
    recurring: "monthly",
    dueAt: addOneMonth(row.dueAt),
  });
}

