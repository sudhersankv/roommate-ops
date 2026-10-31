// Private nudges (ADR 0017): the DMs Roomie starts on its own (the Settle nudge, a personal restock), never a reply.
// sendNudge skips a Member who said "stop nudging me" (member_notes.note.nudges = "off"; the toggle is set_nudges),
// holds the DM until 08:00 local inside quiet hours (pending_posts, kind "dm"), and sends nothing in a paused Group.
// A CantMessagePrivatelyError from the Channel is the caller's to handle (the neutral group-line fallback). Reminders
// a Member set for themselves don't go through here: they arrive even with nudges off.
import { eq } from "drizzle-orm";
import { deliverPrivate } from "@/channels";
import type { Outgoing } from "@/channels/types";
import { db, schema } from "@/db";
import { inQuietHours, nextAllowed } from "@/lib/quiet-hours";
import { DEFAULT_TIMEZONE } from "./schedule";
import { nudgesOff } from "./urgent";

export type NudgeResult = { sent: true } | { sent: false; reason: "off" | "paused" | "not-member" } | { sent: false; reason: "quiet"; dueAt: Date };

export async function sendNudge(memberId: string, out: Outgoing, now = new Date()): Promise<NudgeResult> {
  const [m] = await db
    .select({ groupId: schema.members.groupId, status: schema.members.status, tz: schema.groups.timezone, pausedAt: schema.groups.pausedAt })
    .from(schema.members)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.members.groupId))
    .where(eq(schema.members.id, memberId));
  if (!m || m.status !== "active") return { sent: false, reason: "not-member" };
  if (m.pausedAt) return { sent: false, reason: "paused" };
  if (await nudgesOff(memberId)) return { sent: false, reason: "off" };
  const tz = m.tz ?? DEFAULT_TIMEZONE;
  if (inQuietHours(now, tz)) {
    const dueAt = nextAllowed(now, tz);
    await db.insert(schema.pendingPosts).values({ groupId: m.groupId, kind: "dm", memberId, text: out.text, buttons: out.buttons ?? null, dueAt, createdAt: now });
    return { sent: false, reason: "quiet", dueAt };
  }
  await deliverPrivate(memberId, out);
  return { sent: true };
}
