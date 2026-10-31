// DMs, pure (ADR 0020): which Group a DM is about, the "for <group>:" prefix, the Start hint's timing and the Echo
// rule's decision from a run's changes. No DB import: dm.ts and the tests use these.
import { moneyIn } from "./types";

/** A reply within this long of Roomie DMing someone is about the Group that DM came from. */
export const NUDGE_CONTEXT_MS = 24 * 60 * 60 * 1000;
/** At most one "tap @roomie and press Start" line per Member in this long. */
export const START_HINT_MS = 7 * 24 * 60 * 60 * 1000;

export type DmCandidate = { groupId: string; name: string; memberId: string };
export type DmContextRow = { groupId: string; at: Date };

const norm = (s: string) => s.trim().toLowerCase().replace(/[^\p{L}\p{N} ]/gu, " ").replace(/\s+/g, " ").trim();

/** The question when Roomie can't tell: "Apt 4B or Lisbon trip?" (three or more: "Apt 4B, Lisbon trip or Book club?"). */
export function whichGroupQuestion(names: readonly string[]): string {
  const list = names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
  return `Which group is this about: ${list}?`;
}

/** A reply that names one of the Groups ("lisbon", "Apt 4B", "the lisbon one") -> that Group, else null. */
export function matchGroupName(text: string, candidates: readonly DmCandidate[]): DmCandidate | null {
  const said = norm(text).replace(/^(?:the|for|in|about)\s+/, "").replace(/\s+(?:one|group|chat)$/, "");
  if (!said) return null;
  const exact = candidates.filter((c) => norm(c.name) === said);
  if (exact.length === 1) return exact[0];
  // A word of the name ("lisbon" for "Lisbon trip"), when only one Group has it.
  const partial = candidates.filter((c) => said.length >= 3 && (norm(c.name).split(" ").includes(said) || norm(c.name).startsWith(said)));
  return partial.length === 1 ? partial[0] : null;
}

/** "for Lisbon: what do I owe" -> the Group and the rest of the message; no prefix (or no such Group) -> null. */
export function groupPrefix(text: string, candidates: readonly DmCandidate[]): { group: DmCandidate; rest: string } | null {
  const m = /^\s*(?:for|in|re)\s+([^:]{1,60}?)\s*:\s*(.*)$/is.exec(text);
  if (!m) return null;
  const group = matchGroupName(m[1], candidates);
  return group ? { group, rest: m[2].trim() } : null;
}

export type DmPick = { groupId: string; via: "prefix" | "nudge" | "dm" | "only" } | { ask: string };

/**
 * Which Group a DM is about, in order: a "for <group>:" prefix (handled by the caller), the Group Roomie last DM'd
 * this person about within 24 h (a reply to a nudge), the Group they last DM'd about, their only Group, else ask once.
 * Context rows for Groups they're no longer in are ignored.
 */
export function pickDmGroup(p: { candidates: readonly DmCandidate[]; nudge?: DmContextRow | null; lastDm?: DmContextRow | null; now: Date }): DmPick {
  const ids = new Set(p.candidates.map((c) => c.groupId));
  if (p.nudge && ids.has(p.nudge.groupId) && p.now.getTime() - p.nudge.at.getTime() <= NUDGE_CONTEXT_MS) return { groupId: p.nudge.groupId, via: "nudge" };
  if (p.lastDm && ids.has(p.lastDm.groupId)) return { groupId: p.lastDm.groupId, via: "dm" };
  if (p.candidates.length === 1) return { groupId: p.candidates[0].groupId, via: "only" };
  return { ask: whichGroupQuestion(p.candidates.map((c) => c.name)) };
}

/** Whether the neutral "press Start" line may go out again (never sent, or more than 7 days ago). */
export const startHintDue = (lastAt: string | Date | null | undefined, now: Date) => !lastAt || now.getTime() - new Date(lastAt).getTime() >= START_HINT_MS;

/** The one neutral group line for someone Roomie can't DM yet: no amount, no subject. */
export const startHint = (name: string, handle?: string) =>
  handle ? `${name}, I've got something for you; tap @${handle} and press Start.` : `${name}, I've got something for you; open a chat with me and press Start.`;

/* ---------- the Echo rule ---------- */

/** One Activity row of a private run (a DM or the dashboard), with what the Echo rule needs to know about it. */
export type RunChange = {
  kind: string;
  actorId: string;
  actorName: string;
  summary: string;
  /** For expense.* rows: the Expense as it is now (a deleted one keeps its Shares). */
  expense?: { description: string; cents: number; shareCount: number };
  /** For settlement.* rows. */
  settlement?: { fromId: string; fromName: string; toId: string; toName: string; cents: number };
};

export type AfterPrivateRun = {
  /** The one group line, or null when nothing shared moved. */
  echo: string | null;
  /** One private line each to the other person in a Settlement. */
  privately: { memberId: string; text: string }[];
};

/**
 * The Echo rule (ADR 0020): a change to an Expense with more than one Member in its Shares is echoed to the group as
 * one line; a Settlement never is (the other person gets a private line instead); anything else (a personal Cart
 * item, a reminder for me, a fact about me) stays private.
 */
export function afterPrivateRun(changes: readonly RunChange[], currency = "USD"): AfterPrivateRun {
  const dollars = moneyIn(currency);
  const parts: string[] = [];
  let actor: string | null = null;
  const privately: { memberId: string; text: string }[] = [];
  for (const c of changes) {
    if (c.kind.startsWith("expense.") && c.expense && c.expense.shareCount > 1) {
      actor ??= c.actorName;
      parts.push(c.kind === "expense.added" ? `logged ${dollars(c.expense.cents)} ${c.expense.description}, split ${c.expense.shareCount} ways` : c.summary);
    } else if (c.kind.startsWith("settlement.") && c.settlement) {
      const s = c.settlement;
      const other = s.toId !== c.actorId ? s.toId : s.fromId;
      if (other === c.actorId) continue;
      const text = other === s.toId ? `${s.fromName} paid you ${dollars(s.cents)}.` : `${c.actorName} noted you paid them ${dollars(s.cents)}.`;
      privately.push({ memberId: other, text });
    }
  }
  return { echo: parts.length ? `${actor} ${parts.join("; ")}.` : null, privately };
}
