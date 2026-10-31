// Activity: the Group's record of who added, changed or deleted what, and where (the chat or the dashboard).
// Services write it; the Money page reads it, and Roomie reads what changed since it last spoke (recentChanges).
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { lastRoomieReplyAt } from "./chatlog";
import type { Ctx, GroupCtx } from "./types";

const { activity, members } = schema;

/** Where a change was made. Null for Roomie's own work (onboarding, the scheduler) and old rows. */
export type ActivitySource = "chat" | "dashboard" | "dm";

/** A Ctx's source as it's stored: the dashboard (session actions and Ask Roomie) is "ui" in a Ctx. */
export const sourceOf = (ctx: Pick<Ctx, "source">): ActivitySource | null => (ctx.source === "ui" ? "dashboard" : ctx.source === "dm" ? "dm" : ctx.source === "chat" ? "chat" : null);

export type ActivityEntry = {
  id: string;
  actorMemberId: string | null; // null = Roomie
  actorName: string;
  kind: string;
  summary: string;
  refTable: string | null;
  refId: string | null;
  source: ActivitySource | null;
  createdAt: Date;
};

/**
 * `actorMemberId` null means Roomie did it. `summary` reads after the actor's name ("added Pizza, $24.00", "took
 * eggs off the Cart"). `source` is where it happened; pass `sourceOf(ctx)`.
 */
export async function record(
  groupId: string,
  actorMemberId: string | null,
  kind: string,
  summary: string,
  ref?: { table: string; id: string },
  source?: ActivitySource | null,
): Promise<void> {
  await db.insert(activity).values({ groupId, actorMemberId, kind, summary, refTable: ref?.table ?? null, refId: ref?.id ?? null, source: source ?? null });
}

/** record() for whoever is acting in `ctx`, with where they did it (chat or dashboard). */
export const recordFor = (ctx: Ctx, kind: string, summary: string, ref?: { table: string; id: string }) =>
  record(ctx.groupId, ctx.memberId, kind, summary, ref, sourceOf(ctx));

const select = {
  id: activity.id,
  actorMemberId: activity.actorMemberId,
  actorName: members.displayName,
  kind: activity.kind,
  summary: activity.summary,
  refTable: activity.refTable,
  refId: activity.refId,
  source: activity.source,
  createdAt: activity.createdAt,
};

type Row = { actorMemberId: string | null; actorName: string | null; source: string | null };
const named = <T extends Row>(r: T) => ({
  ...r,
  actorName: r.actorMemberId ? (r.actorName ?? "Someone") : "Roomie",
  source: r.source === "chat" || r.source === "dashboard" || r.source === "dm" ? r.source : null,
});

export async function listActivity(ctx: GroupCtx, limit = 50): Promise<ActivityEntry[]> {
  const rows = await db
    .select(select)
    .from(activity)
    .leftJoin(members, eq(activity.actorMemberId, members.id))
    .where(eq(activity.groupId, ctx.groupId))
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(limit);
  return rows.map(named);
}

/** At most this many lines go into Roomie's instructions. */
export const MAX_CHANGES = 8;

/** "just now", "2 min ago", "3 h ago", "2 days ago". */
export function agoLabel(at: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/** "Ryan took eggs off the Cart (dashboard, 2 min ago)". Pure. */
export function changeLine(e: Pick<ActivityEntry, "actorName" | "summary" | "source" | "createdAt">, now = new Date()): string {
  const where = e.source === "dashboard" ? "dashboard, " : e.source === "chat" ? "in the chat, " : e.source === "dm" ? "privately, " : "";
  return `${e.actorName} ${e.summary} (${where}${agoLabel(e.createdAt, now)})`;
}

/**
 * What changed in the Group since `since`, as one-line facts for Roomie ("Ryan took eggs off the Cart (dashboard,
 * 2 min ago)"): at most MAX_CHANGES, the newest ones, newest last.
 */
export async function recentChanges(groupId: string, since: Date, now = new Date()): Promise<string[]> {
  const rows = await db
    .select(select)
    .from(activity)
    .leftJoin(members, eq(activity.actorMemberId, members.id))
    // A Settlement made in a DM stays between the two people (ADR 0020): never a fact for the group.
    .where(and(eq(activity.groupId, groupId), gt(activity.createdAt, since), sql`not (coalesce(${activity.source}, '') = 'dm' and ${activity.kind} like 'settlement.%')`))
    .orderBy(desc(activity.createdAt), desc(activity.id))
    .limit(MAX_CHANGES);
  return rows.map(named).reverse().map((e) => changeLine(e, now));
}

/** How far back the dashboard's Ask Roomie looks: its replies aren't in the Chat log, so "last spoke" can't be known. */
export const DASHBOARD_CHANGES_MS = 15 * 60_000;

/**
 * recentChanges since Roomie last spoke in the Chat (an hour back when it never has): the agent's facts. On the
 * dashboard (`ui`) at most DASHBOARD_CHANGES_MS back, so an earlier Ask doesn't keep seeing the same old changes.
 */
export async function changesSinceRoomieSpoke(groupId: string, now = new Date(), opts: { ui?: boolean } = {}): Promise<string[]> {
  const last = await lastRoomieReplyAt(groupId);
  let since = last ?? new Date(now.getTime() - 60 * 60_000);
  if (opts.ui) since = new Date(Math.max(since.getTime(), now.getTime() - DASHBOARD_CHANGES_MS));
  return recentChanges(groupId, since, now);
}

/**
 * What one Member changed since `since` (the DB clock at the start of their run), made from `sources`: the Echo rule
 * reads a DM or dashboard run's own rows this way. Oldest first.
 */
export async function runChanges(groupId: string, opts: { since: Date; actorMemberId: string; sources: ActivitySource[] }): Promise<ActivityEntry[]> {
  const rows = await db
    .select(select)
    .from(activity)
    .leftJoin(members, eq(activity.actorMemberId, members.id))
    .where(and(eq(activity.groupId, groupId), eq(activity.actorMemberId, opts.actorMemberId), gt(activity.createdAt, opts.since), inArray(activity.source, opts.sources)))
    .orderBy(activity.createdAt, activity.id);
  return rows.map(named);
}

/** The DB's clock: a run's Activity rows are stamped by it, so "since the run began" is measured on it too. */
export async function dbNow(): Promise<Date> {
  const { rows } = await db.execute(sql`select now() as now`);
  return new Date((rows[0] as { now: string | Date }).now);
}