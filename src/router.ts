// P0 · Sudhersan. Plain code decides whether Roomie speaks; every message is logged either way.
//
// How Roomie decides to talk (policy in router-policy.ts, facts from chat_log):
//   1. Hard triggers always get a reply: voice note, reply to one of its messages, @mention, or the word "roomie".
//   2. Attention window: for 3 minutes after Roomie last replied in a chat, up to 3 follow-up messages are shown to
//      it with permission to answer "[silent]". It answers if the message continues the conversation or is something
//      it can act on ("and 2 bags of chips too"), and stays quiet for group chatter. A "[silent]" reply is not logged.
//   3. Otherwise the message is logged as context and Roomie says nothing.
// Scheduled posts (reminders, report) go straight to channels.deliver and are not logged, so they never open a
// window. The dashboard's /api/chat calls askRoomie directly and is never silent.
import type { IncomingMessage, Outgoing } from "@/channels/types";
import { householdForChat, linkChannelUser } from "@/services/members";
import { humanMessagesSince, lastRoomieReplyAt, logMessage, recentChatter } from "@/services/chatlog";
import { askRoomie } from "@/agent/roomie";
import { decideReply, parseSilent, saysRoomie, type Decision } from "./router-policy";

export { decideReply, parseSilent } from "./router-policy";

/** Hard-trigger check (kept for callers that only need the old yes/no). */
export function shouldReply(msg: IncomingMessage): boolean {
  return !!(msg.isVoice || msg.isReplyToRoomie || msg.mentionsRoomie || saysRoomie(msg.text));
}

export async function handleIncoming(msg: IncomingMessage): Promise<Outgoing | null> {
  const house = await householdForChat(msg.chatId, msg.chatTitle);
  const member = await linkChannelUser(house.id, msg.userId, msg.userName);
  await logMessage(house.id, member.id, msg.isVoice ? `(voice) ${msg.text}` : msg.text);

  let decision: Decision = "reply";
  if (!shouldReply(msg)) {
    const lastRoomieAt = await lastRoomieReplyAt(house.id);
    // Counted after the log above, so this includes the current message (see router-policy.ts).
    const humanSinceRoomie = lastRoomieAt ? await humanMessagesSince(house.id, lastRoomieAt) : 0;
    decision = decideReply({ hardTrigger: false, lastRoomieAt, humanSinceRoomie });
  }
  if (decision === "ignore") return null;

  const chatter = await recentChatter(house.id);
  const raw = await askRoomie(
    { householdId: house.id, actorId: member.id, source: "chat" },
    `${msg.isVoice ? `[voice note from ${member.name}]` : `[${member.name}]`} ${msg.text}`,
    chatter.slice(0, -1), // everything before this message
    { mayStaySilent: decision === "maybe" },
  );

  let out = raw;
  const text = parseSilent(raw.text);
  if (text === null) {
    if (decision === "maybe") return null; // Roomie chose silence: nothing sent, nothing logged, window not refreshed
    out = { ...raw, text: "👍" }; // by-name call: never post the literal token; acknowledge instead
  } else {
    out = { ...raw, text };
  }
  await logMessage(house.id, null, out.text);
  return out;
}
