// Every Chat message is logged (chat_messages) so Roomie knows what happened between mentions. Kept 30 days.
import { and, count, desc, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";

const { chatMessages, members } = schema;

export const RETENTION_DAYS = 30;

export async function logMessage(groupId: string, memberId: string | null, text: string) {
  await db.insert(chatMessages).values({ groupId, memberId, text });
}

/** Recent Chat as "[Name] text" lines, oldest first. */
export async function recentChatter(groupId: string, sinceMinutes = 120, limit = 30): Promise<string[]> {
  const since = new Date(Date.now() - sinceMinutes * 60_000);
  const rows = await db
    .select({ text: chatMessages.text, name: members.displayName })
    .from(chatMessages)
    .leftJoin(members, eq(chatMessages.memberId, members.id))
    .where(and(eq(chatMessages.groupId, groupId), gt(chatMessages.createdAt, since)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  return rows.reverse().map((r) => `[${r.name ?? "Roomie"}] ${r.text}`);
}

/** What Roomie said lately, newest first (Home's "What Roomie's been up to"). */
export async function roomieLines(groupId: string, limit = 6): Promise<{ id: string; text: string; createdAt: Date }[]> {
  return db
    .select({ id: chatMessages.id, text: chatMessages.text, createdAt: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.groupId, groupId), isNull(chatMessages.memberId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
}

/** When Roomie last spoke in this Chat (its rows have memberId null), or null if never. Opens the follow-up window. */
export async function lastRoomieReplyAt(groupId: string): Promise<Date | null> {
  const [row] = await db
    .select({ at: chatMessages.createdAt })
    .from(chatMessages)
    .where(and(eq(chatMessages.groupId, groupId), isNull(chatMessages.memberId)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  return row?.at ?? null;
}

/**
 * What Roomie said in the Chat after `since` in answer to this Member (the human line just before it is theirs),
 * oldest first: the stale-reply rule's "already answered them" (#41, policy.ts staleReply).
 */
export async function roomieAnswersSince(groupId: string, since: Date, memberId: string): Promise<string[]> {
  const { rows } = await db.execute<{ text: string; answered: string | null }>(sql`
    select r.text,
      (select h.member_id from ${chatMessages} h
        where h.group_id = r.group_id and h.member_id is not null and h.created_at <= r.created_at
        order by h.created_at desc limit 1) as answered
    from ${chatMessages} r
    where r.group_id = ${groupId} and r.member_id is null and r.created_at > ${since.toISOString()}::timestamptz
    order by r.created_at`);
  return rows.filter((r) => r.answered === memberId).map((r) => r.text);
}

/**
 * Human messages (memberId NOT NULL) logged strictly after `since`. The pipeline logs the incoming message before it
 * asks, so when called with lastRoomieReplyAt() the result already counts the message being handled (first follow-up = 1).
 */
export async function humanMessagesSince(groupId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(chatMessages)
    .where(and(eq(chatMessages.groupId, groupId), isNotNull(chatMessages.memberId), gt(chatMessages.createdAt, since)));
  return Number(row?.n ?? 0);
}

/** Lines logged after `since` (all lines when null). The Group style refresh counts these. */
export async function linesSince(groupId: string, since: Date | null): Promise<number> {
  const where = since ? and(eq(chatMessages.groupId, groupId), gt(chatMessages.createdAt, since)) : eq(chatMessages.groupId, groupId);
  const [row] = await db.select({ n: count() }).from(chatMessages).where(where);
  return Number(row?.n ?? 0);
}

/** Human lines after `since` (all when null), oldest first, at most `limit` of the newest: the Learned style's input. */
export async function humanLinesSince(groupId: string, since: Date | null, limit = 200): Promise<{ name: string; text: string; at: Date }[]> {
  const where = and(eq(chatMessages.groupId, groupId), isNotNull(chatMessages.memberId), ...(since ? [gt(chatMessages.createdAt, since)] : []));
  const rows = await db
    .select({ text: chatMessages.text, name: members.displayName, at: chatMessages.createdAt })
    .from(chatMessages)
    .innerJoin(members, eq(chatMessages.memberId, members.id))
    .where(where)
    .orderBy(desc(chatMessages.createdAt))
    .limit(limit);
  return rows.reverse();
}

/** Roomie's own chat lines, newest first (the slang budget looks at the last few). */
export async function roomieRecentTexts(groupId: string, limit = 5): Promise<string[]> {
  return (await roomieLines(groupId, limit)).map((r) => r.text);
}

/** Retention (ADR 0006): delete every chat line older than `days`. Returns how many went. */
export async function deleteOlderThan(days = RETENTION_DAYS, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const gone = await db.delete(chatMessages).where(lt(chatMessages.createdAt, cutoff)).returning({ id: chatMessages.id });
  return gone.length;
}
