// The agent never imports a messaging SDK. Channel adapters normalize messages in and send replies out.
import type { ChannelName } from "@/db/schema";

export type { ChannelName };

export type IncomingMessage = {
  channel: ChannelName;
  /** The Chat's id on its Channel (WhatsApp group jid). */
  chatExternalId: string;
  chatTitle?: string;
  /** The sender's id on the Channel (WhatsApp jid). */
  userExternalId: string;
  userName: string;
  text: string; // for voice notes: the transcript
  isVoice?: boolean;
  isReplyToRoomie?: boolean;
  mentionsRoomie?: boolean; // @-mention (the pipeline also checks the word "roomie")
};

export type Button = { text: string; url: string };
export type Outgoing = { text: string; buttons?: Button[] };

/** A person on a Channel, as the adapter sees them (group join events). */
export type ChannelUser = { userExternalId: string; name: string };

export interface Channel {
  readonly name: ChannelName;
  /** Post into a Chat. */
  sendToChat(chatExternalId: string, msg: Outgoing): Promise<void>;
  /** A private 1:1 message (Claim links go out this way, ADR 0003). */
  sendPrivate(userExternalId: string, msg: Outgoing): Promise<void>;
}
