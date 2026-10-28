// Pure policy for WHEN Roomie speaks. No imports, no DB, unit-tested in router.test.ts; router.ts feeds it facts.
//
//   "reply"  a hard trigger (voice note, reply-to-Roomie, @mention, the word "roomie"): Roomie always answers.
//   "maybe"  attention window: Roomie answered in this chat recently, so this message goes to the model with
//            permission to stay silent (see parseSilent). Costs one LLM call, bounded by the window below.
//   "ignore" everything else: logged as context only.
//
// Attention window = Roomie's last chat reply is <= windowMs old AND fewer than maxFollowUps human messages have
// been logged since it. Both facts come from chat_log, so the window survives restarts and multiple instances.
// Off-by-one: the router logs the message being handled BEFORE deciding, so `humanSinceRoomie` already includes
// it. With maxFollowUps = 4 Roomie therefore weighs the 1st, 2nd and 3rd follow-up (count 1..3); the 4th
// (count 4) closes the window. Roomie's own replies refresh it (a new memberId=null row), so a real back-and-forth
// keeps going; scheduled posts are not logged and never open one.

export type Decision = "reply" | "maybe" | "ignore";

/** The trigger word: "roomie" as a whole word, any case ("Roomie, add milk", "ok roomie?"). */
export const TRIGGER_WORD = /\broomie\b/i;

export const saysRoomie = (text: string) => TRIGGER_WORD.test(text);

export type DecideInput = {
  hardTrigger: boolean;
  /** createdAt of Roomie's last chat_log row (memberId null) in this household, or null if it never spoke. */
  lastRoomieAt: Date | null;
  /** Human chat_log rows after lastRoomieAt, INCLUDING the message being handled. */
  humanSinceRoomie: number;
  now?: Date;
  windowMs?: number;
  maxFollowUps?: number;
};

export const ATTENTION_WINDOW_MS = 180_000;
export const ATTENTION_MAX_FOLLOW_UPS = 4;

export function decideReply({
  hardTrigger,
  lastRoomieAt,
  humanSinceRoomie,
  now = new Date(),
  windowMs = ATTENTION_WINDOW_MS,
  maxFollowUps = ATTENTION_MAX_FOLLOW_UPS,
}: DecideInput): Decision {
  if (hardTrigger) return "reply";
  if (!lastRoomieAt) return "ignore";
  const age = now.getTime() - lastRoomieAt.getTime();
  if (age < 0 || age > windowMs) return "ignore";
  if (humanSinceRoomie >= maxFollowUps) return "ignore";
  return "maybe";
}

/** The exact token the model is told to answer with when a "maybe" message needs no reply. */
export const SILENT = "[silent]";

const LEADING_SILENT = /^[\s\p{P}]*\[silent\]/iu;
const ONLY_FILLER = /^[\s\p{P}]*$/u;

/**
 * Interpret a "maybe" reply. Returns null when Roomie chose silence, otherwise the text to send.
 * - "[silent]", " [SILENT]. ", "*[silent]*" -> null (surrounding whitespace/punctuation tolerated).
 * - "[silent] oh wait, chips are already in the cart" -> "oh wait, chips are already in the cart". Models sometimes
 *   emit the token and then change their mind mid-sentence; the trailing text is the useful part, so we keep it
 *   rather than drop a real answer or post a literal "[silent]" into the group.
 * - anything else is returned trimmed, unchanged.
 */
export function parseSilent(text: string): string | null {
  const m = LEADING_SILENT.exec(text);
  if (!m) return text.trim();
  const rest = text.slice(m[0].length);
  if (ONLY_FILLER.test(rest)) return null;
  return rest.replace(/^[\s\p{P}]+/u, "").trim();
}
