// Polls (ADR 0018): Roomie asks the chat a who-question, votes come back from the Channel (or as a bare number on a
// Channel without polls), and the Poll resolves once, on a majority of active Members, after 2 hours, or when the
// asker's own text closes it. Nothing is logged before; then the Poll's `about` runs through the owning service and
// Roomie posts one line. The rules are pure in poll-rules.ts.
import { and, asc, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { EXPENSE_CATEGORIES, type ExpenseCategory, type PollAbout } from "@/db/schema";
import { deliver, channelFor } from "@/channels";
import { renderPollAsText } from "@/channels/text";
import type { PollVote } from "@/channels/types";
import { requireActive } from "./authz";
import { logMessage } from "./chatlog";
import { listMembers, memberByChannelUser } from "./members";
import { logExpense } from "./money";
import { MAX_POLL_OPTIONS, POLL_TTL_MS, pollOutcome, whoIn, type PollReason } from "./poll-rules";
import { moneyIn, type Ctx } from "./types";
import { currencyOf } from "./groups";

export { pollMajority, pollOutcome, whoIn, numberVote, POLL_TTL_MS, MAX_POLL_OPTIONS } from "./poll-rules";
export type { PollAbout };

const { polls, pollVotes } = schema;
const isCategory = (c: unknown): c is ExpenseCategory => (EXPENSE_CATEGORIES as readonly unknown[]).includes(c);
type PollRow = typeof polls.$inferSelect;

export type AskPollInput = { kind: string; question: string; options: string[]; multi: boolean; about: PollAbout };

/**
 * Ask the Group's Chat a Poll: sent through its Channel (a native poll where there is one, numbered options
 * otherwise), stored with the sent message's id and, on WhatsApp, the secret its votes are encrypted with.
 */
export async function askPoll(ctx: Ctx, input: AskPollInput, now = new Date()): Promise<{ pollId: string; asText: boolean }> {
  await requireActive(ctx);
  const question = input.question.trim();
  const options = input.options.map((o) => o.trim()).filter(Boolean);
  if (!question) throw new Error("What's the question?");
  if (options.length < 2 || options.length > MAX_POLL_OPTIONS) throw new Error(`A poll needs 2 to ${MAX_POLL_OPTIONS} options.`);
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) throw new Error("The options need to be different.");
  if (input.about.kind === "who-in") {
    const a = input.about as Extract<PollAbout, { kind: "who-in" }>;
    if (!Number.isInteger(a.cents) || a.cents <= 0) throw new Error("A who's-in poll needs the amount.");
    if (!a.description?.trim()) throw new Error("A who's-in poll needs what it was for.");
  }
  const poll = { question, options, multi: input.multi };
  const text = renderPollAsText(poll);
  const sent = await deliver(ctx.groupId, { text, poll });
  const [row] = await db
    .insert(polls)
    .values({
      groupId: ctx.groupId,
      kind: input.kind,
      channel: sent.channel ?? "dev",
      externalId: sent.externalId ?? null,
      question,
      options,
      multi: input.multi,
      about: input.about,
      secret: sent.secret ? Buffer.from(sent.secret) : null,
      resolvesAt: new Date(now.getTime() + POLL_TTL_MS),
      createdBy: ctx.memberId,
    })
    .returning({ id: polls.id, channel: polls.channel });
  // A poll is a Roomie line like any other (it opens the follow-up window, and the agent sees it was asked).
  await logMessage(ctx.groupId, null, `(poll) ${text}`);
  return { pollId: row.id, asText: !nativePolls(row.channel) };
}

const nativePolls = (channel: string) => !!channelFor(channel as PollRow["channel"])?.nativePolls;

/** The secret and options of a WhatsApp Poll Roomie sent, for decrypting a vote (whatsapp-boot's pollSecret). */
export async function pollSecret(externalId: string): Promise<{ secret: Uint8Array; options: string[] } | null> {
  const [p] = await db.select({ secret: polls.secret, options: polls.options }).from(polls).where(and(eq(polls.channel, "whatsapp"), eq(polls.externalId, externalId)));
  return p?.secret ? { secret: new Uint8Array(p.secret), options: p.options } : null;
}

/** The newest open Poll in a Group that went out as numbered text (a bare number from a Member answers it). */
export async function openTextPoll(groupId: string): Promise<PollRow | null> {
  const open = await db.select().from(polls).where(and(eq(polls.groupId, groupId), isNull(polls.resolvedAt))).orderBy(desc(polls.createdAt)).limit(3);
  return open.find((p) => !nativePolls(p.channel)) ?? null;
}

export type VoteResult = { counted: boolean; resolved?: PollReason; line?: string | null };

/** A vote from the Channel: stored (or, with no options, taken back), then the Poll may resolve. Not a Poll of
 * Roomie's, already resolved, or not a Member's: ignored. */
export async function recordVote(vote: PollVote, now = new Date()): Promise<VoteResult> {
  if (!vote.pollExternalId) return { counted: false };
  const [poll] = await db.select().from(polls).where(and(eq(polls.channel, vote.channel), eq(polls.externalId, vote.pollExternalId)));
  if (!poll) return { counted: false };
  const member = await memberByChannelUser(poll.groupId, vote.userExternalId);
  if (!member || member.status !== "active") return { counted: false };
  return recordMemberVote(poll, member.id, vote.optionIds, now);
}

/** A Member's vote on a Poll by id (the numbered-text path, dev-chat). */
export async function voteOnPoll(pollId: string, memberId: string, optionIds: number[], now = new Date()): Promise<VoteResult> {
  const [poll] = await db.select().from(polls).where(eq(polls.id, pollId));
  if (!poll) return { counted: false };
  return recordMemberVote(poll, memberId, optionIds, now);
}

async function recordMemberVote(poll: PollRow, memberId: string, optionIds: number[], now: Date): Promise<VoteResult> {
  if (poll.resolvedAt) return { counted: false };
  let ids = [...new Set(optionIds)].filter((i) => Number.isInteger(i) && i >= 0 && i < poll.options.length).sort((a, b) => a - b);
  if (!poll.multi) ids = ids.slice(0, 1);
  if (!ids.length) {
    await db.delete(pollVotes).where(and(eq(pollVotes.pollId, poll.id), eq(pollVotes.memberId, memberId)));
    return { counted: true };
  }
  await db
    .insert(pollVotes)
    .values({ pollId: poll.id, memberId, optionIds: ids, at: now })
    .onConflictDoUpdate({ target: [pollVotes.pollId, pollVotes.memberId], set: { optionIds: ids, at: now } });
  return { counted: true, ...(await maybeResolve(poll, now)) };
}

async function maybeResolve(poll: PollRow, now: Date): Promise<{ resolved?: PollReason; line?: string | null }> {
  const [{ voters }] = await db.select({ voters: sql<number>`count(*)::int` }).from(pollVotes).where(eq(pollVotes.pollId, poll.id));
  const activeCount = (await listMembers({ groupId: poll.groupId })).length;
  const reason = pollOutcome({ activeCount, voters, now, resolvesAt: poll.resolvesAt });
  if (!reason) return {};
  const line = await resolvePoll(poll.id, reason);
  return { resolved: reason, line };
}

/**
 * Resolve once (claimed with resolved_at): "closed" only closes it (the asker's text already said what happened);
 * otherwise the `about` runs through its service and the one line is posted. Returns the line (null = none).
 */
export async function resolvePoll(pollId: string, reason: PollReason, now = new Date()): Promise<string | null> {
  const [poll] = await db.update(polls).set({ resolvedAt: now }).where(and(eq(polls.id, pollId), isNull(polls.resolvedAt))).returning();
  if (!poll || reason === "closed") return null;
  let line: string | null = null;
  try {
    line = await runAbout(poll);
  } catch (e) {
    console.error(`[polls] resolving poll ${poll.id} failed`, e);
    line = `I couldn't log ${poll.question.replace(/\?$/, "")} from the poll. Mind telling me who was in?`;
  }
  if (line) {
    await deliver(poll.groupId, { text: line });
    await logMessage(poll.groupId, null, line);
  }
  return line;
}

/** The owning service for each kind of `about`. Only "who-in" (an Expense) exists today. */
async function runAbout(poll: PollRow): Promise<string | null> {
  if (poll.about.kind !== "who-in") {
    console.warn(`[polls] poll ${poll.id}: nothing knows how to resolve "${poll.about.kind}"`);
    return null;
  }
  const about = poll.about as Extract<PollAbout, { kind: "who-in" }>;
  const votes = await db.select({ memberId: pollVotes.memberId, optionIds: pollVotes.optionIds }).from(pollVotes).where(eq(pollVotes.pollId, poll.id)).orderBy(asc(pollVotes.at));
  const what = `${moneyIn(await currencyOf(poll.groupId))(about.cents)} ${about.description}`;
  if (!votes.length) return `Nobody answered about the ${what}, so it's not logged. Tell me who was in and I'll log it.`;
  const people = await listMembers({ groupId: poll.groupId });
  const among = whoIn({ options: poll.options, votes, members: people, payerId: about.payerId, inOption: about.inOption });
  const ctx: Ctx = { groupId: poll.groupId, memberId: poll.createdBy ?? about.payerId, source: "chat" };
  const e = await logExpense(ctx, { cents: about.cents, description: about.description, payerId: about.payerId, splitAmong: among, ...(isCategory(about.category) ? { category: about.category } : {}) });
  // Payer first, as the split is.
  const inShares = new Set((e.splits ?? []).map((s) => s.memberId));
  const names = among.filter((id) => inShares.has(id)).map((id) => people.find((p) => p.id === id)?.displayName ?? "Someone");
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return names.length === 1 ? `Logged ${what}, just ${list}.` : `Logged ${what}, split ${names.length} ways: ${list}.`;
}

/** The asker's own text wins ("just me and Dev"): their open Polls of this kind close without acting. */
export async function closePollsFor(groupId: string, kind: string, opts: { by?: string } = {}, now = new Date()): Promise<number> {
  const open = await db.select().from(polls).where(and(eq(polls.groupId, groupId), eq(polls.kind, kind), isNull(polls.resolvedAt)));
  let closed = 0;
  for (const p of open) {
    const payer = (p.about as { payerId?: string }).payerId;
    if (opts.by && p.createdBy !== opts.by && payer !== opts.by) continue;
    if ((await db.update(polls).set({ resolvedAt: now }).where(and(eq(polls.id, p.id), isNull(polls.resolvedAt))).returning({ id: polls.id })).length) closed++;
  }
  return closed;
}

/** The scheduler: every open Poll past its 2 hours resolves with whatever votes it has. Paused Groups wait. */
export async function expirePolls(now = new Date(), paused: ReadonlySet<string> = new Set()): Promise<number> {
  const due = await db.select({ id: polls.id, groupId: polls.groupId }).from(polls).where(and(isNull(polls.resolvedAt), lte(polls.resolvesAt, now)));
  let n = 0;
  for (const p of due) {
    if (paused.has(p.groupId)) continue;
    await resolvePoll(p.id, "expired", now);
    n++;
  }
  return n;
}
