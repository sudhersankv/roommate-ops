// Lease Inbox mail behind one interface (ADR 0016): one AgentMail inbox per Group. The real client wraps the
// `agentmail` SDK (camelCase; the webhook's JSON is snake_case and is parsed elsewhere); the in-memory fake records
// sends and lets tests push inbound mail. mailClient() is the fake with MAIL_FAKE=1 or without AGENTMAIL_API_KEY.
import { AgentMailClient as AgentMailSdk } from "agentmail";

export type MailAttachment = { attachmentId: string; filename: string | null; contentType: string | null; size: number };

export type MailMessage = {
  inboxId: string;
  messageId: string;
  threadId: string;
  /** As the header says it: "Brookfield Leasing <leasing@brookfieldresidential.com>" or a bare address. */
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string | null;
  receivedAt: Date;
  attachments: MailAttachment[];
  labels: string[];
};

export type OutgoingMail = { to: string; cc?: string[]; subject: string; text: string; headers?: Record<string, string> };
export type ReplyMail = { text: string; to?: string; headers?: Record<string, string> };
export type SentRef = { messageId: string; threadId: string };
export type AttachmentLink = { downloadUrl: string; textUrl: string | null; expiresAt: Date };

export interface MailClient {
  readonly kind: "agentmail" | "fake";
  /** Idempotent per Group: asking again for the same Group returns the inbox it already has. */
  createInbox(groupId: string, username: string): Promise<{ inboxId: string; address: string }>;
  /** Release the address (an Admin's "Release address"); mail to it bounces from then on. */
  deleteInbox(inboxId: string): Promise<void>;
  send(inboxId: string, mail: OutgoingMail): Promise<SentRef>;
  /** In the thread of `messageId`, to its sender (or `to`: a follow-up on a message we sent). */
  reply(inboxId: string, messageId: string, mail: ReplyMail): Promise<SentRef>;
  getMessage(inboxId: string, messageId: string): Promise<MailMessage>;
  /** Where to fetch one attachment (the url expires). */
  getAttachment(inboxId: string, messageId: string, attachmentId: string): Promise<AttachmentLink>;
  fetchAttachment(url: string): Promise<Buffer>;
}

/** What Roomie says when the mail service can't be reached. */
export class MailUnavailableError extends Error {
  constructor(message = "The Lease Inbox can't reach email right now. Try again in a bit.") {
    super(message);
    this.name = "MailUnavailableError";
  }
}

/* ---------- AgentMail ---------- */

const idem = (headers?: Record<string, string>) => headers?.["Idempotency-Key"];

/** The domain Group inboxes are made on: AGENTMAIL_DOMAIN (a domain verified on the AgentMail org, e.g. tryroomie.me),
 * else AgentMail's own agentmail.to. */
export const mailDomain = () => process.env.AGENTMAIL_DOMAIN?.trim().toLowerCase().replace(/^@/, "") || "agentmail.to";

export class AgentMailClient implements MailClient {
  readonly kind = "agentmail" as const;
  private sdk: AgentMailSdk;

  constructor(apiKey = process.env.AGENTMAIL_API_KEY ?? "") {
    this.sdk = new AgentMailSdk({ apiKey });
  }

  private async call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[mail] ${what}: ${e instanceof Error ? e.message : String(e)}`);
      throw new MailUnavailableError();
    }
  }

  async createInbox(groupId: string, username: string) {
    const inbox = await this.call("create inbox", () =>
      this.sdk.inboxes.create({ username, domain: mailDomain(), displayName: "Roomie", clientId: groupId, metadata: { group_id: groupId } }),
    );
    return { inboxId: inbox.inboxId, address: inbox.email };
  }

  async deleteInbox(inboxId: string) {
    await this.call("delete inbox", () => this.sdk.inboxes.delete(inboxId));
  }

  async send(inboxId: string, mail: OutgoingMail) {
    const r = await this.call("send", () =>
      this.sdk.inboxes.messages.send(inboxId, { to: mail.to, ...(mail.cc?.length ? { cc: mail.cc } : {}), subject: mail.subject, text: mail.text, headers: mail.headers }, { idempotencyKey: idem(mail.headers) }),
    );
    return { messageId: r.messageId, threadId: r.threadId };
  }

  async reply(inboxId: string, messageId: string, mail: ReplyMail) {
    const r = await this.call("reply", () =>
      this.sdk.inboxes.messages.reply(inboxId, messageId, { text: mail.text, to: mail.to, headers: mail.headers }, { idempotencyKey: idem(mail.headers) }),
    );
    return { messageId: r.messageId, threadId: r.threadId };
  }

  async getMessage(inboxId: string, messageId: string): Promise<MailMessage> {
    const m = await this.call("get message", () => this.sdk.inboxes.messages.get(inboxId, messageId));
    return {
      inboxId: m.inboxId,
      messageId: m.messageId,
      threadId: m.threadId,
      from: m.from,
      to: m.to,
      subject: m.subject ?? "",
      text: m.text ?? m.extractedText ?? "",
      html: m.html ?? null,
      receivedAt: new Date(m.timestamp),
      attachments: (m.attachments ?? []).map((a) => ({ attachmentId: a.attachmentId, filename: a.filename ?? null, contentType: a.contentType ?? null, size: a.size })),
      labels: m.labels,
    };
  }

  async getAttachment(inboxId: string, messageId: string, attachmentId: string) {
    const a = await this.call("get attachment", () => this.sdk.inboxes.messages.getAttachment(inboxId, messageId, attachmentId));
    return { downloadUrl: a.downloadUrl, textUrl: a.textUrl ?? null, expiresAt: new Date(a.expiresAt) };
  }

  async fetchAttachment(url: string) {
    const res = await this.call("fetch attachment", () => fetch(url, { signal: AbortSignal.timeout(60_000) }));
    if (!res.ok) throw new MailUnavailableError(`Couldn't download that attachment (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }
}

/* ---------- the fake ---------- */

export type SentMail = OutgoingMail & { inboxId: string; messageId: string; threadId: string; inReplyTo: string | null };
export type InboundInput = {
  from: string;
  subject: string;
  text: string;
  html?: string | null;
  threadId?: string;
  receivedAt?: Date;
  attachments?: { filename: string; contentType: string; bytes: Buffer }[];
};

/** In-memory: deterministic ids (fake-msg-1, fake-thread-1, ...), every send in `sent`, inbound pushed with receive(). */
export class FakeMail implements MailClient {
  readonly kind = "fake" as const;
  inboxes = new Map<string, { inboxId: string; address: string }>();
  sent: SentMail[] = [];
  messages = new Map<string, MailMessage>();
  private files = new Map<string, Buffer>();
  private next = { msg: 0, thread: 0, att: 0 };

  reset() {
    this.inboxes.clear();
    this.sent = [];
    this.messages.clear();
    this.files.clear();
    this.next = { msg: 0, thread: 0, att: 0 };
  }

  private messageId = () => `fake-msg-${++this.next.msg}`;
  private threadId = () => `fake-thread-${++this.next.thread}`;

  async createInbox(groupId: string, username: string) {
    const have = this.inboxes.get(groupId);
    if (have) return have;
    const address = `${username}@${mailDomain()}`;
    const inbox = { inboxId: address, address };
    this.inboxes.set(groupId, inbox);
    return inbox;
  }

  async deleteInbox(inboxId: string) {
    for (const [groupId, inbox] of this.inboxes) if (inbox.inboxId === inboxId) this.inboxes.delete(groupId);
  }

  async send(inboxId: string, mail: OutgoingMail) {
    return this.record({ ...mail, inboxId, messageId: this.messageId(), threadId: this.threadId(), inReplyTo: null });
  }

  async reply(inboxId: string, messageId: string, mail: ReplyMail) {
    const original = await this.getMessage(inboxId, messageId);
    const subject = /^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`;
    const to = mail.to ?? original.from;
    return this.record({ to, subject, text: mail.text, headers: mail.headers, inboxId, messageId: this.messageId(), threadId: original.threadId, inReplyTo: messageId });
  }

  /** A sent email is in `sent` and, like on AgentMail, a message of its inbox (so it can be replied to). */
  private record(m: SentMail): SentRef {
    this.sent.push(m);
    this.messages.set(`${m.inboxId}/${m.messageId}`, {
      inboxId: m.inboxId,
      messageId: m.messageId,
      threadId: m.threadId,
      from: m.inboxId,
      to: [m.to],
      subject: m.subject,
      text: m.text,
      html: null,
      receivedAt: new Date(),
      attachments: [],
      labels: ["sent"],
    });
    return { messageId: m.messageId, threadId: m.threadId };
  }

  /** A test pushes mail into an inbox; returns it as getMessage would. */
  receive(inboxId: string, input: InboundInput): MailMessage {
    const messageId = this.messageId();
    const attachments = (input.attachments ?? []).map((a) => {
      const attachmentId = `fake-att-${++this.next.att}`;
      this.files.set(`https://mail.example/fake/${attachmentId}`, a.bytes);
      return { attachmentId, filename: a.filename, contentType: a.contentType, size: a.bytes.length };
    });
    const m: MailMessage = {
      inboxId,
      messageId,
      threadId: input.threadId ?? this.threadId(),
      from: input.from,
      to: [inboxId],
      subject: input.subject,
      text: input.text,
      html: input.html ?? null,
      receivedAt: input.receivedAt ?? new Date(),
      attachments,
      labels: ["received"],
    };
    this.messages.set(`${inboxId}/${messageId}`, m);
    return m;
  }

  async getMessage(inboxId: string, messageId: string) {
    const m = this.messages.get(`${inboxId}/${messageId}`);
    if (!m) throw new Error(`No such message: ${messageId}`);
    return structuredClone(m);
  }

  async getAttachment(inboxId: string, messageId: string, attachmentId: string) {
    const m = await this.getMessage(inboxId, messageId);
    if (!m.attachments.some((a) => a.attachmentId === attachmentId)) throw new Error(`No such attachment: ${attachmentId}`);
    return { downloadUrl: `https://mail.example/fake/${attachmentId}`, textUrl: null, expiresAt: new Date(Date.now() + 3600_000) };
  }

  async fetchAttachment(url: string) {
    const bytes = this.files.get(url);
    if (!bytes) throw new MailUnavailableError("Couldn't download that attachment (404).");
    return Buffer.from(bytes);
  }
}

/* ---------- which one ---------- */

let override: MailClient | null = null;
let real: AgentMailClient | null = null;
let fake: FakeMail | null = null;

/** Tests inject a client; null goes back to the env's choice. */
export function setMailClient(c: MailClient | null) {
  override = c;
}

export function mailClient(): MailClient {
  if (override) return override;
  if (process.env.MAIL_FAKE === "1" || !process.env.AGENTMAIL_API_KEY) return (fake ??= new FakeMail());
  return (real ??= new AgentMailClient());
}

/**
 * Whether Lease Inbox can be taught here (the manifest's `requires.integrations: ["agentmail"]`): a key, or the
 * fake on purpose (MAIL_FAKE=1: dev-chat, tests, evals). No key and no MAIL_FAKE is unmet, so production never
 * hands out a fake address.
 */
export function mailAvailability(): { ready: boolean; kind: "agentmail" | "fake" | "none"; hint?: string } {
  if (process.env.MAIL_FAKE === "1") return { ready: true, kind: "fake" };
  if (process.env.AGENTMAIL_API_KEY?.trim()) return { ready: true, kind: "agentmail" };
  return { ready: false, kind: "none", hint: "AGENTMAIL_API_KEY isn't set on the server." };
}
