// The urgent slot (ADR 0017): one more unprompted post a day, for something that can't wait for tomorrow's Bundle (in
// this epic only a landlord Notice dated within 72 hours; Lease Inbox calls it). Claimed in scheduled_posts (group,
// "urgent", the local day it goes out), so a second one that day is refused. Inside quiet hours it's held in
// pending_posts until 08:00 local, and that morning's slot is the one it takes. A paused Group posts nothing. The
// scheduler flushes held posts (flushPendingPosts). urgentPlan / urgentOutcome are pure (core-slots.test.ts).
import { and, eq, lte } from "drizzle-orm";
import { deliver, deliverPrivate } from "@/channels";
import { CantMessagePrivatelyError } from "@/channels/types";
import { db, schema } from "@/db";
import { inQuietHours, nextAllowed } from "@/lib/quiet-hours";
import { dayInZone } from "@/lib/time";
import { claimPost, DEFAULT_TIMEZONE, releasePost } from "./schedule";

const { groups, members, memberNotes, pendingPosts } = schema;

export type UrgentResult = { posted: true } | { posted: false; reason: "claimed" | "paused" } | { posted: false; reason: "quiet"; dueAt: Date };

/* ---------- pure ---------- */

/** When an urgent post made now would go out, and the local day whose slot it takes. */
export function urgentPlan(now: Date, tz: string): { quiet: boolean; at: Date; period: string } {
  const quiet = inQuietHours(now, tz);
  const at = quiet ? nextAllowed(now, tz) : now;
  return { quiet, at, period: dayInZone(tz, at) };
}

/** The decision table: paused -> nothing; slot taken -> refused; quiet -> held for 08:00; else post now. */
export function urgentOutcome(s: { paused: boolean; claimed: boolean; quiet: boolean; at: Date }): UrgentResult | "post" {
  if (s.paused) return { posted: false, reason: "paused" };
  if (!s.claimed) return { posted: false, reason: "claimed" };
  if (s.quiet) return { posted: false, reason: "quiet", dueAt: s.at };
  return "post";
}

/* ---------- DB ---------- */

async function groupState(groupId: string): Promise<{ tz: string; paused: boolean }> {
  const [g] = await db.select({ tz: groups.timezone, pausedAt: groups.pausedAt }).from(groups).where(eq(groups.id, groupId));
  return { tz: g?.tz ?? DEFAULT_TIMEZONE, paused: !g || !!g.pausedAt };
}

/** Post `text` in the Group's Chat now, or at 08:00 if it's night, unless today's urgent slot is taken. */
export async function postUrgent(groupId: string, text: string, now = new Date()): Promise<UrgentResult> {
  const { tz, paused } = await groupState(groupId);
  const plan = urgentPlan(now, tz);
  const claimed = paused ? false : await claimPost(groupId, "urgent", plan.period);
  const outcome = urgentOutcome({ paused, claimed, quiet: plan.quiet, at: plan.at });
  if (outcome !== "post") {
    if (!outcome.posted && outcome.reason === "quiet") await db.insert(pendingPosts).values({ groupId, kind: "urgent", text, dueAt: plan.at, createdAt: now });
    return outcome;
  }
  try {
    await deliver(groupId, { text });
  } catch (e) {
    await releasePost(groupId, "urgent", plan.period).catch(() => {});
    throw e;
  }
  return { posted: true };
}

/** `member_notes.note.nudges === "off"`: they said "stop nudging me" (Part B's set_nudges writes it). */
export async function nudgesOff(memberId: string): Promise<boolean> {
  const [n] = await db.select({ note: memberNotes.note }).from(memberNotes).where(eq(memberNotes.memberId, memberId));
  return n?.note?.nudges === "off";
}

type Pending = typeof pendingPosts.$inferSelect;

async function send(p: Pending) {
  const out = { text: p.text, ...(p.buttons?.length ? { buttons: p.buttons } : {}) };
  if (p.kind === "urgent") return deliver(p.groupId, out);
  if (!p.memberId || (await nudgesOff(p.memberId))) return;
  const [m] = await db.select({ status: members.status }).from(members).where(eq(members.id, p.memberId));
  if (m?.status !== "active") return;
  return deliverPrivate(p.memberId, out);
}

/**
 * Scheduler: every held post whose time has come, outside paused Groups. Each is claimed by deleting its row (two
 * processes can't both send it); a failed send puts it back five minutes later. A DM to someone Roomie can't message
 * privately is dropped (the nudge's fallback is the caller's). Returns how many went out.
 */
export async function flushPendingPosts(now = new Date(), paused: ReadonlySet<string> = new Set()): Promise<number> {
  const due = await db.select({ id: pendingPosts.id, groupId: pendingPosts.groupId }).from(pendingPosts).where(lte(pendingPosts.dueAt, now));
  let sent = 0;
  for (const d of due) {
    if (paused.has(d.groupId)) continue;
    const [p] = await db.delete(pendingPosts).where(and(eq(pendingPosts.id, d.id), lte(pendingPosts.dueAt, now))).returning();
    if (!p) continue; // another process has it
    try {
      await send(p);
      sent++;
    } catch (e) {
      if (e instanceof CantMessagePrivatelyError) {
        console.warn(`[pending] can't DM member ${p.memberId}; dropped a held ${p.kind}`);
        continue;
      }
      console.error(`scheduler: held ${p.kind} for group ${p.groupId} failed`, e);
      await db.insert(pendingPosts).values({ ...p, dueAt: new Date(now.getTime() + 5 * 60_000) }).catch(() => {});
    }
  }
  return sent;
}
