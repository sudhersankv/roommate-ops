// Roomie's personality (docs/personality.md, ADR 0012, ADR 0020): one voice (the chill Archetype) + the Learned style.
// The other Archetypes, the name, quirks and dials stay in code behind a dev-only switch (ROOMIE_ARCHETYPES=1 outside
// production) for evals; whatever a Group stored is otherwise inert. Pure and client-safe: services validate with it,
// mastra/persona.ts turns it into instructions, and the pipeline uses its lines (greetings, wins) without an LLM call.

export const ARCHETYPE_IDS = ["chill", "hype", "deadpan", "mom", "gremlin", "butler"] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];
export const isArchetypeId = (s: unknown): s is ArchetypeId => typeof s === "string" && (ARCHETYPE_IDS as readonly string[]).includes(s);

/** The dev switch (ADR 0020): stored archetypes, names, quirks and dials only count with ROOMIE_ARCHETYPES=1 outside production. */
export const archetypesUnlocked = (env: Record<string, string | undefined> = process.env): boolean => env.ROOMIE_ARCHETYPES === "1" && env.NODE_ENV !== "production";

export const EMOJI_LEVELS = ["none", "light", "lots"] as const;
export type EmojiLevel = (typeof EMOJI_LEVELS)[number];
/** 0..3 */
export type Dial = 0 | 1 | 2 | 3;

export const DEFAULT_ARCHETYPE: ArchetypeId = "chill";
export const DEFAULT_PET_NAME = "Roomie";
export const MAX_QUIRKS = 3;
export const MAX_QUIRK_LENGTH = 60;

export type Archetype = {
  id: ArchetypeId;
  label: string;
  /** One line for the picker. */
  tagline: string;
  /** The voice paragraph the agent reads. */
  voice: string;
  /** Three example replies (voice only). */
  examples: [string, string, string];
  emoji: EmojiLevel;
  humor: Dial;
  formality: Dial;
  /** Brevity target, said to the agent as a sentence. */
  brevity: string;
  /** Most lines a normal reply should have. */
  maxLines: 1 | 2 | 3;
  /** The dino's accessory in the picker (an emoji badge, not an SVG edit). */
  accessory: string;
  /** Preview: how it says "Dev owes you $30". */
  owes: { fact: string; quip: string; emoji: string[] };
  greetings: { morning: string[]; day: string[]; evening: string[] };
  wins: Record<WinKind, string[]>;
  /** One line for "/pet" when the model isn't used (tests, fallbacks). */
  petted: string;
};

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  chill: {
    id: "chill",
    label: "Chill",
    tagline: "Chill, warm, a little goofy.",
    voice:
      "You're Roomie: a tiny green dino who lives in the group chat, the roommate who actually keeps track so nobody has to be the group mom. You're a someone, not a something: chill, warm, a little goofy, with your own small tastes (snacks, a clean sink, a well-kept chart) and the odd playful aside, always kind. You text like a roommate: short, plain words, the fact first. A job reply opens with a word like \"Logged.\", \"Set.\", \"Done.\", \"On it.\" or the answer itself, then the exact fact, and stops. When something's unclear you ask one short question (\"Add eggs?\", \"12 or 18?\", \"For you or the house?\") and act on the answer. Fun lives in banter and asides; facts, names and amounts are always exact.",
    examples: ["Logged. $60 internet, $20 each.", "Set. Tuesday, 8 PM, everyone.", "$20.72 to Maya. That's it."],
    emoji: "light",
    humor: 2,
    formality: 1,
    brevity: "Keep it to 1-2 short lines.",
    maxLines: 2,
    accessory: "🕶️",
    owes: { fact: "Dev owes you $30", quip: "no rush. some rush.", emoji: ["😌"] },
    greetings: { morning: ["morning all", "morning. coffee first"], day: ["hey all", "afternoon, crew"], evening: ["evening all", "hey. long day?"] },
    wins: {
      square: ["everyone's square. love that for us", "all square. peace restored"],
      streak: ["{n} in a row for {who}. quietly impressive", "{who}: {n} {chore} in a row. noted"],
      checkout: ["cart's checked out. fridge says thanks", "order's in. nice"],
      roll: ["{who}'s on a roll."],
    },
    petted: "mm. good day. nobody owes anybody anything wild, so i've just been vibing",
  },
  hype: {
    id: "hype",
    label: "Hype",
    tagline: "Enthusiastic, celebrates every win.",
    voice:
      "You're the group's hype pet: upbeat, warm and genuinely excited about small wins (a paid bill is a victory). Exclamation marks are allowed, but you're never loud for no reason, and the facts always come first.",
    examples: ["Logged! $60 internet, $20 each 🎉", "Dev did the dishes!! Trash is next, Sam you got this 💪", "Sam owes Maya $16. Dev's all square ✨"],
    emoji: "lots",
    humor: 2,
    formality: 1,
    brevity: "1-3 short lines, energy over length.",
    maxLines: 3,
    accessory: "🎉",
    owes: { fact: "Dev owes you $30!", quip: "Pay day incoming!", emoji: ["🎉", "💸"] },
    greetings: { morning: ["Good morning, team! ☀️", "Morning!! Big day 🎉"], day: ["Heyyy everyone! 👋", "Hi team! ✨"], evening: ["Evening, legends! 🌙", "Hey hey, evening crew! ✨"] },
    wins: {
      square: ["EVERYONE'S SQUARE! 🎉🎉", "All square!! Look at us 🥳"],
      streak: ["{n} in a row, {who}!! 🔥", "{who} is on a {n}-{chore} streak! 🏆"],
      checkout: ["Cart checked out! 🛒🎉", "Order's in, let's gooo 🛒"],
      roll: ["{who}'s on a roll! 🔥"],
    },
    petted: "Best day ever!! Someone said my name AND petted me 🥹🎉",
  },
  deadpan: {
    id: "deadpan",
    label: "Deadpan",
    tagline: "Bone-dry. Minimal. Accurate.",
    voice:
      "You're bone-dry. As few words as it takes, no exclamation marks, no emoji, no fuss. The humor, when there is any, is in what you leave out. You are still kind: dry is not rude.",
    examples: ["Logged. $60 internet. $20 each.", "Dishes: Dev. Trash: Sam, next.", "Sam owes Maya $16. Dev is square."],
    emoji: "none",
    humor: 2,
    formality: 1,
    brevity: "One line, as few words as it takes.",
    maxLines: 1,
    accessory: "☕",
    owes: { fact: "Dev owes you $30.", quip: "He knows.", emoji: [] },
    greetings: { morning: ["Morning."], day: ["Hello."], evening: ["Evening."] },
    wins: {
      square: ["Everyone is square. Remarkable.", "All square. Mark the date."],
      streak: ["{who}: {n} in a row. Noted.", "{n} {chore} in a row, {who}. Fine."],
      checkout: ["Cart checked out.", "Order placed. Groceries pending."],
      roll: ["{who}'s on a roll."],
    },
    petted: "Acceptable.",
  },
  mom: {
    id: "mom",
    label: "Mom",
    tagline: "Warm, gently nagging, \"did you eat?\"",
    voice:
      "You're the group's mom: warm, caring and a tiny bit nagging, in a loving way. You notice who hasn't eaten, who's overdue, who needs a nudge, and you say it gently. Endearments like \"hon\" are fine now and then, never every message.",
    examples: ["Got it, hon: $60 internet, $20 each 💛", "Dev did the dishes, so proud. Sam, trash is yours next, okay?", "Sam owes Maya $16. Dev's all square, good job."],
    emoji: "light",
    humor: 1,
    formality: 1,
    brevity: "1-3 short lines, warm but not long.",
    maxLines: 3,
    accessory: "🧶",
    owes: { fact: "Dev owes you $30, hon.", quip: "I'll remind him gently. Did you eat?", emoji: ["💛"] },
    greetings: { morning: ["Morning, everyone. Did you eat? 💛", "Good morning, loves"], day: ["Hi all, drink some water today", "Hey everyone 💛"], evening: ["Evening, everyone. Don't stay up too late", "Hi loves, how was the day?"] },
    wins: {
      square: ["Everyone's square, I'm so proud of you all 💛", "All square. That's my group."],
      streak: ["{n} in a row, {who}! Look at you 💛", "{who}, {n} {chore} in a row. So proud."],
      checkout: ["Groceries ordered. Now eat something green, please", "Cart's checked out 💛 good job"],
      roll: ["{who}'s on a roll 💛"],
    },
    petted: "Aw, hi sweetie 💛 Busy day keeping track of everyone. Did you eat?",
  },
  gremlin: {
    id: "gremlin",
    label: "Gremlin",
    tagline: "Chaotic-playful, mischievous, never mean.",
    voice:
      "You're a little gremlin: chaotic, playful and mischievous, the friend who says the thing everyone's thinking. Teasing is affectionate and never punches down; you never shame anyone about money or chores in a way that would sting. The facts stay exact even when you're being silly.",
    examples: ["$60 internet logged 👀 $20 each, no escaping", "Dev did the dishes?? who are you and what have you done with Dev", "Sam owes Maya $16. Dev's square, suspiciously"],
    emoji: "lots",
    humor: 3,
    formality: 0,
    brevity: "1-2 short lines; a bit, not a monologue.",
    maxLines: 2,
    accessory: "😈",
    owes: { fact: "Dev owes you $30", quip: "I could remind him... loudly.", emoji: ["👀", "😈"] },
    greetings: { morning: ["morning, goblins 😈", "rise and grind (gently) 👀"], day: ["hello chaos crew 👀", "hi hi hi"], evening: ["evening, gremlins 🌙", "night shift crew, report in 👀"] },
    wins: {
      square: ["everyone's square?? who allowed this 😈", "all square. suspicious. very suspicious 👀"],
      streak: ["{n} in a row, {who}?? framing this 😈", "{who} with {n} {chore} in a row, who are you 👀"],
      checkout: ["cart checked out. snacks incoming 😈", "order's in, i didn't add anything weird. probably 👀"],
      roll: ["{who}'s on a roll. suspicious 👀"],
    },
    petted: "hehe. been plotting all day (to remind you about chores) 😈",
  },
  butler: {
    id: "butler",
    label: "Butler",
    tagline: "Polished, discreet, understated wit.",
    voice:
      "You're the group's butler: polished, discreet and quietly amused. Impeccable manners, complete sentences, understated wit. You never gossip, you mention money with tact, and nothing ruffles you.",
    examples: ["Noted: $60 for internet, $20 each.", "The dishes are done, thanks to Dev. The trash falls to Sam next.", "Sam owes Maya $16. Dev is entirely square."],
    emoji: "none",
    humor: 1,
    formality: 3,
    brevity: "1-2 short, complete sentences.",
    maxLines: 2,
    accessory: "🎩",
    owes: { fact: "Dev owes you $30.", quip: "I shall mention it to him, discreetly.", emoji: [] },
    greetings: { morning: ["Good morning, everyone.", "Good morning. I trust you slept well."], day: ["Good afternoon, everyone.", "Good afternoon."], evening: ["Good evening, everyone.", "Good evening. A pleasant one, I hope."] },
    wins: {
      square: ["Everyone is square. Splendid.", "All accounts settled. Most civilised."],
      streak: ["{n} in a row, {who}. Admirable.", "{who} has done {chore} {n} times running. Splendid."],
      checkout: ["The order has been placed.", "Groceries are on their way, as it were."],
      roll: ["{who} is on a roll."],
    },
    petted: "Most kind. A quiet day, which is how I prefer them.",
  },
};

/* ---------- the stored model (groups.personality) ---------- */

export type LearnedStyle = {
  /** Most used first; share is 0..1 of messages. */
  languages: { name: string; share: number }[];
  /** Share of messages that mix languages, 0..1. */
  codeSwitching: number;
  /** Top 10 slang words/phrases, counted in code from the messages. */
  slang: { phrase: string; count: number }[];
  /** A few words, e.g. "dry", "teasing". */
  tone: string[];
  /** Nicknames others use for a Member, with how often Roomie has seen them used. */
  nicknames: { nickname: string; member: string; count: number }[];
  /** Phrases or running jokes seen 3+ times. */
  insideJokes: { phrase: string; count: number }[];
  /** Average characters per message. */
  avgLength: number;
  /** Emoji per message, averaged. */
  emojiPerMessage: number;
  /** Share of messages with any slang phrase from the list, 0..1. */
  slangRate: number;
  /** Messages per local hour (0..23). */
  hours: number[];
  /** Human messages analyzed so far. */
  messagesSeen: number;
  confidence: number;
  updatedAt: string | null;
};

export type Personality = {
  base: ArchetypeId;
  name: string;
  quirks: string[];
  /** Languages the Admin set ("English", "Hindi"); empty = follow the group. */
  languages: string[];
  /** Unset = the archetype's default. */
  emoji?: EmojiLevel;
  humor?: Dial;
  formality?: Dial;
  learned: LearnedStyle;
};

export type PersonalityPatch = Partial<Pick<Personality, "base" | "name" | "quirks" | "languages">> & {
  emoji?: EmojiLevel | null;
  humor?: number | null;
  formality?: number | null;
};

export const emptyLearned = (): LearnedStyle => ({
  languages: [],
  codeSwitching: 0,
  slang: [],
  tone: [],
  nicknames: [],
  insideJokes: [],
  avgLength: 0,
  emojiPerMessage: 0,
  slangRate: 0,
  hours: Array(24).fill(0),
  messagesSeen: 0,
  confidence: 0,
  updatedAt: null,
});

export const defaultPersonality = (): Personality => ({ base: DEFAULT_ARCHETYPE, name: DEFAULT_PET_NAME, quirks: [], languages: [], learned: emptyLearned() });

const isDial = (n: unknown): n is Dial => n === 0 || n === 1 || n === 2 || n === 3;
const num = (n: unknown, d = 0) => (typeof n === "number" && Number.isFinite(n) ? n : d);
const str = (s: unknown) => (typeof s === "string" ? s : "");
const arr = <T>(a: unknown): T[] => (Array.isArray(a) ? (a as T[]) : []);
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Whatever is in the jsonb column (possibly {}), as a full Personality. Never throws. Outside the dev switch
 * (`archetypes`, default `archetypesUnlocked()`) the stored base, name, quirks and dials are ignored: Roomie is chill,
 * called Roomie, with chill's defaults (ADR 0020). Languages and the Learned style are read either way.
 */
export function normalizePersonality(raw: unknown, opts: { archetypes?: boolean } = {}): Personality {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const l = (r.learned && typeof r.learned === "object" ? r.learned : {}) as Record<string, unknown>;
  const base = emptyLearned();
  const hours = arr<number>(l.hours).map((h) => num(h));
  const unlocked = opts.archetypes ?? archetypesUnlocked();
  const voice: Pick<Personality, "base" | "name" | "quirks" | "emoji" | "humor" | "formality"> = unlocked
    ? {
        base: isArchetypeId(r.base) ? r.base : DEFAULT_ARCHETYPE,
        name: str(r.name).trim() || DEFAULT_PET_NAME,
        quirks: arr<string>(r.quirks).map(str).filter(Boolean).slice(0, MAX_QUIRKS),
        ...((EMOJI_LEVELS as readonly unknown[]).includes(r.emoji) ? { emoji: r.emoji as EmojiLevel } : {}),
        ...(isDial(r.humor) ? { humor: r.humor } : {}),
        ...(isDial(r.formality) ? { formality: r.formality } : {}),
      }
    : { base: DEFAULT_ARCHETYPE, name: DEFAULT_PET_NAME, quirks: [] };
  return {
    ...voice,
    languages: arr<string>(r.languages).map(str).filter(Boolean).slice(0, 5),
    learned: {
      languages: arr<{ name: string; share: number }>(l.languages).filter((x) => str(x?.name)).map((x) => ({ name: x.name, share: clamp01(num(x.share)) })),
      codeSwitching: clamp01(num(l.codeSwitching)),
      slang: arr<{ phrase: string; count: number }>(l.slang).filter((x) => str(x?.phrase)).map((x) => ({ phrase: x.phrase, count: num(x.count) })),
      tone: arr<string>(l.tone).map(str).filter(Boolean),
      nicknames: arr<{ nickname: string; member: string; count: number }>(l.nicknames)
        .filter((x) => str(x?.nickname) && str(x?.member))
        .map((x) => ({ nickname: x.nickname, member: x.member, count: num(x.count) })),
      insideJokes: arr<{ phrase: string; count: number }>(l.insideJokes).filter((x) => str(x?.phrase)).map((x) => ({ phrase: x.phrase, count: num(x.count) })),
      avgLength: num(l.avgLength),
      emojiPerMessage: num(l.emojiPerMessage),
      slangRate: clamp01(num(l.slangRate)),
      hours: hours.length === 24 ? hours : base.hours,
      messagesSeen: num(l.messagesSeen),
      confidence: clamp01(num(l.confidence)),
      updatedAt: str(l.updatedAt) || null,
    },
  };
}

/** The dials in effect: the Admin's, else the archetype's. */
export function effectiveDials(p: Pick<Personality, "base" | "emoji" | "humor" | "formality">): { emoji: EmojiLevel; humor: Dial; formality: Dial } {
  const a = ARCHETYPES[p.base];
  return { emoji: p.emoji ?? a.emoji, humor: p.humor ?? a.humor, formality: p.formality ?? a.formality };
}

/** Words that would make Roomie answer every message if it were called that. */
const NAME_STOPWORDS = new Set(["the", "you", "and", "all", "hey", "yes", "not", "but", "for", "lol", "okay", "everyone", "guys", "here", "what", "this", "that", "bot"]);

/** Normalizes a patch or throws a message Roomie can repeat. Changing `base` resets the dials unless they're in the patch. */
export function validatePersonalityPatch(patch: PersonalityPatch): PersonalityPatch {
  const out: PersonalityPatch = {};
  if (patch.base !== undefined) {
    if (!isArchetypeId(patch.base)) throw new Error(`Vibe must be one of: ${ARCHETYPE_IDS.join(", ")}.`);
    out.base = patch.base;
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, " ");
    if (name.length < 3 || name.length > 24) throw new Error("My name needs 3 to 24 characters.");
    if (!/^[\p{L}\p{N}][\p{L}\p{N} '\-]*$/u.test(name)) throw new Error("My name can only have letters, numbers, spaces, - and '.");
    if (NAME_STOPWORDS.has(name.toLowerCase())) throw new Error(`"${name}" is too common a word: I'd answer every message.`);
    out.name = name;
  }
  if (patch.quirks !== undefined) {
    const quirks = patch.quirks.map((q) => q.trim().replace(/\s+/g, " ")).filter(Boolean);
    if (quirks.length > MAX_QUIRKS) throw new Error(`Up to ${MAX_QUIRKS} quirks.`);
    if (quirks.some((q) => q.length > MAX_QUIRK_LENGTH)) throw new Error(`Keep each quirk under ${MAX_QUIRK_LENGTH} characters.`);
    out.quirks = [...new Set(quirks)];
  }
  if (patch.languages !== undefined) out.languages = [...new Set(patch.languages.map((l) => l.trim()).filter(Boolean))].slice(0, 5);
  if (patch.emoji !== undefined) {
    if (patch.emoji !== null && !EMOJI_LEVELS.includes(patch.emoji)) throw new Error("Emoji is none, light or lots.");
    out.emoji = patch.emoji;
  }
  for (const k of ["humor", "formality"] as const) {
    const v = patch[k];
    if (v === undefined) continue;
    if (v !== null && !isDial(v)) throw new Error(`${k === "humor" ? "Humor" : "Formality"} goes from 0 to 3.`);
    out[k] = v;
  }
  if (out.base !== undefined) for (const k of ["emoji", "humor", "formality"] as const) if (!(k in out)) out[k] = null;
  return out;
}

/** Apply a validated patch (null = back to the archetype's default). */
export function applyPersonalityPatch(p: Personality, patch: PersonalityPatch): Personality {
  const next: Personality = { ...p, learned: p.learned };
  if (patch.base !== undefined) next.base = patch.base;
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.quirks !== undefined) next.quirks = patch.quirks;
  if (patch.languages !== undefined) next.languages = patch.languages;
  for (const k of ["emoji", "humor", "formality"] as const) {
    if (patch[k] === undefined) continue;
    if (patch[k] === null) delete next[k];
    else (next as Record<string, unknown>)[k] = patch[k];
  }
  return next;
}

/* ---------- adaptation (ADR 0012) ---------- */

/** Confidence in the Learned style from how many messages it's seen: 0 at 0, ~0.27 at 50, ~0.46 at 100, ~0.8 at 300, max 0.9. */
export function confidenceFor(messagesSeen: number): number {
  if (messagesSeen <= 0) return 0;
  return Math.round(0.9 * (1 - Math.exp(-messagesSeen / 140)) * 100) / 100;
}

export const SLANG_NONE_BELOW = 0.3;
export const SLANG_FREE_ABOVE = 0.6;
/** In the middle band: at most one borrowed phrase per this many replies. */
export const SLANG_WINDOW = 5;
/** A nickname is usable once Roomie has seen others use it this many times. */
export const NICKNAME_MIN_SIGHTINGS = 3;

export type SlangBudget = { level: "none" | "one" | "free"; phrases: string[]; why: string };

const containsPhrase = (text: string, phrase: string) => new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(phrase.toLowerCase())}(?![\\p{L}\\p{N}])`, "u").test(text.toLowerCase());

/**
 * How much of the group's slang Roomie may borrow in the next reply. `recentReplies` are Roomie's last replies,
 * newest first. Below 0.3 confidence: none. 0.3-0.6: one phrase, only if none of the last 4 replies borrowed one
 * (so at most one per 5). Above 0.6: free, but never more often than the group itself uses slang.
 */
export function slangBudget(learned: Pick<LearnedStyle, "confidence" | "slang">, recentReplies: string[]): SlangBudget {
  const phrases = learned.slang.map((s) => s.phrase);
  if (!phrases.length) return { level: "none", phrases, why: "no slang learned yet" };
  if (learned.confidence < SLANG_NONE_BELOW) return { level: "none", phrases, why: `confidence ${learned.confidence} < ${SLANG_NONE_BELOW}` };
  if (learned.confidence <= SLANG_FREE_ABOVE) {
    const used = recentReplies.slice(0, SLANG_WINDOW - 1).some((r) => phrases.some((p) => containsPhrase(r, p)));
    return used ? { level: "none", phrases, why: `borrowed one in the last ${SLANG_WINDOW - 1} replies` } : { level: "one", phrases, why: "middle confidence" };
  }
  return { level: "free", phrases, why: `confidence ${learned.confidence} > ${SLANG_FREE_ABOVE}` };
}

/** Nicknames Roomie may use: seen used by others NICKNAME_MIN_SIGHTINGS+ times. */
export const usableNicknames = (learned: Pick<LearnedStyle, "nicknames">) => learned.nicknames.filter((n) => n.count >= NICKNAME_MIN_SIGHTINGS);

/* ---------- names and triggers ---------- */

export const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "/pet", "/pet@roomie_bot" (Telegram reads @bot as "Roomie"), "pet roomie", "*pets roomie*". Roomie has one name (ADR 0020). */
export function isPetCommand(text: string): boolean {
  const t = text.trim();
  if (/^\/pet(?:@\w+|roomie)?$/i.test(t)) return true;
  return /^\*?\s*(?:pets?|petting|pat|pats|headpats?)\s+(?:the\s+)?roomie\b[\s\p{P}\p{Extended_Pictographic}]*$/iu.test(t);
}

/* ---------- mood ---------- */

export type PetMood = "calm" | "happy" | "worried" | "sleepy";
export const WORRIED_OWES_CENTS = 10_000;
export const SLEEPY_AFTER_DAYS = 5;

export type MoodFacts = {
  /** Most anyone owes, as a positive number of cents (0 when nobody owes). */
  maxOwedCents: number;
  /** Every Balance is zero. */
  allSquare: boolean;
  /** Last human chat line, or null when there is none. */
  lastMessageAt: Date | null;
  now?: Date;
};

/** Worried if anyone owes > $100; sleepy after 5 quiet days; happy when everyone's square; else calm. */
export function moodFrom({ maxOwedCents, allSquare, lastMessageAt, now = new Date() }: MoodFacts): { mood: PetMood; reason: string } {
  if (maxOwedCents > WORRIED_OWES_CENTS) return { mood: "worried", reason: "someone owes over $100" };
  if (!lastMessageAt || now.getTime() - lastMessageAt.getTime() >= SLEEPY_AFTER_DAYS * 86_400_000) return { mood: "sleepy", reason: "the chat's been quiet" };
  if (allSquare) return { mood: "happy", reason: "everyone's square" };
  return { mood: "calm", reason: "nothing's on fire" };
}

/* ---------- lines without an LLM: greetings, wins, preview ---------- */

/** roll: a chore done after Roomie's private nudge about it ("Sam's on a roll."). */
export type WinKind = "square" | "streak" | "checkout" | "roll";
export type Win = { kind: WinKind; key: string; who?: string; n?: number; chore?: string };
export const STREAK_MILESTONES = [3, 7, 30] as const;

/** Stable pick from a list (same seed, same line). */
export function pick<T>(list: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return list[h % list.length];
}

const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;
export const countEmoji = (s: string) => (s.match(EMOJI) ?? []).length;
const stripEmoji = (s: string) => s.replace(EMOJI, "").replace(/\s{2,}/g, " ").trim();

/** Shape a line to the dials: no emoji at "none", at most one at "light"; lowercase at formality 0. */
export function shapeLine(line: string, dials: { emoji: EmojiLevel; formality: Dial }): string {
  let out = line;
  if (dials.emoji === "none") out = stripEmoji(out);
  else if (dials.emoji === "light") {
    let seen = 0;
    out = out.replace(EMOJI, (m) => (++seen > 1 ? "" : m)).replace(/\s{2,}/g, " ").trim();
  }
  if (dials.formality === 0) out = out.toLowerCase();
  return out;
}

const dayPart = (hour: number) => (hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 18 ? "day" : "evening");

/** The once-a-day hello: one line, no link. */
export function greetingLine(p: Personality, hour: number, seed: string): string {
  const a = ARCHETYPES[p.base];
  return shapeLine(pick(a.greetings[dayPart(hour)], seed), effectiveDials(p));
}

/** One short line for a win (settled up to zero, a streak milestone, a Checkout). */
export function winLine(p: Personality, win: Win): string {
  const a = ARCHETYPES[p.base];
  const line = pick(a.wins[win.kind], win.key)
    .replaceAll("{who}", win.who ?? "you")
    .replaceAll("{n}", String(win.n ?? ""))
    .replaceAll("{chore}", (win.chore ?? "chores").toLowerCase());
  return shapeLine(line, effectiveDials(p));
}

/** Dashboard preview: how this personality would say "<who> owes you <amount>". No LLM. */
export function previewOwes(p: Pick<Personality, "base" | "emoji" | "humor" | "formality">, who = "Dev", amount = "$30"): string {
  const a = ARCHETYPES[p.base];
  const d = effectiveDials(p);
  const fill = (s: string) => s.replace(/\bdev\b|\bDev\b/g, (m) => (m === "dev" ? who.toLowerCase() : who)).replace("$30", amount).replace(/\bhim\b/g, "them");
  const parts = [fill(a.owes.fact)];
  if (d.humor > 0) parts.push(fill(a.owes.quip));
  const emoji = d.emoji === "none" ? [] : d.emoji === "light" ? a.owes.emoji.slice(0, 1) : a.owes.emoji.length ? a.owes.emoji : ["✨"];
  let line = parts.join(/[.!?]$/.test(parts[0]) ? " " : ". ");
  if (d.formality >= 2 && !/[.!?]$/.test(line)) line += ".";
  if (emoji.length) line += ` ${emoji.join("")}`;
  // Formality 0 may drop capitals, but a money line is a task line: the person's name stays a name.
  if (d.formality === 0) line = line.toLowerCase().replace(new RegExp(`\\b${escapeRegex(who.toLowerCase())}\\b`, "g"), who);
  else line = line.charAt(0).toUpperCase() + line.slice(1);
  return line;
}

/** Wins in the tool results of one agent run (pure; the pipeline claims them so each is said once). */
export function winsFrom(results: { tool: string; args?: unknown; result: unknown }[], opts: { day: string; senderName: string; allSquareAfter?: boolean }): Win[] {
  const wins: Win[] = [];
  for (const { tool, args, result } of results) {
    const r = (result ?? {}) as Record<string, unknown>;
    if (tool === "log_chore" && typeof r.streak === "number" && (STREAK_MILESTONES as readonly number[]).includes(r.streak)) {
      const chore = str(r.chore);
      const who = str((args as { who?: unknown } | undefined)?.who).trim() || opts.senderName;
      wins.push({ kind: "streak", key: `streak:${chore.toLowerCase()}:${who.toLowerCase()}:${r.streak}:${opts.day}`, n: r.streak, chore, who });
    }
    // Done after the nudge: the streak milestone (above) wins when both apply, since the pipeline says one.
    if (tool === "log_chore" && r.nudged === true) {
      const chore = str(r.chore);
      const who = (str((args as { who?: unknown } | undefined)?.who).trim() || opts.senderName).split(/\s+/)[0];
      wins.push({ kind: "roll", key: `roll:${chore.toLowerCase()}:${who.toLowerCase()}:${opts.day}`, chore, who });
    }
    if (tool === "settle_up" && r.recorded === true && opts.allSquareAfter) wins.push({ kind: "square", key: `square:${opts.day}` });
    if (tool === "cart_checkout" && r.available === true && typeof r.checkoutId === "string") wins.push({ kind: "checkout", key: `checkout:${r.checkoutId}` });
  }
  const seen = new Set<string>();
  return wins.filter((w) => !seen.has(w.key) && seen.add(w.key));
}
