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
  /** A photo sent with the message (stored by the adapter where the server can read it), e.g. a receipt. */
  imageUrl?: string;
  isReplyToRoomie?: boolean;
  mentionsRoomie?: boolean; // @-mention (the pipeline also checks the word "roomie")
  /** A 1:1 message to Roomie from a Member of the Group (`chatExternalId` is still the Group's Chat): always
   * addressed, and not logged as a line of the group chat. */
  isPrivate?: boolean;
};

export type Button = { text: string; url: string };
export type Outgoing = { text: string; buttons?: Button[] };

/** A person on a Channel, as the adapter sees them (group join events). */
export type ChannelUser = { userExternalId: string; name: string };

/**
 * Channels whose bots can't list a Chat's members (Telegram): for this long after Roomie joins, a first-time sender is
 * taken as someone who was already in the Chat (active); after it they're Pending (ADR 0010).
 */
export const ROSTER_GRACE_MS: Partial<Record<ChannelName, number>> = { telegram: 24 * 60 * 60 * 1000 };

/** sendPrivate failed because the Channel won't let Roomie start a 1:1 chat; `message` says what the person can do. */
export class CantMessagePrivatelyError extends Error {
  name = "CantMessagePrivatelyError";
}

export interface Channel {
  readonly name: ChannelName;
  /** Post into a Chat. */
  sendToChat(chatExternalId: string, msg: Outgoing): Promise<void>;
  /** A private 1:1 message (Claim links go out this way, ADR 0003). Throws CantMessagePrivatelyError when the
   * Channel needs the person to message Roomie first. */
  sendPrivate(userExternalId: string, msg: Outgoing): Promise<void>;
}
