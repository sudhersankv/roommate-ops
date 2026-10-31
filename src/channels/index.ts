// The Channel registry. Adapters register themselves (dev in scripts/dev-chat.ts, Telegram via telegram-boot.ts,
// WhatsApp via whatsapp-boot.ts);
// deliver() posts into a Group's Chat through whichever adapter owns it, and only logs when none is connected.
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Channel, ChannelName, Outgoing, Sent } from "./types";

const registry = (): Map<ChannelName, Channel> => {
  const g = globalThis as { __roomieChannels?: Map<ChannelName, Channel> };
  return (g.__roomieChannels ??= new Map());
};

export function registerChannel(channel: Channel) {
  registry().set(channel.name, channel);
}

export const channelFor = (name: ChannelName) => registry().get(name);

/** Post into a Group's Chat (scheduler, approvals, onboarding, Polls). Returns what the Channel says it sent. */
export async function deliver(groupId: string, out: Outgoing): Promise<Sent & { channel?: ChannelName }> {
  const [chat] = await db.select().from(schema.chats).where(eq(schema.chats.groupId, groupId));
  const channel = chat && channelFor(chat.channel);
  if (!chat || !channel) {
    console.log(`[roomie] no channel connected for group ${groupId}, would send: ${out.text}`);
    return chat ? { channel: chat.channel } : {};
  }
  return { ...((await channel.sendToChat(chat.externalId, out)) ?? {}), channel: chat.channel };
}

export type DeliverPrivateOpts = {
  /** The Group the DM is about (default: the Member's own). A reply to it within 24 h is about this Group (ADR 0020). */
  groupId?: string;
  /** "nudge" (default) for anything Roomie sends first. */
  kind?: "nudge" | "dm";
};

/**
 * Private 1:1 message to a Member on their Group's Channel. Notes which Group it was about (dm_context), so the
 * person's reply lands there. Throws CantMessagePrivatelyError when the Channel can't DM them yet.
 */
export async function deliverPrivate(memberId: string, out: Outgoing, opts: DeliverPrivateOpts = {}): Promise<Sent> {
  const [row] = await db
    .select({ channelUserId: schema.members.channelUserId, channel: schema.chats.channel, groupId: schema.members.groupId })
    .from(schema.members)
    .innerJoin(schema.chats, eq(schema.chats.groupId, schema.members.groupId))
    .where(eq(schema.members.id, memberId));
  const channel = row && channelFor(row.channel);
  if (!row?.channelUserId || !channel) {
    console.log(`[roomie] no private channel for member ${memberId}, would send: ${out.text}`);
    return {};
  }
  const sent = (await channel.sendPrivate(row.channelUserId, out)) ?? {};
  const { noteDmContext } = await import("@/services/dm");
  await noteDmContext(memberId, opts.groupId ?? row.groupId, opts.kind ?? "nudge").catch((e) => console.warn("[channels] couldn't note the DM context", e));
  return sent;
}
