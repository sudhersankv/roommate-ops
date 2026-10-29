// The Channel registry. Adapters register themselves (dev in scripts/dev-chat.ts, Telegram via telegram-boot.ts,
// WhatsApp via whatsapp-boot.ts);
// deliver() posts into a Group's Chat through whichever adapter owns it, and only logs when none is connected.
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Channel, ChannelName, Outgoing } from "./types";

const registry = (): Map<ChannelName, Channel> => {
  const g = globalThis as { __roomieChannels?: Map<ChannelName, Channel> };
  return (g.__roomieChannels ??= new Map());
};

export function registerChannel(channel: Channel) {
  registry().set(channel.name, channel);
}

export const channelFor = (name: ChannelName) => registry().get(name);

/** Post into a Group's Chat (scheduler, approvals, onboarding). */
export async function deliver(groupId: string, out: Outgoing): Promise<void> {
  const [chat] = await db.select().from(schema.chats).where(eq(schema.chats.groupId, groupId));
  const channel = chat && channelFor(chat.channel);
  if (!chat || !channel) {
    console.log(`[roomie] no channel connected for group ${groupId}, would send: ${out.text}`);
    return;
  }
  await channel.sendToChat(chat.externalId, out);
}

/** Private 1:1 message to a Member on their Group's Channel. */
export async function deliverPrivate(memberId: string, out: Outgoing): Promise<void> {
  const [row] = await db
    .select({ channelUserId: schema.members.channelUserId, channel: schema.chats.channel })
    .from(schema.members)
    .innerJoin(schema.chats, eq(schema.chats.groupId, schema.members.groupId))
    .where(eq(schema.members.id, memberId));
  const channel = row && channelFor(row.channel);
  if (!row?.channelUserId || !channel) {
    console.log(`[roomie] no private channel for member ${memberId}, would send: ${out.text}`);
    return;
  }
  await channel.sendPrivate(row.channelUserId, out);
}
