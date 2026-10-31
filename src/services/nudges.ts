// Private nudges (ADR 0017): the DMs Roomie starts on its own (the Settle nudge, a personal restock), never a reply.
// sendNudge skips a Member who said "stop nudging me" (member_notes.note.nudges = "off"; the toggle is set_nudges),
// holds the DM until 08:00 local inside quiet hours (pending_posts, kind "dm"), and sends nothing in a paused Group.
// A CantMessagePrivatelyError from the Channel is the caller's to handle (the neutral group-line fallback). Reminders
// a Member set for themselves don't go through here: they arrive even with nudges off.
import { eq } from "drizzle-orm";
import { channelFor, deliverPrivate } from "@/channels";
import type { Outgoing } from "@/channels/types";
import { db, schema } from "@/db";
import { inQuietHours, nextAllowed } from "@/lib/quiet-hours";
import { DEFAULT_TIMEZONE } from "./schedule";
import { nudgesOff } from "./urgent";

export type NudgeResult = { sent: true } | { sent: false; reason: "off" | "paused" | "not-member" } | { sent: false; reason: "quiet"; dueAt: Date };

/**
 * Whether a private nudge would reach this Member: active, nudges not off, and a DM path (a Channel that can message
 * first, or they've DM'd with Roomie before: a dm_context row; no registered Channel = the dev log, as deliverPrivate).
 * The Bundle leaves out what these Members hear privately.
 */
export async function canNudge(memberId: string): Promise<boolean> {
  const [m] = await db
    .select({ status: schema.members.status, channelUserId: schema.members.channelUserId, channel: schema.chats.channel })
    .from(schema.members)
    .innerJoin(schema.chats, eq(schema.chats.groupId, schema.members.groupId))
    .where(eq(schema.members.id, memberId));
  if (!m || m.status !== "active" || !m.channelUserId || (await nudgesOff(memberId))) return false;
  const channel = channelFor(m.channel);
  if (!channel || channel.messagesFirst) return true;
  const [ctx] = await db.select({ at: schema.dmContext.at }).from(schema.dmContext).where(eq(schema.dmContext.memberId, memberId)).limit(1);
  return !!ctx;
}

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
