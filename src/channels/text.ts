// What every Channel adapter says and how it cuts text: the chunking, the first-contact lines (/help, /start), the
// failure line and the "which group?" answers for 1:1 messages. Pure, no SDK imports (text.test.ts,
// telegram.test.ts, whatsapp.test.ts); the Tricks in /help come from the manifests.
import { COMING_SOON, MANIFESTS } from "@/toolkits/manifests";
import type { ChannelName } from "./types";

/** Telegram's limit; WhatsApp takes far more, but long walls of text read badly there too. */
export const MAX_TEXT = 4096;

/** Split a long reply at line breaks (else spaces) so every piece fits the Channel's limit. */
export function chunkText(text: string, max = MAX_TEXT): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf(" ", max);
    if (cut < max / 2) cut = /[\uD800-\uDBFF]/.test(rest[max - 1]) ? max - 1 : max;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).replace(/^[\n ]+/, "");
  }
  if (rest || out.length === 0) out.push(rest);
  return out;
}

/** "/help", "/help@roomie_bot" -> "help"; a command for another bot or plain text -> null. */
export function commandOf(text: string | undefined, username?: string): string | null {
  const m = /^\/([a-z]+)(?:@(\w+))?(?:\s|$)/i.exec(text ?? "");
  if (!m) return null;
  if (m[2] && username && m[2].toLowerCase() !== username.toLowerCase()) return null;
  return m[1].toLowerCase();
}

/**
 * /start in a DM: one line. Members learn DMs work (on Telegram, only now that they pressed Start); anyone else how
 * to get going. No links either way.
 */
export const startReply = (name: string, inGroups: number, channel: ChannelName = "telegram") =>
  inGroups
    ? channel === "telegram"
      ? `Hey ${name} 👋 Now I can DM you: ask for "the dashboard" here or in the group and your link lands here (/help for the rest).`
      : `Hey ${name} 👋 Ask for "the dashboard" here or in the group and your link lands here ("/help" for the rest).`
    : `Hey ${name} 👋 I'm Roomie. Add me to a group chat, tell me what it's for, and I'll learn the right Tricks.`;

const joinNames = (n: string[]) => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

/**
 * /help, in a group or a DM, at most 8 lines. `learned` (Trick ids) is what this group taught Roomie: those Tricks
 * get a line each and the last line says how to teach the next one. Unknown (a DM from someone in several groups):
 * every Trick there is.
 */
export function helpText(learned?: readonly string[]): string {
  const known = learned ? MANIFESTS.filter((m) => learned.includes(m.id)) : [...MANIFESTS];
  const next = MANIFESTS.find((m) => learned && !learned.includes(m.id));
  const said = (m: (typeof MANIFESTS)[number]) => m.gate.examples.slice(0, 2).map((e) => `"${e}"`).join(", ");
  const lower = (m: { name: string }) => m.name.toLowerCase();
  const teach = !learned
    ? `Teach me one in your group: "roomie, learn ${lower(MANIFESTS[0])}". Drop one: "roomie, forget ${lower(MANIFESTS.at(-1)!)}".`
    : next
      ? `Teach me more: "roomie, learn ${lower(next)}".${known.length ? ` Drop one: "roomie, forget ${lower(known.at(-1)!)}".` : ""}`
      : `Drop one any time: "roomie, forget ${lower(known.at(-1)!)}". ${COMING_SOON[0].name} and more are on the way.`;
  return [
    `I'm Roomie 🦖 Say "roomie" or reply to me and I'm in.`,
    learned ? `Tricks I know here: ${joinNames(known.map((m) => m.name)) || "none yet"}.` : `Tricks I can learn: ${joinNames(known.map((m) => m.name))}, more on the way.`,
    ...known.map((m) => `${m.name}: ${said(m)}`),
    `Always: "remind everyone trash goes out Tuesday 8pm", "send me the dashboard"`,
    teach,
  ].join("\n");
}

/** What goes into the chat when something broke while handling a message addressed to Roomie. Details go to the log. */
export const OOPS = "Something went sideways on my end and I couldn't do that. Mind trying again in a minute?";

export const NO_GROUP = "Add me to your group chat first, then we can talk here too.";
export const MANY_GROUPS = "You're in a few of my groups, so ask me in the group chat you mean.";
export const NO_VOICE = "I can't hear voice notes yet, mind typing that?";
export const BAD_VOICE = "I couldn't make out that voice note, mind typing it?";

/** Whether a message was clearly meant for Roomie (the failure line is only posted then). */
export const wasAddressed = (msg: { isPrivate?: boolean; isVoice?: boolean; mentionsRoomie?: boolean; isReplyToRoomie?: boolean; text: string }) =>
  !!(msg.isPrivate || msg.isVoice || msg.mentionsRoomie || msg.isReplyToRoomie || /\broomie\b/i.test(msg.text));
