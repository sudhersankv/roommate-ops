// The dev Channel: a pretend WhatsApp for scripts/dev-chat.ts. Group posts and private messages go to a callback
// (the REPL prints them), so the whole flow can be exercised without a phone. A Poll is printed with numbered options
// and a number ("poll 1"): a bare number from a Member votes (the pipeline), and so does dev-chat's `vote` command.
import { renderPollAsText } from "./text";
import type { Channel, Outgoing, Sent } from "./types";

export type DevOutput = { to: "chat"; chatExternalId: string; msg: Outgoing } | { to: "private"; userExternalId: string; msg: Outgoing };

export class DevChannel implements Channel {
  readonly name = "dev" as const;
  readonly nativePolls = false;
  private polls = 0;
  /** Poll ids are unique per process start, so a restarted dev-chat never reuses one (polls are keyed by them). */
  private readonly boot = Date.now().toString(36);
  constructor(private readonly onSend: (out: DevOutput) => void) {}

  async sendToChat(chatExternalId: string, msg: Outgoing): Promise<Sent> {
    if (msg.poll) {
      const n = ++this.polls;
      this.onSend({ to: "chat", chatExternalId, msg: { ...msg, text: `(poll ${n}) ${renderPollAsText(msg.poll)}` } });
      return { externalId: this.pollExternalId(n) };
    }
    this.onSend({ to: "chat", chatExternalId, msg });
    return {};
  }

  /** "poll 3" as printed -> its external id (dev-chat's `vote` command). */
  pollExternalId = (n: number) => `dev-poll-${this.boot}-${n}`;

  async sendPrivate(userExternalId: string, msg: Outgoing): Promise<Sent> {
    this.onSend({ to: "private", userExternalId, msg: msg.poll ? { ...msg, text: renderPollAsText(msg.poll) } : msg });
    return {};
  }

  async leaveChat(chatExternalId: string) {
    console.log(`[dev] Roomie left ${chatExternalId}`);
  }
}

/** Dev user ids look like a jid so nothing downstream special-cases them. */
export const devUserId = (name: string) => `dev:${name.trim().toLowerCase()}`;
