// Reactions (#77): a message that only reports something Roomie has now recorded ("trash done", "paid her back") gets
// an emoji on that message instead of a line. The record is made either way; the reaction is only how Roomie answers.
//
// Who decides, in order (pure, so the pipeline and the tests share it):
//   1. The tool. A write whose result needs no answer says so with `react: "✅"` on its result (choreDoneReaction,
//      settledReaction below). Anything worth saying (a new chore on the chart, money still owed) leaves it off.
//   2. The guard (reactionOffer). The run may react only when EVERY write in it offered a reaction and none failed or
//      was refused; a read, an error, a refusal or a link anywhere in the run means a reply.
//   3. The reply (answerFor). Roomie answers exactly "[react]" (the skills say when), says nothing, or only a bare
//      confirmation ("Done.", "Got it."): with an offer, that becomes the reaction. Anything else it wrote is sent as
//      text. A win cheer (a streak milestone, everyone square) rides along as the line next to the reaction.
//   Without an offer, "[react]" or nothing is the plain 👍 line, as an empty reply always was.

/** The token Roomie answers with when the reaction says it all. */
export const REACT = "[react]";
/** A chore (or anything) done. Telegram has no ✅ among its reactions: its adapter sends 👌 for it. */
export const DONE = "✅";
/** A payment noted, an "ok". */
export const OK = "👍";

/** One tool call of the run and what it returned (a thrown error comes back as an object with `error`). */
export type Outcome = { tool: string; result: unknown };

/** Mastra's own bookkeeping: not a write anyone asked for. */
const BOOKKEEPING = new Set(["updateWorkingMemory"]);

/** A result that failed, was refused, or wants something from the person: never a reaction. */
const FAILED_KEYS = ["error", "notAllowed", "refused", "needsClarification", "askFirst", "questions"];

/** log_chore: a done on a chore that was already on the chart needs no line (a new one is news: "Added trash."). */
export const choreDoneReaction = (r: { added: boolean }): string | undefined => (r.added ? undefined : DONE);

/** settle_up with paid=true: the two are square now. Money still owed after it is worth a line. */
export const settledReaction = (r: { square: boolean }): string | undefined => (r.square ? OK : undefined);

/**
 * The reaction this run may answer with, or null: at least one write, and every write's result offers `react` with
 * nothing failed, refused, asked or linked. The first offer wins (one reaction per message).
 */
export function reactionOffer(outcomes: readonly Outcome[]): string | null {
  const writes = outcomes.filter((o) => !BOOKKEEPING.has(o.tool));
  if (!writes.length) return null;
  let emoji: string | null = null;
  for (const o of writes) {
    const r = o.result;
    if (!r || typeof r !== "object") return null;
    const rec = r as Record<string, unknown>;
    if (typeof rec.react !== "string" || !rec.react) return null;
    if (FAILED_KEYS.some((k) => rec[k] !== undefined && rec[k] !== false && rec[k] !== null)) return null;
    if (Array.isArray(rec.links) && rec.links.length) return null;
    emoji ??= rec.react;
  }
  return emoji;
}

const LEADING_REACT = /^[\s\p{P}]*\[react(?:\s+[^\]]*)?\]/iu;
/** A confirmation that only restates the write: a word or two and nothing else. */
const BARE_ACK = /^(?:(?:done|got it|noted|logged|recorded|nice|ok(?:ay)?|on it|sweet|cool|perfect|marked|yep|great)[\s.!]*)+$/iu;
/** Only emoji (and spaces / punctuation). */
const ONLY_EMOJI = /^[\s\p{P}\p{Extended_Pictographic}‍️]+$/u;

/**
 * Whether a reply only restates the write: "[react]" (with nothing after it), empty, a bare confirmation, or only
 * emoji. Returns the text that's left to send when "[react]" was followed by something after all ("[react] wait,
 * which trash?" -> "wait, which trash?").
 */
export function readReply(reply: string): { restates: boolean; rest: string } {
  const t = reply.trim();
  const m = LEADING_REACT.exec(t);
  if (m) {
    const rest = t.slice(m[0].length).replace(/^[\s\p{P}]+/u, "").trim();
    return rest ? { restates: false, rest } : { restates: true, rest: "" };
  }
  if (!t || BARE_ACK.test(t) || ONLY_EMOJI.test(t)) return { restates: true, rest: "" };
  return { restates: false, rest: t };
}

/** What a run sends back: text (maybe empty) and maybe a reaction on the message it answers. */
export type Answer = { text: string; react?: string };

/**
 * The run's answer from its reply, its reaction offer (reactionOffer) and its win cheer, if any. `ack` is what an
 * empty reply sends without a reaction (the pipeline's 👍 line).
 */
export function answerFor(i: { reply: string; offer: string | null; cheer?: string | null; ack: string }): Answer {
  const { restates, rest } = readReply(i.reply);
  const cheer = i.cheer?.trim() || "";
  if (restates && i.offer) return cheer ? { text: cheer, react: i.offer } : { text: "", react: i.offer };
  const text = restates ? (/^\s*$/.test(i.reply) || LEADING_REACT.test(i.reply.trim()) ? i.ack : i.reply.trim()) : rest;
  return { text: cheer ? `${text} ${cheer}` : text };
}

/** How a reaction shows in the chat log, Roomie's last replies and dev-chat: "(reacted ✅)". */
export const reactedLine = (emoji: string) => `(reacted ${emoji})`;
