// What every Channel adapter says and how it cuts text: the chunking, the first-contact lines (/help, /start), the
// failure line and the "which group?" answers for 1:1 messages. Pure, no SDK imports (telegram.test.ts,
// whatsapp.test.ts).
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
    : `Hey ${name} 👋 I'm Roomie. Add me to your group chat, say "roomie hi" there, and we're off.`;

/** /help, in a group or a DM: five lines of what Roomie does, in its voice. */
export const helpText = () =>
  [
    `I'm Roomie 👋 Say "roomie" or reply to me and I'm in. Some things I do:`,
    `💸 "I paid 60 for internet", "who owes what?", "settle up with Dev"`,
    `🛒 "add milk and eggs", "tacos for 5 friday", "I paid 84 for groceries"`,
    `🧹 "I did the dishes", "whose turn is trash?", "skip my turn", "changed the air filter"`,
    `⏰ "remind everyone trash goes out Tuesday 8pm", "weekly report", "send me the dashboard"`,
  ].join("\n");

/** What goes into the chat when something broke while handling a message addressed to Roomie. Details go to the log. */
export const OOPS = "Something went sideways on my end and I couldn't do that. Mind trying again in a minute?";

export const NO_GROUP = "Add me to your group chat first, then we can talk here too.";
export const MANY_GROUPS = "You're in a few of my groups, so ask me in the group chat you mean.";
export const NO_VOICE = "I can't hear voice notes yet, mind typing that?";
export const BAD_VOICE = "I couldn't make out that voice note, mind typing it?";

/** Whether a message was clearly meant for Roomie (the failure line is only posted then). */
export const wasAddressed = (msg: { isPrivate?: boolean; isVoice?: boolean; mentionsRoomie?: boolean; isReplyToRoomie?: boolean; text: string }) =>
  !!(msg.isPrivate || msg.isVoice || msg.mentionsRoomie || msg.isReplyToRoomie || /\broomie\b/i.test(msg.text));
