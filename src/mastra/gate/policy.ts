// Pure policy for WHEN Roomie speaks (the Gate, ADR 0002). No imports with side effects, no DB, no network;
// unit-tested in gate.test.ts with recorded Jev answers. gate/index.ts feeds it facts.
//
// Order:
//   1. Hard trigger (reply to Roomie, @mention, the word "roomie", the dashboard): always speak. A voice note is
//      not one by itself: it's transcribed only when addressed (or in the follow-up window), and then counts like text.
//   2. Jev unavailable (error or > 2.5 s): hard triggers only, so stay quiet. Roomie never goes silent on a direct
//      call and never spams on an outage.
//   3. p(act) clears the Group's Chattiness threshold: act.
//   4. Follow-up window (Roomie spoke recently): unless Jev is fairly sure it's chatter between people, the agent
//      sees the message with permission to answer "[silent]" (the last-resort path from the old router).
//   5. p(clarify) clears its threshold: clarify (ask one question, log nothing yet).
//   6. Otherwise: logged as context, no reply.
// "unprompted" = nobody addressed Roomie and it's not a follow-up: the agent asks before logging anything.
import type { GateToolkit } from "../context";
import { saysName } from "@/lib/personality";

export type Chattiness = "quiet" | "normal" | "chatty";
export const CHATTINESS: readonly Chattiness[] = ["quiet", "normal", "chatty"];

/** Minimum p(act) / p(clarify) for Roomie to speak up when nobody called it. */
export const THRESHOLDS: Record<Chattiness, { act: number; clarify: number }> = {
  quiet: { act: 0.9, clarify: 0.8 },
  normal: { act: 0.75, clarify: 0.6 },
  chatty: { act: 0.6, clarify: 0.45 },
};

/** Narrow the agent's tools to Jev's toolkit only when it is at least this sure; otherwise give it everything. */
export const TOOLKIT_MIN = 0.6;
/** Jev's "addressed" score at or above this counts as talking to Roomie. */
export const ADDRESSED_MIN = 0.5;
/** In the follow-up window, p(ignore) at or above this skips the agent call. */
export const WINDOW_IGNORE_MAX = 0.5;

export type Intent = "act" | "clarify" | "chat" | "ignore";

export type JevAnswers = {
  intent: Record<Intent, number>;
  addressed: number;
  toolkit: { choice: GateToolkit; p: number };
};

export type GateFacts = {
  hardTrigger: boolean;
  inWindow: boolean;
  jev: JevAnswers | null;
  chattiness: Chattiness;
};

export type GateDecision = {
  speak: boolean;
  decision: "act" | "clarify" | "maybe" | "ignore";
  /** "paused" / "capped" / "media" never come from decideGate: the pipeline stopped before the Gate (lib/caps.ts,
   * /admin/groups, a photo or voice note nobody addressed to Roomie). */
  reason: "hard-trigger" | "jev-unavailable" | "jev-act" | "jev-clarify" | "follow-up" | "jev-ignore" | "paused" | "capped" | "media";
  unprompted: boolean;
  mayStaySilent: boolean;
  toolkit?: GateToolkit;
};

export function decideGate({ hardTrigger, inWindow, jev, chattiness }: GateFacts): GateDecision {
  const toolkit = jev && jev.toolkit.p >= TOOLKIT_MIN && jev.toolkit.choice !== "none" ? jev.toolkit.choice : undefined;
  const quiet = (reason: GateDecision["reason"]): GateDecision => ({ speak: false, decision: "ignore", reason, unprompted: false, mayStaySilent: false });

  if (hardTrigger) return { speak: true, decision: "act", reason: "hard-trigger", unprompted: false, mayStaySilent: false, toolkit };
  if (!jev) return quiet("jev-unavailable");

  const t = THRESHOLDS[chattiness] ?? THRESHOLDS.normal;
  const unprompted = !inWindow && jev.addressed < ADDRESSED_MIN;
  if (jev.intent.act >= t.act) return { speak: true, decision: "act", reason: "jev-act", unprompted, mayStaySilent: false, toolkit };
  // In the window the agent has the thread and decides itself (it may still ask); outside it, clarify means "ask".
  if (inWindow && (jev.addressed >= ADDRESSED_MIN || jev.intent.ignore < WINDOW_IGNORE_MAX)) {
    return { speak: true, decision: "maybe", reason: "follow-up", unprompted: false, mayStaySilent: true, toolkit };
  }
  if (jev.intent.clarify >= t.clarify) return { speak: true, decision: "clarify", reason: "jev-clarify", unprompted, mayStaySilent: false, toolkit };
  return quiet("jev-ignore");
}

/* ---------- facts the pipeline computes from chat_log (moved from router-policy.ts) ---------- */

/** The trigger word: "roomie" as a whole word, any case ("Roomie, add milk", "ok roomie?"). */
export const TRIGGER_WORD = /\broomie\b/i;
export const saysRoomie = (text: string) => TRIGGER_WORD.test(text);
/** "roomie" always works; so does the name the Group gave its pet ("Dino, add milk"). */
export const callsPet = (text: string, petName?: string) => saysRoomie(text) || (!!petName && saysName(text, petName));

/**
 * The message-level hard triggers: anything that isn't a group Chat line (a DM, the dashboard), /pet, a reply to
 * Roomie, an @mention, "roomie" or the pet's name. A voice note isn't one by itself (audit H2): one replying to Roomie
 * still is, through isReplyToRoomie, and so is a transcript that says "roomie".
 */
export function isHardTrigger(m: { groupChat: boolean; petted?: boolean; isReplyToRoomie?: boolean; mentionsRoomie?: boolean; isVoice?: boolean; text: string; petName?: string }): boolean {
  return !m.groupChat || !!m.petted || !!m.isReplyToRoomie || !!m.mentionsRoomie || callsPet(m.text, m.petName);
}

export const FOLLOW_UP_WINDOW_MS = 180_000;
export const FOLLOW_UP_MAX = 4;

/**
 * Follow-up window = Roomie's last chat reply is <= windowMs old AND fewer than maxFollowUps human messages have
 * been logged since it. Both facts come from chat_log, so the window survives restarts and multiple instances.
 * Off-by-one: the pipeline logs the message being handled BEFORE deciding, so `humanSinceRoomie` already includes
 * it. With maxFollowUps = 4 the 1st, 2nd and 3rd follow-up (count 1..3) are in the window; the 4th closes it.
 * Roomie's own replies refresh it (a new memberId=null row); scheduled posts are not logged and never open one.
 */
export function inFollowUpWindow({
  lastRoomieAt,
  humanSinceRoomie,
  now = new Date(),
  windowMs = FOLLOW_UP_WINDOW_MS,
  maxFollowUps = FOLLOW_UP_MAX,
}: {
  /** createdAt of Roomie's last chat_log row (memberId null), or null if it never spoke. */
  lastRoomieAt: Date | null;
  /** Human chat_log rows after lastRoomieAt, INCLUDING the message being handled. */
  humanSinceRoomie: number;
  now?: Date;
  windowMs?: number;
  maxFollowUps?: number;
}): boolean {
  if (!lastRoomieAt) return false;
  const age = now.getTime() - lastRoomieAt.getTime();
  if (age < 0 || age > windowMs) return false;
  return humanSinceRoomie < maxFollowUps;
}

/* ---------- photos and voice notes (audit H2) ---------- */

export type MediaFacts = {
  kind: "photo" | "voice";
  /** A DM to Roomie: always addressed. */
  isPrivate?: boolean;
  mentionsRoomie?: boolean;
  isReplyToRoomie?: boolean;
  /** The caption (photos; voice notes have none). */
  caption?: string;
  /** The Group's name for its pet, if any. */
  petName?: string;
  /** The follow-up window is open (counting this message). */
  inWindow?: boolean;
  /** Setup is waiting on this sender (an Admin, while Onboarding is open): their messages are for Roomie. */
  setupPending?: boolean;
};

/**
 * Whether Roomie downloads a photo or transcribes a voice note at all. A photo: when its caption or reply addresses
 * Roomie (@mention, reply, "roomie" or the pet's name), or in the follow-up window. A voice note: when it replies to
 * Roomie or @mentions it, in the follow-up window, or when setup is waiting on this Admin. Anything else is logged as
 * "(photo)" / "(voice note)" and goes no further: nothing is stored and nothing goes to the transcriber.
 */
export function mediaWanted(f: MediaFacts): boolean {
  if (f.isPrivate || f.mentionsRoomie || f.isReplyToRoomie || f.inWindow) return true;
  if (f.kind === "photo") return !!f.caption && callsPet(f.caption, f.petName);
  return !!f.setupPending;
}

/* ---------- the [silent] last resort ---------- */

/** The exact token the agent may answer with in the follow-up window when the message needs no reply. */
export const SILENT = "[silent]";

const LEADING_SILENT = /^[\s\p{P}]*\[silent\]/iu;
const ONLY_FILLER = /^[\s\p{P}]*$/u;

/**
 * Interpret a reply. Returns null when Roomie chose silence, otherwise the text to send.
 * - "[silent]", " [SILENT]. ", "*[silent]*" -> null (surrounding whitespace/punctuation tolerated).
 * - "[silent] oh wait, chips are already in the cart" -> "oh wait, chips are already in the cart". Models sometimes
 *   emit the token and then change their mind; the trailing text is the useful part.
 * - anything else is returned trimmed, unchanged.
 */
export function parseSilent(text: string): string | null {
  const m = LEADING_SILENT.exec(text);
  if (!m) return text.trim();
  const rest = text.slice(m[0].length);
  if (ONLY_FILLER.test(rest)) return null;
  return rest.replace(/^[\s\p{P}]+/u, "").trim();
}
