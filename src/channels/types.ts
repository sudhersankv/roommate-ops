// The agent never imports a messaging SDK. Channel adapters normalize messages in and send replies out.
import type { ChannelName } from "@/db/schema";

export type { ChannelName };

export type IncomingMessage = {
  channel: ChannelName;
  /** The Chat's id on its Channel (Telegram chat id, WhatsApp group jid). */
  chatExternalId: string;
  chatTitle?: string;
  /** The sender's id on the Channel (Telegram user id, WhatsApp jid). */
  userExternalId: string;
  userName: string;
  text: string; // for voice notes: the transcript
  isVoice?: boolean;
  /** A photo sent with the message (stored by the adapter where the server can read it), e.g. a receipt. */
  imageUrl?: string;
  /** A photo or voice note nobody addressed to Roomie: not downloaded, not transcribed (`text` is the caption, or
   * empty). The pipeline logs "(photo) ..." / "(voice note)" and, with no caption, goes no further. */
  skippedMedia?: "photo" | "voice";
  /** With a skipped photo: the adapter fetches and stores it after all (asking mediaWanted again with `gateActed`),
   * returning its link, or null when it's still not wanted or the download failed. The pipeline calls it only when the
   * Gate decided to answer the caption. */
  fetchSkippedPhoto?: () => Promise<string | null>;
  isReplyToRoomie?: boolean;
  mentionsRoomie?: boolean; // @-mention (the pipeline also checks the word "roomie")
  /** A 1:1 message to Roomie from a Member of the Group (`chatExternalId` is still the Group's Chat): always
   * addressed, and not logged as a line of the group chat. */
  isPrivate?: boolean;
};

export type Button = { text: string; url: string };
/** A Poll (ADR 0018): a who-question with up to four options. `text` still goes with it as the fallback line. */
export type OutgoingPoll = { question: string; options: string[]; multi: boolean };
export type Outgoing = { text: string; buttons?: Button[]; poll?: OutgoingPoll };

/** What a send returns: the sent message's id when the Channel knows it (a Poll's votes point at it) and, on
 * WhatsApp, the Poll's messageSecret (votes are encrypted with it). */
export type Sent = { externalId?: string; secret?: Uint8Array };

/** One person's answer to a Poll, as the Channel saw it. `optionIds` are 0-based; empty = they took their vote back. */
export type PollVote = {
  channel: ChannelName;
  chatExternalId: string;
  pollExternalId: string;
  userExternalId: string;
  optionIds: number[];
};

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
  /** Whether `Outgoing.poll` goes out as the Channel's own poll (votes come back as PollVotes). Otherwise it's sent as
   * numbered options and a bare number from a Member is the vote (the pipeline). */
  readonly nativePolls?: boolean;
  /** Post into a Chat. */
  sendToChat(chatExternalId: string, msg: Outgoing): Promise<Sent>;
  /** A private 1:1 message (Claim links go out this way, ADR 0003). Throws CantMessagePrivatelyError when the
   * Channel needs the person to message Roomie first. */
  sendPrivate(userExternalId: string, msg: Outgoing): Promise<Sent>;
  /** Roomie leaves the Chat (an operator's "Leave chat", too many new Groups from one person). */
  leaveChat(chatExternalId: string): Promise<void>;
  /** Forget an intro still waiting to go out (the Group was paused). */
  dropIntro?(chatExternalId: string): void;
  /** How many people (not Roomie) are in the Chat right now, or null when the Channel can't say (Join link seats). */
  participantCount?(chatExternalId: string): Promise<number | null>;
}

/** What the adapters ask before downloading a photo or transcribing a voice note (the pipeline's mediaWantedFor: a
 * paused Group never; otherwise addressed, the follow-up window, setup pending for this Admin, the pet's name, or the
 * Gate answering a skipped photo's caption). */
export type MediaQuestion = {
  channel: ChannelName;
  chatExternalId: string;
  userExternalId: string;
  kind: "photo" | "voice";
  caption?: string;
  /** What the adapter could see itself: a DM, an @mention, a reply to Roomie. */
  isPrivate?: boolean;
  mentionsRoomie?: boolean;
  isReplyToRoomie?: boolean;
  /** Asked again for a skipped photo: the Gate decided to answer its caption. */
  gateActed?: boolean;
};
