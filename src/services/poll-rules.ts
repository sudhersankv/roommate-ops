// Polls, pure (ADR 0018): when one resolves, who's in on a "who-in" Expense, and a bare-number reply read as a vote.
// No DB import: polls.ts and the tests use these.

/** A Poll resolves on its own after this long (whoever voted by then counts). */
export const POLL_TTL_MS = 2 * 60 * 60 * 1000;
/** Who-questions only, and short: at most this many options. */
export const MAX_POLL_OPTIONS = 4;

/** Distinct voters that resolve a Poll among `activeCount` active Members: more than half (2 of 2, 2 of 3, 3 of 4, 3 of 5). */
export const pollMajority = (activeCount: number) => Math.floor(Math.max(0, activeCount) / 2) + 1;

/** "answered": a confirm poll's asked Member tapped Yes or No. */
export type PollReason = "majority" | "expired" | "closed" | "answered";

/**
 * Whether a Poll resolves now, and why: the asker's own text closed it (it wins), a majority voted, or its 2 hours are
 * up. null = still open.
 */
export function pollOutcome(p: { activeCount: number; voters: number; now: Date; resolvesAt: Date; closed?: boolean }): PollReason | null {
  if (p.closed) return "closed";
  if (p.voters > 0 && p.voters >= pollMajority(p.activeCount)) return "majority";
  if (p.now.getTime() >= p.resolvesAt.getTime()) return "expired";
  return null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ");

/**
 * Who's in on a "who-in" Expense, payer first, then in the Members' order. A voter who picked the "I'm in" option
 * (`inOption`, default the first) is in; an option that is a Member's name puts that Member in. The payer is in unless
 * they voted and picked neither.
 */
export function whoIn(p: {
  options: readonly string[];
  votes: readonly { memberId: string; optionIds: readonly number[] }[];
  members: readonly { id: string; displayName: string }[];
  payerId: string;
  inOption?: number;
}): string[] {
  const inOption = p.inOption ?? 0;
  const byName = new Map(p.members.map((m) => [norm(m.displayName), m.id]));
  const named = p.options.map((o) => byName.get(norm(o)) ?? null);
  const ins = new Set<string>();
  for (const v of p.votes) {
    for (const id of v.optionIds) {
      const member = named[id];
      if (member) ins.add(member);
      else if (id === inOption) ins.add(v.memberId);
    }
  }
  const payerVoted = p.votes.some((v) => v.memberId === p.payerId);
  if (!payerVoted) ins.add(p.payerId);
  const order = [p.payerId, ...p.members.map((m) => m.id).filter((id) => id !== p.payerId)];
  return order.filter((id) => ins.has(id));
}

/** "2", "1 3", "1, 3" from a Member while a text Poll is open -> 0-based option ids; anything else (or out of range) -> null. */
export function numberVote(text: string, optionCount: number, multi: boolean): number[] | null {
  const m = /^\s*(\d{1,2}(?:\s*(?:,|\s|and)\s*\d{1,2})*)\s*[.!]?\s*$/i.exec(text);
  if (!m) return null;
  const ids = [...new Set(m[1].split(/\s*(?:,|\s|and)\s*/i).filter(Boolean).map((n) => Number(n) - 1))];
  if (!ids.length || ids.some((i) => i < 0 || i >= optionCount)) return null;
  if (!multi && ids.length > 1) return null;
  return ids.sort((a, b) => a - b);
}
