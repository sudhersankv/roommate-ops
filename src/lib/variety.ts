// Variety (#70): Roomie doesn't open two replies the same way, or reuse a short stock line, within its last few
// replies. Like slangBudget, the rule is counted in code from Roomie's own recent lines and handed to the model as a
// list ("don't open with these"); the model never judges its own repetition. Pure and client-safe.

/** How many of Roomie's latest replies the rule looks at. */
export const VARIETY_WINDOW = 4;

/** A short stock line: at most this many words ("That's it.", "You're square."). */
const SHORT_LINE_WORDS = 4;

/** Lines that aren't Roomie's own phrasing: a reaction, a tool's ready-made post (the Bundle, a report). */
const NOT_A_REPLY = /^\s*(?:\(reacted\b|\[)/i;

/** A reply that leads with the fact itself (an amount, a date, a time) has no opener to avoid. */
const LEADS_WITH_FACT = /^[\s"'“]*(?:[$€£₹¥]|\d|[A-Z][a-z]{2,8} \d{1,2}\b)/u;

const clean = (s: string) => s.replace(/[\s"'“”]+$/u, "").replace(/^[\s"'“”]+/u, "");
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, "").replace(/\s+/g, " ").trim();
const words = (s: string) => s.split(/\s+/).filter(Boolean);

/**
 * How a reply opens: its first clause when that's 1-3 words ("Logged.", "Got it", "On it!"), else its first two words
 * ("Added milk"). Null for a reply that leads with a fact (an amount, a date, a Member's name: those are the answer,
 * not phrasing) or isn't Roomie's own line.
 */
export function openerOf(reply: string, names: readonly string[] = []): string | null {
  const t = clean(reply.split("\n")[0] ?? "");
  if (!t || NOT_A_REPLY.test(t) || LEADS_WITH_FACT.test(t)) return null;
  const first = words(t)[0]?.replace(/[^\p{L}\p{N}']+$/u, "").replace(/'s$/i, "") ?? "";
  if (names.some((n) => n.toLowerCase() === first.toLowerCase() || n.split(/\s+/)[0]?.toLowerCase() === first.toLowerCase())) return null;
  if (/^(?:you|yours|you're|your)$/i.test(first)) return null;
  const clause = /^[^.,!?:;—–]+[.!?]?/u.exec(t)?.[0] ?? t;
  const w = words(clause);
  const opener = w.length <= 3 ? clause.trim() : w.slice(0, 2).join(" ");
  return key(opener) ? opener.replace(/[,:;]+$/, "") : null;
}

/** A reply's short closing line ("That's it.", "Just talk to me."), when it has one after the first sentence. */
export function shortLineOf(reply: string): string | null {
  const t = reply.trim();
  if (NOT_A_REPLY.test(t)) return null;
  const sentences = t.split(/(?<=[.!?])\s+/u).map(clean).filter(Boolean);
  if (sentences.length < 2) return null;
  const last = sentences.at(-1)!;
  if (LEADS_WITH_FACT.test(last) || words(last).length > SHORT_LINE_WORDS) return null;
  return last;
}

export type Variety = { openers: string[]; lines: string[] };

/**
 * What the next reply must not repeat, from Roomie's replies newest first: the openers and short stock lines of the
 * last VARIETY_WINDOW of them, each once (case and punctuation ignored). `names` are the Group's Members: a reply that
 * opens with a name is an answer ("Dev."), never phrasing to avoid.
 */
export function recentPhrasing(recentReplies: readonly string[], names: readonly string[] = []): Variety {
  const window = recentReplies.slice(0, VARIETY_WINDOW);
  const uniq = (xs: (string | null)[]) => {
    const seen = new Set<string>();
    return xs.filter((x): x is string => !!x && !seen.has(key(x)) && !!seen.add(key(x)));
  };
  return { openers: uniq(window.map((r) => openerOf(r, names))), lines: uniq(window.map(shortLineOf)) };
}
