// Shared contract #3: the agent never imports a messaging SDK. Channels normalize in and send out.
export type IncomingMessage = {
  channel: "whatsapp";
  chatId: string;
  chatTitle?: string;
  userId: string;
  userName: string;
  text: string; // for voice notes: the transcript
  isVoice?: boolean;
  isReplyToRoomie?: boolean;
  mentionsRoomie?: boolean; // @-mention (the router also checks the word "roomie")
};

export type Button = { text: string; url: string };
export type Outgoing = { text: string; buttons?: Button[] };

export interface Channel {
  /** Post into a household's group chat. Used by the scheduler. */
  send(householdId: string, msg: Outgoing): Promise<void>;
}
