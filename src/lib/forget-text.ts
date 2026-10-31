// Pure text helpers for "forget me" (services/members.ts, mastra/forget.ts): which lines came from a person, what a
// line said without its sender tag, the photos it points at, and names swapped for "Former member".

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Roomie's input lines look like "[Name] text" or "[voice note from Name] text" (pipeline.ts). */
export const isLineFrom = (text: string, name: string) => {
  const t = text.trimStart().toLowerCase();
  const n = name.trim().toLowerCase();
  return !!n && (t.startsWith(`[${n}]`) || t.startsWith(`[voice note from ${n}]`));
};

/** The sender a memory line is tagged with ("Maya" for "[Maya] hi"), or null. */
export const senderOf = (text: string): string | null => {
  const m = /^\s*\[(?:voice note from )?([^\]]+)\]/i.exec(text);
  return m ? m[1].trim() : null;
};

/**
 * What was said, without the sender tag, the photo tag or the chat log's "(voice)" / "(photo)" marker, so a memory line
 * ("[Maya] [photo: /uploads/x.jpg] split this") and its chat_messages row ("(photo) [photo: /uploads/x.jpg] split this",
 * or "(photo) split this" for a photo nobody fetched) compare equal.
 */
export const lineBody = (text: string) =>
  text
    .trim()
    .replace(/^\[(?:voice note from )?(?!photo: )[^\]]+\]\s*/i, "")
    .replace(/^\((?:voice|photo)\)\s*/i, "")
    .replace(/^\[photo: [^\]]*\]\s*/i, "")
    .trim();

/** The photo URLs a memory line carries ("[photo: <url>]"). */
export const photoUrls = (text: string): string[] => [...text.matchAll(/\[photo: ([^\]\s]+)\]/gi)].map((m) => m[1]);

/** Whether `text` names `name` as a whole word (any case). Names under 2 characters never match. */
export const mentions = (text: string, name: string) => mentionsAny(text, [name]);

/**
 * The names that are only this person's: other Members' names (`keep`) win. A name someone else also has is dropped
 * (we can't tell them apart), and so is anything under 2 characters or the replacement itself.
 */
const ownNames = (names: string[], keep: string[], replacement?: string) => {
  const others = new Set(keep.map((k) => k.trim().toLowerCase()));
  return [...new Set(names.map((n) => n.trim()))].filter((n) => n.length >= 2 && n !== replacement && !others.has(n.toLowerCase()));
};

/**
 * One regex over `names` and `keep`, longest first, so another Member's longer name ("Alex K") is matched whole
 * before the forgotten "Alex" can match inside it. A forgotten name matches as a named group.
 */
function nameRegex(names: string[], keep: string[]): RegExp | null {
  if (!names.length) return null;
  const all = [...names.map((n) => ({ n, mine: true })), ...keep.map((n) => n.trim()).filter((n) => n.length >= 2).map((n) => ({ n, mine: false }))].sort((a, b) => b.n.length - a.n.length);
  const alt = all.map((x, i) => (x.mine ? `(?<m${i}>${escape(x.n)})` : escape(x.n))).join("|");
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alt})(?![\\p{L}\\p{N}])`, "giu");
}

const isMine = (groups: Record<string, string | undefined> | undefined) => !!groups && Object.values(groups).some((v) => v !== undefined);

/** Whether `text` names any of `names` as a whole word (any case), not counting other Members' names in `keep`. */
export function mentionsAny(text: string, names: string[], keep: string[] = []): boolean {
  const re = nameRegex(ownNames(names, keep), keep);
  if (!re) return false;
  for (const m of text.matchAll(re)) if (isMine(m.groups)) return true;
  return false;
}

/** Every whole-word mention of any of `names` replaced (longest first); other Members' names in `keep` are left alone. */
export function anonymize(text: string, names: string[], replacement: string, keep: string[] = []): string {
  const re = nameRegex(ownNames(names, keep, replacement), keep);
  if (!re) return text;
  return text.replace(re, (...args) => {
    const groups = args.at(-1) as Record<string, string | undefined>;
    return isMine(groups) ? replacement : (args[0] as string);
  });
}
