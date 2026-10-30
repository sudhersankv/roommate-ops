// Replies that feel typed by a person: a short "typing…" first, and longer replies in two or three bubbles instead of
// one block. Pure: the adapters (telegram.ts, whatsapp.ts) call planDelivery() and do the waiting and sending.
// Only chat replies go through this; scheduled posts (reports, reminders) are sent as one message.

export type Bubble = { text: string; /** How long to show "typing…" before this bubble. */ typingMs: number };

export const HUMANIZE = {
  /** Thinking time before the first bubble, on top of per-character typing. */
  baseMs: 900,
  /** Typing speed: ms per character (about 30 wpm, fast for a phone). */
  perCharMs: 28,
  minMs: 1200,
  maxFirstMs: 4000,
  /** Later bubbles only get the between-bubble pause range, so a 3-bubble reply never crawls. */
  minBetweenMs: 800,
  maxBetweenMs: 1800,
  /** Never more bubbles than this; the rest is glued onto the last one. */
  maxBubbles: 3,
  /** Aim for bubbles at most this long; a single sentence longer than this stays whole. */
  bubbleChars: 160,
  /** Replies at or under this length are one bubble, whatever their punctuation. */
  oneBubbleChars: 90,
  /** Hard cap on the whole delivery (typing + pauses), so a slow reply never looks stuck. */
  totalCapMs: 10_000,
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Typing time for the first bubble: thinking + typing, clamped. */
export function typingDelayMs(text: string, o = HUMANIZE): number {
  return clamp(o.baseMs + text.length * o.perCharMs, o.minMs, o.maxFirstMs);
}

/** Between bubbles: typing the next one, clamped to a short pause. */
export function betweenDelayMs(text: string, o = HUMANIZE): number {
  return clamp(text.length * o.perCharMs, o.minBetweenMs, o.maxBetweenMs);
}

const URL = /https?:\/\/\S+/;
/** Sentence ends, keeping decimals ("$12.50"), initials ("e.g.") and numbered items ("1. dishes") together. */
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z0-9"“(])|(?<=[.!?])\s+(?=[a-z])/g;

/**
 * Split a reply into bubbles. Rules: a short reply is one bubble; explicit paragraphs (blank lines) always split; a
 * line that is a bare link stands alone; otherwise split at sentence ends, packing sentences up to `bubbleChars`;
 * never more than `maxBubbles` (extra text joins the last bubble). Multi-line lists stay in one bubble.
 */
export function splitBubbles(text: string, o = HUMANIZE): string[] {
  const whole = text.trim();
  if (!whole) return [];
  if (whole.length <= o.oneBubbleChars && !/\n\s*\n/.test(whole)) return [whole];

  const paragraphs = whole.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const p of paragraphs) {
    // A list or anything with line breaks is one bubble; a lone link too.
    if (p.includes("\n") || (URL.test(p) && p.split(/\s+/).length <= 3)) {
      pieces.push(p);
      continue;
    }
    // Pull a trailing link onto its own bubble so the text before it reads as a sentence.
    const m = /^(.*[.!?])\s+([^.!?\n]*https?:\/\/\S+)$/s.exec(p);
    const body = m ? m[1].trim() : p;
    const link = m ? m[2].trim() : null;
    const sentences = body.split(SENTENCE_END).map((s) => s.trim()).filter(Boolean);
    let cur = "";
    for (const s of sentences) {
      if (!cur) cur = s;
      else if ((cur + " " + s).length <= o.bubbleChars) cur = `${cur} ${s}`;
      else {
        pieces.push(cur);
        cur = s;
      }
    }
    if (cur) pieces.push(cur);
    if (link) pieces.push(link);
  }
  if (pieces.length <= o.maxBubbles) return pieces;
  return [...pieces.slice(0, o.maxBubbles - 1), pieces.slice(o.maxBubbles - 1).join("\n")];
}

/** The delivery plan: bubbles with their typing delays, total capped so a reply never looks stuck. */
export function planDelivery(text: string, o = HUMANIZE): Bubble[] {
  const parts = splitBubbles(text, o);
  const plan = parts.map((t, i) => ({ text: t, typingMs: i === 0 ? typingDelayMs(t, o) : betweenDelayMs(t, o) }));
  const total = plan.reduce((s, b) => s + b.typingMs, 0);
  if (total <= o.totalCapMs) return plan;
  const scale = o.totalCapMs / total;
  return plan.map((b) => ({ ...b, typingMs: Math.round(b.typingMs * scale) }));
}
