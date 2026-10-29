// Pure helpers for the Group style note (jobs/style-note.ts). The note is the "## Group style" section of
// Roomie's working memory for a Group; everything else in working memory (Member notes) is left untouched.

/** Refresh after this many new chat lines since the last refresh. */
export const STYLE_EVERY = 50;

export const shouldRefreshStyle = (linesSinceLast: number) => linesSinceLast >= STYLE_EVERY;

/**
 * Replace the body of `heading` in a Markdown working-memory block (up to the next "#"/"##" heading), or append the
 * section when it's missing. `section` is the new body without the heading.
 */
export function replaceSection(markdown: string, heading: string, section: string): string {
  const body = section.trim();
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
  if (start === -1) return `${markdown.trimEnd()}\n\n${heading}\n${body}\n`;
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end === -1) end = lines.length;
  return [...lines.slice(0, start + 1), body, "", ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Drop the "- Name: ..." lines for one Member from a Member notes section ("forget me"). Case-insensitive. */
export function dropMemberLines(section: string, name: string): string {
  const who = name.trim().toLowerCase();
  return section
    .split("\n")
    .filter((l) => !l.trim().toLowerCase().replace(/^[-*]\s*/, "").replace(/^\[|\]/g, "").startsWith(`${who}:`))
    .join("\n");
}

/**
 * Whether a Group style note says the chat is casual (then the Group Report reads as sentences, not a list). Needs a
 * little confidence first, so a fresh Group gets the default look.
 */
export function isCasualStyle(section: string): boolean {
  const tone = /^\s*[-*]?\s*tone:\s*(.*)$/im.exec(section)?.[1] ?? "";
  const confidence = Number(/confidence[^:]*:\s*([\d.]+)/i.exec(section)?.[1] ?? 0);
  if (confidence < 0.3 || /\b(formal|professional|polite)\b/i.test(tone)) return false;
  return /\b(casual|chill|laid[- ]?back|relaxed|informal|playful|banter|teasing|jokey|goofy|lowercase|slangy)\b/i.test(tone);
}

/** The body of `heading`, or "" when missing. */
export function readSection(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === heading.toLowerCase());
  if (start === -1) return "";
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}
