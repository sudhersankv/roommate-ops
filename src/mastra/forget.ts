// Memory and trace cleanup for "forget me", "delete group data" and the daily retention job (ADR 0006, audit B4/H5).
// Kept apart from memory.ts's config so services can import it lazily.
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { anonymize, isLineFrom, lineBody, mentionsAny, photoUrls, senderOf } from "@/lib/forget-text";
import { dropMemberLines, readSection, replaceSection } from "@/lib/style-note";
import { EMPTY_STYLE, memory, STYLE_HEADING, threadFor } from "./memory";

export { isLineFrom };

const MEMBER_NOTES = "## Member notes";

/** Traces (mastra_ai_spans) and live scores (mastra_scorers) are kept this long. */
export const TRACE_RETENTION_DAYS = 30;
/** Roomie's memory thread keeps messages this long (the same window as raw chat). */
export const MEMORY_RETENTION_DAYS = 30;

const textOf = (m: { content: unknown }) => {
  const c = m.content as { parts?: { type: string; text?: string }[]; content?: string } | string;
  if (typeof c === "string") return c;
  return c?.parts?.filter((p) => p.type === "text").map((p) => p.text ?? "").join(" ") || c?.content || "";
};

export type ForgetWho = {
  /** Every name the Member went by (current, placeholder like "+1555…", names seen on the Channel). */
  names: string[];
  /** What they said (chat_messages text): matches their lines logged under a name we no longer know. */
  texts?: string[];
  /** The other Members' current names: a line tagged with one of these is theirs, even if the text matches. */
  others?: string[];
};

/**
 * Deletes one Member's messages from the Group's memory thread (their own lines, under any name they went by, and
 * Roomie's replies that name them) and their Member notes line. Returns how many messages went and the photo URLs
 * their lines pointed at (the caller deletes the files).
 */
export async function forgetMemberInMemory(groupId: string, who: ForgetWho): Promise<{ deleted: number; photos: string[] }> {
  const otherNames = who.others ?? [];
  const others = new Set(otherNames.map((n) => n.trim().toLowerCase()));
  // A name another Member also has can't tell them apart: their lines are found by text instead.
  const names = [...new Set(who.names.map((n) => n.trim()).filter((n) => n && !others.has(n.toLowerCase())))];
  const texts = new Set((who.texts ?? []).map(lineBody).filter(Boolean));
  const { thread, resource } = threadFor(groupId);
  const existing = await memory.getThreadById({ threadId: thread });
  let deleted = 0;
  const photos: string[] = [];
  if (existing) {
    const { messages } = await memory.recall({ threadId: thread, resourceId: resource, perPage: false });
    const ids: string[] = [];
    for (const m of messages) {
      const text = textOf(m);
      const theirs =
        m.role === "user"
          ? names.some((n) => isLineFrom(text, n)) || (texts.has(lineBody(text)) && !others.has((senderOf(text) ?? "").toLowerCase()))
          : m.role === "assistant" && mentionsAny(text, names, otherNames);
      if (!theirs) continue;
      ids.push(m.id);
      if (m.role === "user") photos.push(...photoUrls(text));
    }
    if (ids.length) await memory.deleteMessages(ids);
    deleted = ids.length;
  }
  const wm = await memory.getWorkingMemory({ threadId: thread, resourceId: resource }).catch(() => null);
  if (wm) {
    const notes = readSection(wm, MEMBER_NOTES);
    const kept = names.reduce((s, n) => dropMemberLines(s, n), notes);
    if (kept !== notes) await memory.updateWorkingMemory({ threadId: thread, resourceId: resource, workingMemory: replaceSection(wm, MEMBER_NOTES, kept) });
  }
  return { deleted, photos };
}

/** Names in the Group's working memory (the Group style mirror) swapped for `replacement`; other Members' names stay. */
export async function anonymizeInWorkingMemory(groupId: string, names: string[], replacement: string, others: string[] = []): Promise<void> {
  const { thread, resource } = threadFor(groupId);
  const wm = await memory.getWorkingMemory({ threadId: thread, resourceId: resource }).catch(() => null);
  if (!wm) return;
  const next = anonymize(wm, names, replacement, others);
  if (next !== wm) await memory.updateWorkingMemory({ threadId: thread, resourceId: resource, workingMemory: next });
}

/** "Reset what you've learned": the working memory's Group style section back to empty. */
export async function resetStyleInMemory(groupId: string): Promise<void> {
  const { thread, resource } = threadFor(groupId);
  const wm = await memory.getWorkingMemory({ threadId: thread, resourceId: resource }).catch(() => null);
  if (!wm) return;
  await memory.updateWorkingMemory({ threadId: thread, resourceId: resource, workingMemory: replaceSection(wm, STYLE_HEADING, EMPTY_STYLE) });
}

/** The working memory line for one Member ("- Maya: diet: vegetarian ..."), or null. */
export async function memberLineInMemory(groupId: string, name: string): Promise<string | null> {
  const { thread, resource } = threadFor(groupId);
  const wm = await memory.getWorkingMemory({ threadId: thread, resourceId: resource }).catch(() => null);
  if (!wm) return null;
  const who = name.trim().toLowerCase();
  const line = readSection(wm, MEMBER_NOTES)
    .split("\n")
    .find((l) => l.trim().toLowerCase().replace(/^[-*]\s*/, "").replace(/^\[|\]/g, "").startsWith(`${who}:`));
  return line?.trim() ?? null;
}

/** Drops one Member's DM thread with Roomie for this Group (and its working memory). */
export async function forgetDmInMemory(groupId: string, memberId: string): Promise<void> {
  const { thread, resource } = threadFor(groupId, memberId);
  await memory.deleteThread(thread).catch(() => {});
  await db.execute(sql`delete from mastra_resources where id = ${resource}`).catch(() => {});
}

/** Drops the Group's whole memory: thread, messages, embeddings and working memory, and every Member's DM thread. */
export async function forgetGroupInMemory(groupId: string): Promise<void> {
  const { thread, resource } = threadFor(groupId);
  await memory.deleteThread(thread).catch(() => {});
  await db.execute(sql`delete from mastra_resources where id = ${resource}`).catch(() => {});
  const dms = await db.execute(sql`select id from mastra_threads where id like ${`${thread}-dm-%`}`).catch(() => ({ rows: [] }));
  for (const r of dms.rows as { id: string }[]) await memory.deleteThread(r.id).catch(() => {});
  await db.execute(sql`delete from mastra_resources where id like ${`${groupId}:dm:%`}`).catch(() => {});
}

/* ---------- traces (mastra_ai_spans) and live scores (mastra_scorers) ---------- */

/** Postgres "relation does not exist": Mastra hasn't created its tables yet (a fresh DB). Nothing to delete then. */
const missingTable = (e: unknown) => (e as { code?: string; cause?: { code?: string } })?.code === "42P01" || (e as { cause?: { code?: string } })?.cause?.code === "42P01";

/**
 * Deletes whole traces: every span of each trace a span matching `match` belongs to, the scorer runs that scored those
 * traces (their own traces, pointing back with metadata.targetTraceId) and the scores. Returns the spans deleted.
 */
async function deleteTraces(match: SQL, scoresToo: SQL = sql`false`): Promise<number> {
  try {
    const traces = sql`(select distinct "traceId" from mastra_ai_spans where ${match})`;
    // A scorer run is its own trace: its root points back with targetTraceId, its children (the judge's model calls,
    // with the scored message and reply) only share its traceId.
    const scorerRuns = sql`(select distinct "traceId" from mastra_ai_spans where metadata->>'targetTraceId' in ${traces})`;
    await db.execute(sql`delete from mastra_scorers where "traceId" in ${traces} or ${scoresToo}`);
    const res = await db.execute(sql`delete from mastra_ai_spans where "traceId" in ${traces} or "traceId" in ${scorerRuns}`);
    return res.rowCount ?? 0;
  } catch (e) {
    if (missingTable(e)) return 0;
    throw e;
  }
}

/** Every trace and score of a Group ("delete group data"; the root span's metadata carries groupId). */
export const forgetGroupTraces = (groupId: string) => deleteTraces(sql`metadata->>'groupId' = ${groupId}`, sql`"resourceId" = ${groupId}`);

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * "forget me": every trace one Member's message started, and every trace in their Group whose spans carry one of their
 * lines ("[Name] …" as context of someone else's message), with the scores and scorer runs of those traces.
 */
export async function forgetMemberTraces(memberId: string, opts: { groupId?: string; names?: string[] } = {}): Promise<number> {
  let n = await deleteTraces(sql`metadata->>'memberId' = ${memberId}`);
  const names = (opts.names ?? []).map((x) => x.trim()).filter((x) => x.length >= 2);
  if (opts.groupId && names.length) {
    const tags = names.flatMap((x) => [`%[${likeEscape(x)}]%`, `%[voice note from ${likeEscape(x)}]%`]);
    const inGroup = sql`(select distinct "traceId" from mastra_ai_spans where metadata->>'groupId' = ${opts.groupId})`;
    const anyTag = sql.join(
      tags.map((t) => sql`(coalesce(input::text, '') || coalesce(output::text, '')) ilike ${t}`),
      sql` or `,
    );
    n += await deleteTraces(sql`"traceId" in ${inGroup} and (${anyTag})`);
  }
  return n;
}

/** Traces still tied to Members that "forget me" already removed (their last turn ends after the tool runs). */
export async function forgetRemovedMembersTraces(formerName: string): Promise<number> {
  return deleteTraces(
    sql`metadata->>'memberId' in (select id::text from members where status = 'removed' and display_name = ${formerName} and channel_user_id is null and account_id is null)`,
  );
}

/**
 * Mastra keeps each time twice: "<col>" (timestamp, UTC wall-clock) and "<col>Z" (timestamptz, which defaults to now()
 * when a writer leaves it out). The earlier of the two is the real one; LEAST skips a null.
 */
const olderThan = (col: string, cutoff: SQL) => sql`least(${sql.identifier(`${col}Z`)}, ${sql.identifier(col)} at time zone 'UTC') < ${cutoff}`;

/** Retention: spans and scores older than TRACE_RETENTION_DAYS. Returns { spans, scores } deleted. */
export async function deleteOldTraces(now = new Date(), days = TRACE_RETENTION_DAYS): Promise<{ spans: number; scores: number }> {
  const cutoff = sql`${new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()}::timestamptz`;
  try {
    const scores = await db.execute(sql`delete from mastra_scorers where ${olderThan("createdAt", cutoff)}`);
    // A span's own time (startedAt); createdAt is the row's insert time.
    const spans = await db.execute(sql`delete from mastra_ai_spans where ${olderThan("startedAt", cutoff)}`);
    return { spans: spans.rowCount ?? 0, scores: scores.rowCount ?? 0 };
  } catch (e) {
    if (missingTable(e)) return { spans: 0, scores: 0 };
    throw e;
  }
}

/** Retention: memory-thread messages (and their embeddings) older than MEMORY_RETENTION_DAYS. Returns how many. */
export async function deleteOldMemory(now = new Date(), days = MEMORY_RETENTION_DAYS): Promise<number> {
  const cutoff = sql`${new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString()}::timestamptz`;
  let total = 0;
  try {
    for (let round = 0; round < 40; round++) {
      const { rows } = await db.execute(sql`select id from mastra_messages where ${olderThan("createdAt", cutoff)} limit 500`);
      const ids = (rows as { id: string }[]).map((r) => r.id);
      if (!ids.length) return total;
      await memory.deleteMessages(ids); // also drops their vectors in memory_messages_<dim>
      total += ids.length;
      if (ids.length < 500) return total;
    }
    return total; // the rest goes tomorrow
  } catch (e) {
    if (missingTable(e)) return total;
    throw e;
  }
}
