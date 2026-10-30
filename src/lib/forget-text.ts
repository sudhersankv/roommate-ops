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
 * ("[Maya] [photo: /uploads/x.jpg] split this") and its chat_messages row ("(photo) split this") compare equal.
 */
export const lineBody = (text: string) =>
  text
    .trim()
    .replace(/^\[(?:voice note from )?[^\]]+\]\s*/i, "")
    .replace(/^\[photo: [^\]]*\]\s*/i, "")
    .replace(/^\((?:voice|photo)\)\s*/i, "")
    .trim();

/** The photo URLs a memory line carries ("[photo: <url>]"). */
export const photoUrls = (text: string): string[] => [...text.matchAll(/\[photo: ([^\]\s]+)\]/gi)].map((m) => m[1]);

/** Whether `text` names `name` as a whole word (any case). Names under 2 characters never match. */
export const mentions = (text: string, name: string) => {
  const n = name.trim();
  return n.length >= 2 && new RegExp(`(?<![\\p{L}\\p{N}])${escape(n)}(?![\\p{L}\\p{N}])`, "iu").test(text);
};

/** Every whole-word mention of any of `names` replaced (longest first, so "Maya R" goes before "Maya"). */
export function anonymize(text: string, names: string[], replacement: string): string {
  const list = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2 && n !== replacement))].sort((a, b) => b.length - a.length);
  if (!list.length) return text;
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${list.map(escape).join("|")})(?![\\p{L}\\p{N}])`, "giu"), replacement);
}
