// /admin/groups (audit H1): every Group for the people who run Roomie, with pause / resume / leave. Operators only
// (lib/operator.ts decides who that is); a paused Group's messages are still logged, Roomie says and posts nothing.
import { count, desc, eq, inArray, isNotNull, max, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { channelFor } from "@/channels";
import type { ChannelName } from "@/db/schema";
import { capKeys, caps } from "@/lib/caps";
import { countsFor } from "@/lib/rate-counters";
import { record } from "./activity";
import { NotAllowedError } from "./authz";

export type Operator = { email: string } | null;
function requireOperator(op: Operator): asserts op is { email: string } {
  if (!op) throw new NotAllowedError("Only the people who run Roomie can do that.", "operator-only");
}

const isId = (id: string) => /^[0-9a-f-]{36}$/i.test(id);

export type OperatorGroupRow = {
  id: string;
  name: string;
  channel: ChannelName | null;
  chatTitle: string | null;
  members: number;
  pending: number;
  createdAt: Date;
  lastActivityAt: Date | null;
  runsToday: number;
  pausedAt: Date | null;
};

export const GROUPS_PER_PAGE = 100;

export type OperatorGroupPage = { rows: OperatorGroupRow[]; total: number; paused: number; page: number; pages: number };

/** Newest first, a page at a time. "Runs today" = agent runs counted against the Group's daily cap (lib/caps.ts). */
export async function listGroupsForOperator(op: Operator, opts: { page?: number; perPage?: number } = {}): Promise<OperatorGroupPage> {
  requireOperator(op);
  const perPage = Math.max(1, Math.min(500, opts.perPage ?? GROUPS_PER_PAGE));
  const [{ total, paused }] = await db
    .select({ total: count(), paused: sql<number>`count(${schema.groups.pausedAt})::int` })
    .from(schema.groups);
  const pages = Math.max(1, Math.ceil(Number(total) / perPage));
  const page = Math.min(pages, Math.max(1, Math.floor(opts.page ?? 1)));
  const groups = await db
    .select({ id: schema.groups.id, name: schema.groups.name, createdAt: schema.groups.createdAt, pausedAt: schema.groups.pausedAt, channel: schema.chats.channel, chatTitle: schema.chats.title })
    .from(schema.groups)
    .leftJoin(schema.chats, eq(schema.chats.groupId, schema.groups.id))
    .orderBy(desc(schema.groups.createdAt), desc(schema.groups.id))
    .limit(perPage)
    .offset((page - 1) * perPage);
  const ids = groups.map((g) => g.id);
  const [memberRows, lastRows] = ids.length
    ? await Promise.all([
        db
          .select({ groupId: schema.members.groupId, status: schema.members.status, n: count() })
          .from(schema.members)
          .where(inArray(schema.members.groupId, ids))
          .groupBy(schema.members.groupId, schema.members.status),
        db
          .select({ groupId: schema.chatMessages.groupId, at: max(schema.chatMessages.createdAt) })
          .from(schema.chatMessages)
          .where(inArray(schema.chatMessages.groupId, ids))
          .groupBy(schema.chatMessages.groupId),
      ])
    : [[], []];
  const limits = await caps();
  const runs = await countsFor(ids.map((id) => capKeys.groupDay(id)), limits.limiter.groupDay.windowStart()).catch(() => new Map<string, number>());
  const rows = groups.map((g) => {
    const mine = memberRows.filter((m) => m.groupId === g.id);
    return {
      ...g,
      members: Number(mine.find((m) => m.status === "active")?.n ?? 0),
      pending: Number(mine.find((m) => m.status === "pending")?.n ?? 0),
      lastActivityAt: lastRows.find((l) => l.groupId === g.id)?.at ?? null,
      runsToday: runs.get(capKeys.groupDay(g.id)) ?? 0,
    };
  });
  return { rows, total: Number(total), paused: Number(paused), page, pages };
}

/** Groups an operator paused (the scheduler skips them). */
export async function pausedGroupIds(): Promise<Set<string>> {
  const rows = await db.select({ id: schema.groups.id }).from(schema.groups).where(isNotNull(schema.groups.pausedAt));
  return new Set(rows.map((r) => r.id));
}

export async function setGroupPaused(op: Operator, groupId: string, paused: boolean): Promise<boolean> {
  requireOperator(op);
  if (!isId(groupId)) return false;
  const [row] = await db
    .update(schema.groups)
    .set({ pausedAt: paused ? sql`coalesce(${schema.groups.pausedAt}, now())` : null })
    .where(eq(schema.groups.id, groupId))
    .returning({ id: schema.groups.id });
  if (!row) return false;
  if (paused) {
    // An intro still waiting (Roomie joined a minute ago) never goes out.
    const [chat] = await db.select({ channel: schema.chats.channel, externalId: schema.chats.externalId }).from(schema.chats).where(eq(schema.chats.groupId, groupId));
    if (chat) channelFor(chat.channel)?.dropIntro?.(chat.externalId);
  }
  await record(groupId, null, paused ? "group.paused" : "group.resumed", paused ? "was paused by the people who run Roomie" : "was resumed by the people who run Roomie", { table: "groups", id: groupId });
  return true;
}

/**
 * Roomie leaves the Group's Chat (through its Channel on this server) and the Group is paused, so nothing goes out if
 * it's ever added back before an operator resumes it. Throws when the Channel isn't connected here.
 */
export async function leaveGroupChat(op: Operator, groupId: string): Promise<boolean> {
  requireOperator(op);
  if (!isId(groupId)) return false;
  const [chat] = await db.select().from(schema.chats).where(eq(schema.chats.groupId, groupId));
  if (!chat) return false;
  const channel = channelFor(chat.channel);
  if (!channel) throw new Error(`${chat.channel} isn't connected on this server, so Roomie can't leave from here.`);
  // Pause first: if leaving fails, the Group is at least quiet.
  await setGroupPaused(op, groupId, true);
  try {
    await channel.leaveChat(chat.externalId);
  } catch (e) {
    throw new Error(`Paused, but leaving the chat failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  await record(groupId, null, "group.left", "left the chat (the people who run Roomie asked)", { table: "groups", id: groupId });
  return true;
}
