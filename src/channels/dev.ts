// The dev Channel: a pretend WhatsApp for scripts/dev-chat.ts. Group posts and private messages go to a callback
// (the REPL prints them), so the whole flow can be exercised without a phone.
import type { Channel, Outgoing } from "./types";

export type DevOutput = { to: "chat"; chatExternalId: string; msg: Outgoing } | { to: "private"; userExternalId: string; msg: Outgoing };

export class DevChannel implements Channel {
  readonly name = "dev" as const;
  constructor(private readonly onSend: (out: DevOutput) => void) {}

  async sendToChat(chatExternalId: string, msg: Outgoing) {
    this.onSend({ to: "chat", chatExternalId, msg });
  }

  async sendPrivate(userExternalId: string, msg: Outgoing) {
    this.onSend({ to: "private", userExternalId, msg });
  }

  async leaveChat(chatExternalId: string) {
    console.log(`[dev] Roomie left ${chatExternalId}`);
  }
}

/** Dev user ids look like a jid so nothing downstream special-cases them. */
export const devUserId = (name: string) => `dev:${name.trim().toLowerCase()}`;
