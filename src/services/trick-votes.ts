// Trick votes: "I want this" on a coming-soon Trick (a Toolkit with status "coming-soon") on the landing page
// (docs/landing.md), and on a Channel that isn't built yet (the channel strip: Discord, iMessage). Anyone can vote;
// one row per vote in trick_votes, the IP only as an HMAC. No Group, no Account.
import { count, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { WindowLimiter } from "@/lib/window-limit";
import { CATALOG } from "@/toolkits/manifests";
import { hashIp } from "./beta";

/** At most 12 votes an hour from one address, and one per Trick per address a day. In memory: a restart forgets. */
export const VOTE_LIMIT = { max: 12, windowMs: 60 * 60 * 1000 };
export const VOTE_PER_TRICK = { max: 1, windowMs: 24 * 60 * 60 * 1000 };
/** Counts show on the page only from this many votes up (a lone "1 wants this" reads as nobody). */
export const SHOW_COUNT_FROM = 5;

/** Channels people can vote for, as `channel:<id>` rows next to the Tricks (ADR 0015: Discord and iMessage are Soon). */
export const SOON_CHANNELS = [
  { id: "channel:discord", name: "Discord" },
  { id: "channel:imessage", name: "iMessage" },
] as const;
export type SoonChannelId = (typeof SOON_CHANNELS)[number]["id"];

/** Everything "I want this" accepts: the coming-soon Tricks, then the Channels that aren't built yet. */
export const votableTrickIds = (): string[] => [...CATALOG.filter((m) => m.status === "coming-soon").map((m) => m.id), ...SOON_CHANNELS.map((c) => c.id)];

export type VoteResult = { ok: true; counted: boolean } | { ok: false; reason: "unknown_trick" | "rate_limited" | "failed"; message: string };

export type VoteDeps = {
  limiter?: WindowLimiter;
  perTrick?: WindowLimiter;
  insert?: (row: typeof schema.trickVotes.$inferInsert) => Promise<void>;
};

const limiters = () => {
  const g = globalThis as { __roomieVoteLimiters?: { ip: WindowLimiter; trick: WindowLimiter } };
  return (g.__roomieVoteLimiters ??= { ip: new WindowLimiter(VOTE_LIMIT.max, VOTE_LIMIT.windowMs), trick: new WindowLimiter(VOTE_PER_TRICK.max, VOTE_PER_TRICK.windowMs) });
};

const insertRow = async (row: typeof schema.trickVotes.$inferInsert) => void (await db.insert(schema.trickVotes).values(row));

/**
 * One vote for a coming-soon Trick. A second vote from the same address for the same Trick that day is a quiet
 * success that isn't stored (`counted: false`), so a double tap never shows an error. Never throws.
 */
export async function voteForTrick(trickId: unknown, meta: { ip: string }, deps: VoteDeps = {}): Promise<VoteResult> {
  if (typeof trickId !== "string" || !votableTrickIds().includes(trickId)) return { ok: false, reason: "unknown_trick", message: "That Trick isn't on the list." };
  const ipHash = hashIp(meta.ip);
  const l = limiters();
  if (!(deps.perTrick ?? l.trick).take(`${ipHash}:${trickId}`)) return { ok: true, counted: false };
  if (!(deps.limiter ?? l.ip).take(ipHash)) {
    console.log(`[votes] rate limited ip=${ipHash.slice(0, 8)}`);
    return { ok: false, reason: "rate_limited", message: "That's a lot of votes from here. Try again in an hour." };
  }
  try {
    await (deps.insert ?? insertRow)({ trickId, ipHash });
  } catch (e) {
    console.error("[votes] couldn't save a vote:", e instanceof Error ? e.message : e);
    return { ok: false, reason: "failed", message: "That didn't save. Try again in a minute." };
  }
  console.log(`[votes] +1 ${trickId}`);
  return { ok: true, counted: true };
}

/** Votes per coming-soon Trick and Channel (`channel:…`). An empty map when the database can't be reached: the page still renders. */
export async function trickVoteCounts(): Promise<Record<string, number>> {
  try {
    const rows = await db
      .select({ trickId: schema.trickVotes.trickId, n: count() })
      .from(schema.trickVotes)
      .where(inArray(schema.trickVotes.trickId, votableTrickIds()))
      .groupBy(schema.trickVotes.trickId);
    return Object.fromEntries(rows.map((r) => [r.trickId, Number(r.n)]));
  } catch (e) {
    console.warn("[votes] counts unavailable:", e instanceof Error ? e.message : e);
    return {};
  }
}

/** The count to show, or null below SHOW_COUNT_FROM. */
export const shownCount = (n: number | undefined): number | null => (n && n >= SHOW_COUNT_FROM ? n : null);
