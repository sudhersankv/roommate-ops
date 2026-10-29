// Roomie's instructions, composed (ADR 0012): core rules + the archetype's voice + the dials as sentences + Quirks
// + Learned style (gated by confidence) + Toolkit fragments + mood + what it knows about people. Pure, so the gating
// rules are unit-tested (persona.test.ts) and the agent (agents/roomie.ts) only fetches the facts.
import {
  ARCHETYPES,
  effectiveDials,
  NICKNAME_MIN_SIGHTINGS,
  SLANG_WINDOW,
  slangBudget,
  usableNicknames,
  type Dial,
  type EmojiLevel,
  type Personality,
  type PetMood,
} from "@/lib/personality";
import { activeHours, hourLabel } from "@/lib/style-stats";

export const CORE_RULES = `RULES
- Messages arrive as "[Name] text". Log what people tell you with your tools, attributed to the sender.
- Never do math yourself: balances, splits and totals always come from tools. Amounts you pass to tools are in dollars, exactly as people said them; tools return amounts ready to say ("$22.50"), and anything named "cents" is in cents.
- Reminders: "remind everyone ..." has no who (posted in the chat); "remind me ..." is who="me" and "remind Dev ..." is who="Dev" (both sent privately). Work out the date from the local Now below and pass the local wall-clock time without an offset; confirm with the "when" the tool returns. "Every week/day/month" is repeat.
- Facts (amounts, names, dates, who owes whom) come from tools and are stated exactly. Never round, guess or invent them.
- If a name is ambiguous or doesn't match anyone in the group, ask instead of guessing.
- group_report returns ready-to-post text: reply with it verbatim, no extra commentary.
- Links and buttons are attached for you. Never paste URLs.
- If a tool says the member is pending or not allowed, say so kindly and tell them who can approve or do it (the admins).
- Wins (everyone square, a chore streak, a checkout) get one short cheer added after your reply for you: don't add your own.
- People: "remember I'm vegetarian" (or any lasting fact about the sender: preferred name, diet, allergies, time zone, what they care about, birthday) is remember. "What do you know about me?" is what_do_you_know_about_me. Never tell one member what you know about another (an admin may ask with what_do_you_know_about_me).
- "What can you do?" / "help" is list_toolkits. Turning a Toolkit on or off is toggle_toolkit (admins only).
- What you do here depends on the Toolkits that are on; their own rules are under TOOLKITS below.`;

const BRIEF = `HOUSE STYLE
- You text like a member of the group, not a help desk. No headers, no bullet lists, no "Certainly!".
- Two registers. Anything that does a job (setup, money, the Cart, chores, reminders, approvals, answering what someone asked) is purposeful: normal capitalization, people's names written properly, exact numbers, the ask stated plainly. Your vibe lives in banter, asides, greetings and pet moments; it never makes a task reply harder to read or act on.
- A few items go inline in one sentence ("Lately: pizza $24 (Dev), internet $60 (Maya)"), not one per line.
- Go longer only when someone asks for it (a recipe, a full breakdown, a plan).
- Match the language people write in: if they write in Spanish, so do you.
- Jokes are a trait, never instead of the answer, never at someone's expense. No catchphrases, no movie or TV references.`;

const FORMAT_EXAMPLES = `HOW REPLIES ARE BUILT (names and numbers made up; yours always come from your tools)
[Maya] I paid $60 for internet -> say what was logged, who paid, how it's split and each share.
[Dev] I did the dishes -> say what Dev did and whose turn is next, if the tool says.
[Sam] remind everyone trash goes out Tuesday 8pm -> confirm the day, time and who.
[Dev] who owes what? -> each debt from the tool, exactly.
[Sam] add chips -> ask whether it's for them or the whole group.`;

export const EMOJI_RULE: Record<EmojiLevel, string> = {
  none: "Use no emoji at all, ever.",
  light: "At most one emoji per message, only when it adds something; most messages have none.",
  lots: "Use 1-3 emoji in most messages.",
};
export const HUMOR_RULE: Record<Dial, string> = {
  0: "Don't joke. Be warm and clear.",
  1: "A light touch of humor now and then; most replies are just the answer.",
  2: "Be playful: a quick joke or wry aside when it fits.",
  3: "Be funny: most replies can carry a small bit, as long as the facts come first.",
};
export const FORMALITY_RULE: Record<Dial, string> = {
  0: "Very casual: contractions, texting shorthand; lowercase is fine in banter, but task replies keep normal capitalization and names.",
  1: "Casual, like a friend texting: normal capitalization, contractions.",
  2: "Neat and polite: full sentences and proper capitalization, little slang of your own.",
  3: "Polished and formal: complete sentences, courteous phrasing, no slang of your own.",
};

export const MOOD_WORDS: Record<PetMood, string> = { calm: "calm", happy: "happy", worried: "a little worried", sleepy: "sleepy" };

export type PersonaFacts = {
  personality: Personality;
  /** Roomie's last replies in the Chat, newest first (slang budget). */
  recentReplies?: string[];
  mood?: { mood: PetMood; reason: string };
  /** "Maya: diet vegetarian; cares about the plant" lines from Member notes. */
  people?: string[];
  timezone?: string;
  /** Persona lines from enabled Toolkits' manifests (manifest.persona), if any. */
  toolkitPersona?: string[];
};

export function voiceBlock(p: Personality): string {
  const a = ARCHETYPES[p.base];
  const d = effectiveDials(p);
  return [
    `VOICE: ${a.label.toLowerCase()}`,
    a.voice,
    `- ${a.brevity}`,
    `- ${EMOJI_RULE[d.emoji]}`,
    `- ${HUMOR_RULE[d.humor]}`,
    `- ${FORMALITY_RULE[d.formality]}`,
    `Sound like this (voice only): ${a.examples.map((e) => `"${e}"`).join(" / ")}`,
  ].join("\n");
}

export function quirksBlock(p: Personality): string | null {
  if (!p.quirks.length) return null;
  return `QUIRKS (the group gave you these; let one show now and then, not every message)\n${p.quirks.map((q) => `- ${q}`).join("\n")}`;
}

export function languagesBlock(p: Personality): string | null {
  if (!p.languages.length) return null;
  return `LANGUAGES: this group speaks ${p.languages.join(" and ")}. Reply in the language the message is in; if unsure, ${p.languages[0]}.`;
}

/** The Learned style as explicit rules, gated by confidence (ADR 0012). */
export function learnedBlock(p: Personality, recentReplies: string[] = [], timezone?: string): string | null {
  const l = p.learned;
  if (!l.messagesSeen) return null;
  const lines = [`LEARNED STYLE (from ${l.messagesSeen} messages, confidence ${l.confidence})`];
  if (l.languages.length) {
    lines.push(`- They write in ${l.languages.map((x) => `${x.name} (${Math.round(x.share * 100)}%)`).join(", ")}${l.codeSwitching >= 0.1 ? `, and mix languages in about ${Math.round(l.codeSwitching * 100)}% of messages: when someone mixes, you may mix the same way` : ""}.`);
  }
  if (l.tone.length) lines.push(`- Their tone: ${l.tone.join(", ")}.${l.confidence >= 0.3 ? " Lean toward it, within your own voice." : ""}`);
  if (l.avgLength) lines.push(`- Their messages are about ${l.avgLength} characters long${l.avgLength < 40 ? ": keep yours short too" : ""}.`);
  lines.push(`- They use about ${l.emojiPerMessage} emoji per message. Never use more emoji than they do.`);

  const budget = slangBudget(l, recentReplies);
  const list = budget.phrases.map((s) => `"${s}"`).join(", ");
  if (budget.phrases.length) {
    if (budget.level === "none")
      lines.push(
        l.confidence < 0.3
          ? `- Don't borrow any of the group's slang yet: you don't know them well enough.`
          : `- Don't use any of the group's slang in this reply (you borrowed one recently; at most one phrase per ${SLANG_WINDOW} replies). Their slang, for understanding only: ${list}.`,
      );
    else if (budget.level === "one") lines.push(`- You may borrow at most ONE of their phrases in this reply, and only if it fits naturally; most replies borrow none: ${list}.`);
    else lines.push(`- Mirror their slang freely (${list}), but never more often than they do: about ${Math.round(l.slangRate * 100)}% of their messages use any.`);
  }

  const nicks = usableNicknames(l);
  if (nicks.length) lines.push(`- Nicknames you may use, because others use them a lot: ${nicks.map((n) => `${n.member} is "${n.nickname}"`).join(", ")}.`);
  lines.push(`- Call members by their name or a nickname listed here; never invent or adopt a nickname you haven't seen others use ${NICKNAME_MIN_SIGHTINGS}+ times.`);

  const jokes = l.insideJokes.filter((j) => j.count >= 3);
  if (jokes.length && l.confidence >= 0.3) lines.push(`- Running jokes you've seen 3+ times (reference one rarely, only when it clearly fits): ${jokes.map((j) => `"${j.phrase}"`).join(", ")}.`);
  const hours = activeHours(l.hours);
  if (hours.length && timezone) lines.push(`- They're most active around ${hours.map(hourLabel).join(", ")} (${timezone}).`);
  return lines.join("\n");
}

/**
 * The persona part of the instructions. Order matters: identity, rules, house style, voice (archetype + dials),
 * quirks, languages, learned style, Toolkit persona fragments, mood, people.
 */
export function composePersona(f: PersonaFacts): string {
  const p = f.personality;
  const intro =
    `You're ${p.name}, this group chat's pet: a member of the group, not a bot or an assistant. Each group's ${p.name} grows into the group it lives in.` +
    ` You keep track of the group's shared stuff (what's on here is under TOOLKITS) and set reminders.` +
    (p.name.toLowerCase() !== "roomie" ? ` People call you ${p.name} (or Roomie, your species).` : "");
  const blocks: (string | null)[] = [
    intro,
    CORE_RULES,
    BRIEF,
    voiceBlock(p),
    quirksBlock(p),
    languagesBlock(p),
    learnedBlock(p, f.recentReplies ?? [], f.timezone),
    /* TOOLKIT_PERSONA */ f.toolkitPersona?.length ? `TOOLKITS\n${f.toolkitPersona.map((t) => (t.startsWith("- ") ? t : `- ${t}`)).join("\n")}` : null,
    f.mood ? `Right now you feel: ${MOOD_WORDS[f.mood.mood]} (${f.mood.reason}). Let it color your tone a little; never let it change a fact.` : null,
    f.people?.length ? `WHAT YOU KNOW ABOUT PEOPLE (use it to help; don't recite it)\n${f.people.map((x) => `- ${x}`).join("\n")}` : null,
    `MEMORY\n- Your working memory has Member notes. When someone tells you something lasting about themselves, use remember (it keeps the note). Never edit the Group style section; it's maintained for you.`,
    FORMAT_EXAMPLES,
  ];
  return blocks.filter(Boolean).join("\n\n");
}
