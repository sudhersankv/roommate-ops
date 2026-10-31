// The WhatsApp Channel, on Baileys (an unofficial WhatsApp Web client; ADR 0001, ADR 0013). It only maps: socket
// events -> onboarding calls and IncomingMessage, Outgoing -> sendMessage. Everything it needs from the app comes in as
// WhatsAppDeps (whatsapp-boot.ts wires the real pipeline), the socket comes from a factory and the login from an
// auth loader, so this file never touches the DB and whatsapp.test.ts runs on a fake socket.
//
// Who is who (the canonical id, docs/whatsapp.md): WhatsApp names a person by a phone JID (<number>@s.whatsapp.net)
// or, in more and more groups, by a LID (<opaque>@lid) that hides the number. userExternalId / members.channel_user_id
// is ALWAYS the phone JID when we can resolve it (participantAlt / remoteJidAlt / senderPn on the message, the
// participant's phoneNumber in group metadata, Baileys' own LID map, or wa_contacts), and the LID only when we can't.
// Every LID <-> phone pair we learn is kept in memory; only Members' pairs (and names) go to wa_contacts, and Members
// stored under that LID are moved to the phone JID (deps.rekeyUser), so a person keeps one Member and sendPrivate
// reaches them.
//
// Photos and voice notes are fetched only when Roomie is being talked to (policy.ts mediaWanted, deps.mediaWanted);
// joins are checked against the beta allowlist (deps.admission) before anything is stored.
//
// Inbound: only `messages.upsert` with type "notify" (live messages; history sync and "append" are ignored), never our
// own, never status broadcasts or newsletters; group (@g.us) and 1:1 (@s.whatsapp.net / @lid) chats only. A bounded set
// of handled message ids plus "nothing older than 60 s before this socket connected" keeps a reconnect replay from
// answering twice. Work is queued per Chat, like Telegram.
//
// Anti-ban (ADR 0001): the intro waits JOIN_DELAY_MS after joining; every send shows "composing", waits a human-ish
// moment (REPLY_DELAY_MS overrides) and goes through token buckets per Chat and overall. Links go as trailing
// "text — url" lines (unofficial clients have no reliable URL buttons), never with previews.
import { createHash } from "node:crypto";
import makeWASocket, {
  Browsers,
  decryptPollVote,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  type AuthenticationState,
  type BaileysEventMap,
  type GroupMetadata,
  type GroupParticipant,
  type proto,
  type SocketConfig,
  type WAMessage,
  type WAMessageKey,
  type WAVersion,
} from "baileys";
import QRCode from "qrcode";
import type { ChatRef } from "@/onboarding";
import { KeyedQueue } from "./queue";
import { planDelivery } from "./humanize";
import { envMs, SendLimiter, sleep as realSleep } from "./rate-limit";
import { BAD_VOICE, chunkText, commandOf, helpText, MANY_GROUPS, NO_GROUP, NO_VOICE, OOPS, startReply, wasAddressed } from "./text";
import { logPaused, roomiePaused } from "@/lib/kill-switch";
import { mediaWanted } from "@/mastra/gate/policy";
import type { Channel, ChannelUser, IncomingMessage, MediaQuestion, Outgoing, PollVote, Sent } from "./types";
import type { StoredAuth } from "./whatsapp-auth";
import type { WaContact } from "./whatsapp-store";

export const WHATSAPP_MAX_TEXT = 4096;
/** Messages older than this before the socket connected are a replay, not something to answer. */
export const STALE_MS = 60_000;

export type { WaContact };

export type WhatsAppDeps = {
  handleIncoming(msg: IncomingMessage): Promise<Outgoing | null>;
  /** `refused`: Onboarding said no (too many new Groups from this adder today) and already left the Chat. */
  /** `setupDm`: the Admin's private setup message (ADR 0014), sent right away. */
  onGroupJoined(
    chat: ChatRef,
    participants: ChannelUser[],
    addedBy: ChannelUser,
    opts: { dmHandle?: string; participantCount?: number | null },
  ): Promise<{ intro: Outgoing | null; setupDm?: Outgoing | null; refused?: boolean }>;
  /** The Chat's head count changed (people besides Roomie). Join link seats use it. */
  setParticipantCount?(chatExternalId: string, count: number | null): Promise<void>;
  /** The Group's Join link for /help ("dashboard: <link>"); undefined when there's none. */
  dashboardIn?(chatExternalId: string): Promise<string | undefined>;
  onParticipantJoined(groupId: string, user: ChannelUser): Promise<{ announce: Outgoing | null }>;
  groupIdOfChat(chatExternalId: string): Promise<string | undefined>;
  /** External ids of the Chats where this person is a Member (where their DMs belong). */
  chatsOfUser(userExternalId: string): Promise<string[]>;
  /** The Tricks (Toolkit ids) the Chat's Group taught Roomie, for /help; undefined when it's not a known Chat. */
  tricksIn?(chatExternalId: string): Promise<string[] | undefined>;
  /** The group's subject changed. */
  renameChat(chatExternalId: string, title: string): Promise<void>;
  /** We learned the phone JID behind a LID: Members stored under the LID move to it. */
  rekeyUser(lid: string, pn: string): Promise<void>;
  /** We heard someone's name: Members still called `placeholder` take it. */
  nameSeen(userExternalId: string, name: string, placeholder: string): Promise<void>;
  contacts: { all(): Promise<WaContact[]>; save(c: WaContact): Promise<void> };
  /** Store a photo where the server can read it; returns its URL. */
  saveImage(chatExternalId: string, messageId: string, bytes: Buffer, mime: string): Promise<string>;
  /** Voice note -> text. Absent: Roomie says once per Chat that it can't hear voice notes yet. */
  transcribe?: (audio: ArrayBuffer, opts: { mime?: string; filename?: string }) => Promise<string>;
  /** A photo or voice note nobody @mentioned, replied to or named Roomie in: handle it anyway? (the pipeline's
   * mediaWantedFor: follow-up window, setup pending). Absent: no. */
  mediaWanted?: (q: MediaQuestion) => Promise<boolean>;
  /** May this person add Roomie to a group (the beta allowlist, services/whatsapp-access.ts)? `say` is the one line
   * before Roomie leaves. Absent: anyone may. */
  admission?: (adder: ChannelUser) => Promise<{ ok: true } | { ok: false; say: string }>;
  /** An operator paused this Chat's Group (/admin/groups): Roomie answers nothing there, /help included. */
  chatPaused?: (chatExternalId: string) => Promise<boolean>;
  /** A Poll Roomie sent, by its message id: the messageSecret its votes are encrypted with and its options, from the
   * polls table (the in-memory sent cache doesn't survive a restart). Absent or null: the vote can't be read. */
  pollSecret?: (pollExternalId: string) => Promise<{ secret: Uint8Array; options: string[] } | null>;
  /** Someone answered (or took back) a Poll Roomie asked (the pipeline's handlePollVote). */
  onPollVote?: (vote: PollVote) => Promise<void>;
};

/** The part of a Baileys socket the adapter uses (the tests' fake implements just this). */
export type WaSocket = {
  ev: { on<E extends keyof BaileysEventMap>(event: E, listener: (arg: BaileysEventMap[E]) => void): void };
  user?: { id: string; lid?: string; name?: string };
  sendMessage(jid: string, content: { text: string } | { poll: { name: string; values: string[]; selectableCount: number } }): Promise<WAMessage | undefined>;
  sendPresenceUpdate(type: "composing" | "paused" | "available" | "unavailable", jid?: string): Promise<void>;
  readMessages(keys: WAMessageKey[]): Promise<void>;
  groupMetadata(jid: string): Promise<GroupMetadata>;
  groupLeave(jid: string): Promise<void>;
  requestPairingCode(phoneNumber: string): Promise<string>;
  logout(msg?: string): Promise<void>;
  end(error: Error | undefined): unknown;
  updateMediaMessage(m: WAMessage): Promise<WAMessage>;
  signalRepository?: { lidMapping?: { getPNForLID(lid: string): Promise<string | null> } };
};

export type Logger = SocketConfig["logger"];

export type SocketArgs = {
  auth: AuthenticationState;
  version?: WAVersion;
  logger: Logger;
  getMessage: (key: WAMessageKey) => Promise<proto.IMessage | undefined>;
  cachedGroupMetadata: (jid: string) => Promise<GroupMetadata | undefined>;
};
export type SocketFactory = (args: SocketArgs) => WaSocket;

export type WhatsAppState = "disconnected" | "connecting" | "qr" | "pairing" | "open" | "logged_out";
export type WhatsAppStatus = {
  state: WhatsAppState;
  /** The QR to scan, as a PNG data URL (state "qr"). */
  qr?: string;
  /** The 8-character code to type on the phone (state "pairing"). */
  pairingCode?: string;
  me?: { jid: string; name?: string };
  /** Why it stopped, when it stopped on its own. */
  error?: string;
  /** When this state began (ms). */
  since: number;
};

export class WhatsAppNotConnectedError extends Error {
  name = "WhatsAppNotConnectedError";
  constructor() {
    super("WhatsApp isn't connected (docs/whatsapp.md).");
  }
}

/* ---------- pure helpers (whatsapp.test.ts) ---------- */

const norm = (jid?: string | null) => (jid ? jidNormalizedUser(jid) || undefined : undefined);
export const isGroupJid = (jid?: string | null) => !!isJidGroup(jid ?? undefined);
/** A person's 1:1 chat (phone JID or LID). */
export const isUserJid = (jid?: string | null) => !!(isPnUser(jid ?? undefined) || isLidUser(jid ?? undefined));
const userPart = (jid: string) => jid.split("@")[0].split(":")[0];

/** What a person is called before we hear their name: their number (from a phone JID), else "Someone". */
export const placeholderName = (pn?: string | null) => (pn ? `+${userPart(pn)}` : "Someone");

/** Links as trailing lines: unofficial clients get no URL buttons. */
export const withButtonLines = (msg: Outgoing) => [msg.text, ...(msg.buttons ?? []).map((b) => `${b.text} — ${b.url}`)].join("\n");

/** close -> reconnect delay: 1 s, 2 s, 4 s ... up to a minute. */
export const backoffMs = (attempt: number) => Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt));

export const statusCodeOf = (err: unknown): number | undefined => (err as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;

export const whatsappLimiter = (opts: { clock?: () => number; sleep?: (ms: number) => Promise<void> } = {}) =>
  new SendLimiter({
    // No published limits for WhatsApp Web; stay well under anything that looks like a bulk sender.
    perKey: (jid) => (jid.endsWith("@g.us") ? [{ capacity: 2, perSecond: 0.5 }, { capacity: 12, perSecond: 12 / 60 }] : [{ capacity: 2, perSecond: 0.5 }]),
    global: { capacity: 5, perSecond: 1 },
    ...opts,
  });

export type Me = { pn?: string; lid?: string };
export const meOf = (user?: WaSocket["user"]): Me => ({ pn: norm(user?.id), lid: norm(user?.lid) });
const isMeIn = (me: Me) => (jid?: string | null) => {
  const j = norm(jid);
  return !!j && (j === me.pn || j === me.lid);
};

export type ReadMessage = {
  text: string;
  kind: "text" | "voice" | "image";
  mime?: string;
  mentionsRoomie: boolean;
  isReplyToRoomie: boolean;
};

/**
 * A message's content, as Roomie reads it: the text (conversation, extended text or a caption) with "@<Roomie's
 * number>" read as "Roomie", whether Roomie was mentioned or replied to, and whether it's a voice note or a photo.
 * null = nothing to pass on (reactions, edits, stickers, polls, deletes...).
 */
export function readWaMessage(message: proto.IMessage | null | undefined, me: Me): ReadMessage | null {
  const content = normalizeMessageContent(message);
  if (!content) return null;
  const type = getContentType(content);
  if (!type) return null;
  const isMe = isMeIn(me);
  const ctx = (content[type] as { contextInfo?: proto.IContextInfo | null } | null | undefined)?.contextInfo ?? undefined;
  const raw = content.conversation || content.extendedTextMessage?.text || content.imageMessage?.caption || content.videoMessage?.caption || content.documentMessage?.caption || "";
  const handles = [me.pn, me.lid].filter(Boolean).map((j) => userPart(j!));
  const text = handles.length ? raw.replace(new RegExp(`@(?:${handles.join("|")})\\b`, "g"), "Roomie").trim() : raw.trim();
  const base = { text, mentionsRoomie: (ctx?.mentionedJid ?? []).some((j) => isMe(j)), isReplyToRoomie: isMe(ctx?.participant) };
  if (type === "audioMessage") return content.audioMessage?.ptt ? { ...base, kind: "voice", mime: content.audioMessage.mimetype ?? undefined } : null;
  if (type === "imageMessage") return { ...base, kind: "image", mime: content.imageMessage?.mimetype?.split(";")[0] ?? "image/jpeg" };
  return text ? { ...base, kind: "text" } : null;
}

/** A WhatsApp vote names options by SHA-256 of their text (as Baileys' getAggregateVotesInPollMessage hashes them). */
export const pollOptionHash = (option: string) => createHash("sha256").update(Buffer.from(option)).digest();

/** The selected option hashes of a decrypted vote -> 0-based indexes into `options` (unknown hashes dropped). */
export function optionIdsFromHashes(selected: readonly Uint8Array[], options: readonly string[]): number[] {
  const hashes = options.map(pollOptionHash);
  const ids = new Set<number>();
  for (const s of selected) {
    const i = hashes.findIndex((h) => h.equals(Buffer.from(s)));
    if (i >= 0) ids.add(i);
  }
  return [...ids].sort((a, b) => a - b);
}

/**
 * Baileys 7.0.0-rc14 doesn't decrypt votes itself (process-message.js has it commented out): a pollUpdateMessage's
 * vote is AES-GCM under a key derived from the poll's messageSecret, its message id, the creator's and the voter's
 * jids. Which jid form WhatsApp used (phone or LID) isn't on the message, so every pair is tried; GCM rejects the
 * wrong ones. Returns the selected option hashes, or null when nothing decrypts.
 */
export function decryptWaVote(vote: proto.Message.IPollEncValue, ctx: { pollMsgId: string; secret: Uint8Array; creatorJids: (string | undefined)[]; voterJids: (string | null | undefined)[] }): Uint8Array[] | null {
  const creators = [...new Set(ctx.creatorJids.map(norm).filter((j): j is string => !!j))];
  const voters = [...new Set(ctx.voterJids.map(norm).filter((j): j is string => !!j))];
  for (const pollCreatorJid of creators)
    for (const voterJid of voters) {
      try {
        const res = decryptPollVote(vote, { pollCreatorJid, pollMsgId: ctx.pollMsgId, pollEncKey: ctx.secret, voterJid });
        return (res.selectedOptions ?? []).map((o) => new Uint8Array(o));
      } catch {
        // not this pair
      }
    }
  return null;
}

/** Remembers the last `size` keys. */
export class BoundedSet {
  private readonly items = new Set<string>();
  constructor(private readonly size = 2_000) {}
  has = (k: string) => this.items.has(k);
  add(k: string) {
    this.items.add(k);
    if (this.items.size > this.size) this.items.delete(this.items.values().next().value!);
  }
}

/** LID <-> phone JID pairs and names, in memory (loaded from wa_contacts at start). */
export class ContactBook {
  private readonly pnByLid = new Map<string, string>();
  private readonly lidByPn = new Map<string, string>();
  private readonly names = new Map<string, string>();

  load(list: WaContact[]) {
    for (const c of list) {
      if (c.pn) this.pair(c.lid, c.pn);
      if (c.name) this.names.set(c.pn ?? c.lid, c.name);
    }
  }
  pair(lid: string, pn: string) {
    this.pnByLid.set(lid, pn);
    this.lidByPn.set(pn, lid);
  }
  pnOf = (lid: string) => this.pnByLid.get(lid);
  lidOf = (pn: string) => this.lidByPn.get(pn);
  nameOf = (id: string) => this.names.get(id) ?? this.names.get(this.pnByLid.get(id) ?? this.lidByPn.get(id) ?? "");
  setName = (id: string, name: string) => this.names.set(id, name);
}

/* ---------- the Channel (outbound) ---------- */

export type WhatsAppChannelOptions = {
  limiter?: SendLimiter;
  sleep?: (ms: number) => Promise<void>;
  /** Fixed "composing" pause per bubble (tests, REPLY_DELAY_MS). Default: sized to the text (humanize.ts). */
  replyDelayMs?: number;
  /** A LID recipient -> their phone JID when known. */
  recipientOf?: (jid: string) => Promise<string>;
  /** Every message we sent (kept for Baileys' retry requests). */
  onSent?: (m: WAMessage) => void;
};

export class WhatsAppChannel implements Channel {
  readonly name = "whatsapp" as const;
  private readonly limiter: SendLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly replyDelayMs?: number;
  private readonly intros = new Map<string, { timer: ReturnType<typeof setTimeout>; out: Outgoing; done: Promise<void>; resolve: () => void }>();

  constructor(
    private readonly socket: () => WaSocket | null,
    private readonly opts: WhatsAppChannelOptions = {},
  ) {
    this.sleep = opts.sleep ?? realSleep;
    this.limiter = opts.limiter ?? whatsappLimiter({ sleep: this.sleep });
    this.replyDelayMs = opts.replyDelayMs ?? envMs("REPLY_DELAY_MS");
  }

  readonly nativePolls = true;

  async sendToChat(chatExternalId: string, msg: Outgoing): Promise<Sent> {
    await this.flushIntro(chatExternalId);
    return this.send(chatExternalId, msg);
  }

  /** WhatsApp lets Roomie message anyone first, so there's no "message me first" path here. */
  async sendPrivate(userExternalId: string, msg: Outgoing): Promise<Sent> {
    const to = isLidUser(userExternalId) && this.opts.recipientOf ? await this.opts.recipientOf(userExternalId) : userExternalId;
    return this.send(to, msg);
  }

  /** A native poll (single choice = selectableCount 1, multi = 0). Its id and messageSecret come back so the polls row
   * can decrypt votes after a restart. */
  private async sendPoll(jid: string, poll: NonNullable<Outgoing["poll"]>): Promise<Sent> {
    const sock = this.socket();
    if (!sock) throw new WhatsAppNotConnectedError();
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    await this.sleep(this.replyDelayMs ?? 1_500);
    await this.limiter.acquire(jid);
    const live = this.socket();
    if (!live) throw new WhatsAppNotConnectedError();
    const sent = await live.sendMessage(jid, { poll: { name: poll.question, values: poll.options, selectableCount: poll.multi ? 0 : 1 } });
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
    if (!sent) return {};
    this.opts.onSent?.(sent);
    const secret = sent.message?.messageContextInfo?.messageSecret;
    return { ...(sent.key.id ? { externalId: sent.key.id } : {}), ...(secret ? { secret: new Uint8Array(secret) } : {}) };
  }

  /** Post the intro `ms` from now, or right before anything else Roomie says in that Chat. */
  introLater(chatExternalId: string, out: Outgoing, ms: number) {
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const timer = setTimeout(() => void this.flushIntro(chatExternalId), ms);
    this.intros.set(chatExternalId, { timer, out, done, resolve });
  }

  /** People in the group besides Roomie, from its metadata; null when not connected. */
  async participantCount(chatExternalId: string): Promise<number | null> {
    const sock = this.socket();
    if (!sock) return null;
    try {
      const meta = await sock.groupMetadata(chatExternalId);
      const isMe = isMeIn(meOf(sock.user));
      return meta.participants.filter((p) => ![p.id, p.phoneNumber, p.lid].some((j) => isMe(j))).length;
    } catch {
      return null;
    }
  }

  /** Leave the group (the intro, if still waiting, never goes out). */
  async leaveChat(chatExternalId: string) {
    this.dropIntro(chatExternalId);
    const sock = this.socket();
    if (!sock) throw new WhatsAppNotConnectedError();
    await sock.groupLeave(chatExternalId);
  }

  /** Roomie left the Chat: the intro never goes out. */
  dropIntro(chatExternalId: string) {
    const intro = this.intros.get(chatExternalId);
    if (!intro) return;
    this.intros.delete(chatExternalId);
    clearTimeout(intro.timer);
    intro.resolve();
  }

  /** Resolves when no intro is waiting (tests). */
  async idle() {
    while (this.intros.size) await Promise.all([...this.intros.values()].map((i) => i.done));
  }

  private async flushIntro(chatExternalId: string) {
    const intro = this.intros.get(chatExternalId);
    if (!intro) return;
    this.intros.delete(chatExternalId);
    clearTimeout(intro.timer);
    try {
      await this.send(chatExternalId, intro.out);
    } catch (err) {
      console.error(`[whatsapp] intro to ${chatExternalId} failed`, err);
    } finally {
      intro.resolve();
    }
  }

  /** Typed like a person (humanize.ts): "typing…", a pause sized to the text, then the bubble; longer replies in 2-3 bubbles. */
  private async send(jid: string, msg: Outgoing): Promise<Sent> {
    if (msg.poll) return this.sendPoll(jid, msg.poll);
    const sock = this.socket();
    if (!sock) throw new WhatsAppNotConnectedError();
    for (const bubble of planDelivery(withButtonLines(msg))) {
      await sock.sendPresenceUpdate("composing", jid).catch(() => {});
      await this.sleep(this.replyDelayMs ?? bubble.typingMs);
      for (const chunk of chunkText(bubble.text, WHATSAPP_MAX_TEXT)) {
        await this.limiter.acquire(jid);
        const live = this.socket();
        if (!live) throw new WhatsAppNotConnectedError();
        const sent = await live.sendMessage(jid, { text: chunk });
        if (sent) this.opts.onSent?.(sent);
      }
    }
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
    return {};
  }
}

/* ---------- the connection + inbound ---------- */

const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal", "silent"];

/** A small Baileys logger on the console: WA_LOG (default "warn") sets the level. */
export function waLogger(level = process.env.WA_LOG?.trim() || "warn", bindings: Record<string, unknown> = {}): Logger {
  const min = Math.max(0, LEVELS.indexOf(level));
  const at = (i: number) => (obj: unknown, msg?: string) => {
    if (i < min || level === "silent") return;
    const detail = obj && typeof obj === "object" ? ((obj as { err?: Error }).err?.message ?? JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? String(v) : v)).slice(0, 300)) : String(obj ?? "");
    (i >= 4 ? console.error : i === 3 ? console.warn : console.log)(`[whatsapp/baileys]${bindings.class ? ` ${bindings.class}` : ""} ${msg ?? ""} ${detail}`.trim());
  };
  return { level, child: (b) => waLogger(level, { ...bindings, ...b }), trace: at(0), debug: at(1), info: at(2), warn: at(3), error: at(4) };
}

/**
 * The real socket: Baileys with our auth, quiet presence and only the recent history sync (Baileys needs it for its
 * LID mappings; the messages in it arrive as "append" and are ignored).
 */
export const baileysSocket: SocketFactory = (args) =>
  makeWASocket({
    version: args.version,
    auth: { creds: args.auth.creds, keys: makeCacheableSignalKeyStore(args.auth.keys, args.logger) },
    logger: args.logger,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false, // the phone keeps getting notifications; less "always online bot"
    syncFullHistory: false,
    getMessage: args.getMessage,
    cachedGroupMetadata: args.cachedGroupMetadata,
  });

/** The WhatsApp Web version to speak (fetched at every connect; Baileys' bundled one when that fails). */
export const baileysVersion = async (): Promise<WAVersion | undefined> => {
  const { version, error } = await fetchLatestBaileysVersion();
  if (error) console.warn("[whatsapp] couldn't fetch the latest WhatsApp Web version, using Baileys' default");
  return version;
};

export type WhatsAppOptions = {
  deps: WhatsAppDeps;
  /** Loads the login (Postgres in the app, in memory in tests). Called again after a logout. */
  auth: () => Promise<StoredAuth>;
  socket?: SocketFactory;
  version?: () => Promise<WAVersion | undefined>;
  download?: (m: WAMessage, sock: WaSocket) => Promise<Buffer>;
  logger?: Logger;
  clock?: () => number;
  /** Runs `fn` after `ms` (reconnects); tests run it at once. */
  later?: (fn: () => void, ms: number) => unknown;
  /** Default JOIN_DELAY_MS, else 60 s. */
  joinDelayMs?: number;
  /** The raw QR string, for a terminal (scripts/whatsapp.ts). */
  onQr?: (qr: string) => void;
  onStatus?: (s: WhatsAppStatus) => void;
} & Omit<WhatsAppChannelOptions, "recipientOf" | "onSent">;

export type WhatsApp = {
  channel: WhatsAppChannel;
  status(): WhatsAppStatus;
  /** Connect (no-op when already connecting or open). `pairPhone` (digits with country code) asks for a pairing code instead of a QR. */
  start(opts?: { pairPhone?: string }): Promise<WhatsAppStatus>;
  /** Ask for a pairing code for this number; resolves when the code is there (or the attempt failed). */
  requestPairingCode(phone: string): Promise<WhatsAppStatus>;
  /** Unlink this device and forget the session. */
  logout(): Promise<WhatsAppStatus>;
  /** Close the socket, keep the session (shutdown). */
  stop(): Promise<void>;
  /** Whether a saved, linked session exists (boot connects only then). */
  hasSession(): Promise<boolean>;
  socket(): WaSocket | null;
  idle(): Promise<void>;
};

export function createWhatsApp(opts: WhatsAppOptions): WhatsApp {
  const { deps } = opts;
  const clock = opts.clock ?? Date.now;
  const later = opts.later ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const logger = opts.logger ?? waLogger();
  const makeSocket = opts.socket ?? baileysSocket;
  const download = opts.download ?? ((m: WAMessage, sock: WaSocket) => downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: (x) => sock.updateMediaMessage(x) }));
  const joinDelayMs = opts.joinDelayMs ?? envMs("JOIN_DELAY_MS") ?? 60_000;

  let sock: WaSocket | null = null;
  let auth: StoredAuth | null = null;
  let status: WhatsAppStatus = { state: "disconnected", since: clock() };
  let stopped = true;
  let attempt = 0;
  let connectedAt = 0;
  let pairPhone: string | undefined;
  let pairingAsked = false;
  let contactsLoaded: Promise<void> | null = null;
  const listeners = new Set<(s: WhatsAppStatus) => void>();

  const book = new ContactBook();
  const handled = new BoundedSet(2_000);
  const sent = new Map<string, proto.IMessage>();
  const metaCache = new Map<string, GroupMetadata>();
  const joining = new Set<string>();
  /** Groups Roomie said no to (the beta allowlist, the new-Groups cap) and left, until when (ms): messages that arrive
   * before the leave completes go nowhere. A new "Roomie was added" event clears it, and so does the hour passing. */
  const refusedUntil = new Map<string, number>();
  const REFUSAL_MS = 60 * 60 * 1000;
  const isRefused = (jid: string) => {
    const until = refusedUntil.get(jid);
    if (until === undefined) return false;
    if (until > clock()) return true;
    refusedUntil.delete(jid);
    return false;
  };
  const refuse = (jid: string) => refusedUntil.set(jid, clock() + REFUSAL_MS);
  /** LID -> the phone JID stored for it in wa_contacts (Members only, audit H3). */
  const storedPairs = new Map<string, string | null>();
  const toldNoVoice = new Set<string>();
  const toldNoGroup = new Set<string>();
  const namesHeard = new Map<string, string>();
  const queue = new KeyedQueue("whatsapp");

  const channel = new WhatsAppChannel(() => (status.state === "open" ? sock : null), {
    limiter: opts.limiter,
    sleep: opts.sleep,
    replyDelayMs: opts.replyDelayMs,
    recipientOf: async (lid) => (await pnOfLid(lid)) ?? lid,
    onSent: (m) => {
      if (!m.key.id || !m.message) return;
      sent.set(m.key.id, m.message);
      if (sent.size > 500) sent.delete(sent.keys().next().value!);
    },
  });

  function setStatus(next: Omit<WhatsAppStatus, "since">) {
    status = { ...next, since: clock() };
    for (const l of listeners) l(status);
    opts.onStatus?.(status);
  }

  const waitFor = (ok: (s: WhatsAppStatus) => boolean, ms: number) =>
    new Promise<WhatsAppStatus>((resolve) => {
      if (ok(status)) return resolve(status);
      const done = (s: WhatsAppStatus) => {
        if (!ok(s)) return;
        listeners.delete(done);
        clearTimeout(timer);
        resolve(s);
      };
      const timer = setTimeout(() => {
        listeners.delete(done);
        resolve(status);
      }, ms);
      listeners.add(done);
    });

  const me = (): Me => meOf(sock?.user);
  const isMe = (jid?: string | null) => isMeIn(me())(jid);

  /* ----- people ----- */

  // Pairs and names are known in memory for everyone (the ContactBook, plus Baileys' own LID map), but stored in
  // wa_contacts only for people who are, or are becoming, Members (audit H3): the join roster, later joiners,
  // senders in a Group's Chat, and DMs from Members.
  const loadContacts = () =>
    (contactsLoaded ??= deps.contacts
      .all()
      .then((list) => {
        book.load(list);
        for (const c of list) storedPairs.set(c.lid, c.pn ?? null);
      })
      .catch((err) => console.error("[whatsapp] couldn't load wa_contacts", err)));

  /** The phone JID behind a LID, from memory or Baileys' map (remembered in memory only). */
  async function pnOfLid(lid: string): Promise<string | undefined> {
    const known = book.pnOf(lid);
    if (known) return known;
    const found = norm(await sock?.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null));
    if (found && isPnUser(found)) {
      book.pair(lid, found);
      return found;
    }
    return undefined;
  }

  /** A Member's LID <-> phone pair: stored, and Members under the LID move to the phone JID. */
  async function keep(lid: string, pn: string, name?: string) {
    if (storedPairs.get(lid) === pn) return;
    try {
      await deps.contacts.save({ lid, pn, name: name ?? book.nameOf(lid) ?? null });
      storedPairs.set(lid, pn);
      await deps.rekeyUser(lid, pn);
    } catch (err) {
      console.error(`[whatsapp] couldn't store ${lid} -> ${pn}`, err);
    }
  }

  /**
   * Any ids WhatsApp gave for one person -> the canonical ChannelUser (phone JID when resolvable, else LID).
   * `member`: they are or are becoming a Member, so their pair and name are stored and their Member updated.
   */
  async function person(ids: (string | null | undefined)[], heardName?: string | null, opts: { member?: boolean } = {}): Promise<ChannelUser | null> {
    const all = ids.map(norm).filter((j): j is string => !!j);
    let pn = all.find((j) => isPnUser(j));
    // Only the phone JID on this message, but we know their LID (Baileys' map): a Member stored under it still moves.
    const lid = all.find((j) => isLidUser(j)) ?? (pn ? book.lidOf(pn) : undefined);
    if (pn && lid) book.pair(lid, pn);
    else if (!pn && lid) pn = await pnOfLid(lid);
    const id = pn ?? lid ?? all[0];
    if (!id) return null;
    const placeholder = placeholderName(pn);
    const name = heardName?.trim();
    if (name) book.setName(id, name);
    if (opts.member) {
      if (lid && pn) await keep(lid, pn, name);
      if (name && namesHeard.get(id) !== name) {
        namesHeard.set(id, name);
        if (lid) await deps.contacts.save({ lid, pn: pn ?? null, name }).catch((err) => console.error("[whatsapp] couldn't store a name", err));
        if (lid) storedPairs.set(lid, pn ?? storedPairs.get(lid) ?? null);
        await deps.nameSeen(id, name, placeholder).catch((err) => console.error("[whatsapp] couldn't update a name", err));
      }
    }
    return { userExternalId: id, name: name || book.nameOf(id) || placeholder };
  }
  const member = (ids: (string | null | undefined)[], heardName?: string | null) => person(ids, heardName, { member: true });

  const fromParticipant = (p: GroupParticipant | string) => {
    const x = typeof p === "string" ? { id: p } : p;
    return { ids: [x.id, x.phoneNumber, x.lid], name: x.notify ?? x.name ?? x.verifiedName, admin: x.admin ?? null };
  };
  const isMeParticipant = (p: GroupParticipant | string) => fromParticipant(p).ids.some((j) => isMe(j));

  async function metadata(jid: string, fresh = false): Promise<GroupMetadata | undefined> {
    if (!fresh && metaCache.has(jid)) return metaCache.get(jid);
    const meta = await sock?.groupMetadata(jid).catch((err) => {
      console.error(`[whatsapp] groupMetadata ${jid}`, err);
      return undefined;
    });
    if (meta) metaCache.set(jid, meta);
    return meta;
  }

  /* ----- group join ----- */

  /**
   * Roomie is in a group it has no Chat for: everyone listed becomes an active Member, the adder the Admin. Someone
   * the beta allowlist doesn't know (deps.admission) gets one line and Roomie leaves: no Group, nothing stored.
   * `adderIds` come from the join event (who added Roomie); without one (Roomie joined while offline) the adder is the
   * group's creator or a superadmin from the metadata, never whoever happens to speak first, and with an allowlist
   * on and nobody like that, the group is refused. Returns whether the Chat has a Group now.
   */
  async function joined(jid: string, adderIds: (string | null | undefined)[], given?: GroupMetadata): Promise<boolean> {
    if (isRefused(jid)) return false;
    if (roomiePaused()) {
      logPaused(`joining ${jid}`);
      return false;
    }
    if (joining.has(jid)) return true;
    joining.add(jid);
    try {
      if (await deps.groupIdOfChat(jid)) return true;
      const meta = given?.participants?.length ? given : await metadata(jid, true);
      if (!meta) return false;
      metaCache.set(jid, meta);
      // Resolved in memory first: nothing is stored until the adder is let in.
      const listed = meta.participants.filter((p) => !isMeParticipant(p)).map(fromParticipant);
      const people: ChannelUser[] = [];
      for (const { ids, name } of listed) {
        const u = await person(ids, name);
        if (u) people.push(u);
      }
      const superAdmin = meta.participants.find((p) => p.admin === "superadmin" && !isMeParticipant(p));
      const adderSource =
        (adderIds.some((j) => j && !isMe(j)) ? adderIds : null) ??
        (meta.author && !isMe(meta.author) ? [meta.author, meta.authorPn] : null) ??
        (meta.owner && !isMe(meta.owner) ? [meta.owner, meta.ownerPn] : null) ??
        (superAdmin ? fromParticipant(superAdmin).ids : null);
      const verified = adderSource ? await person(adderSource) : null;
      const adder = verified ?? people[0];
      if (!adder) return false;
      const named = people.find((p) => p.userExternalId === adder.userExternalId) ?? adder;
      // The allowlist only ever admits someone the join event or the metadata names, never "the first person listed".
      const admitted = deps.admission ? (verified ? await deps.admission(named) : await deps.admission({ userExternalId: "unknown", name: "unknown" })) : ({ ok: true } as const);
      if (!admitted.ok) {
        refuse(jid);
        metaCache.delete(jid);
        console.log(`[whatsapp] ${jid} added by ${named.userExternalId}, who isn't on the beta allowlist: saying so and leaving`);
        await channel.sendToChat(jid, { text: admitted.say }).catch((err) => console.error(`[whatsapp] couldn't say why in ${jid}`, err));
        await channel.leaveChat(jid).catch((err) => console.error(`[whatsapp] couldn't leave ${jid}`, err));
        return false;
      }
      const res = await deps.onGroupJoined({ channel: "whatsapp", externalId: jid, title: meta.subject || undefined }, people, named, { participantCount: people.length });
      if (res.refused) {
        refuse(jid);
        return false;
      }
      // They're Members now: store their pairs and names.
      for (const { ids, name } of listed) await member(ids, name);
      if (adderSource) await member(adderSource);
      console.log(`[whatsapp] joined ${JSON.stringify(meta.subject ?? "")} (${jid}) with ${people.length} people, added by ${named.name}`);
      if (res.intro) channel.introLater(jid, res.intro, joinDelayMs);
      // The Admin's setup DM goes out at once: WhatsApp lets Roomie message anyone (ADR 0014).
      if (res.setupDm) await channel.sendPrivate(named.userExternalId, res.setupDm).catch((err) => console.error(`[whatsapp] setup DM to the admin of ${jid} failed`, err));
      return true;
    } finally {
      joining.delete(jid);
    }
  }

  async function participantsUpdate(e: BaileysEventMap["group-participants.update"]) {
    metaCache.delete(e.id);
    if (e.action === "add") {
      if (e.participants.some(isMeParticipant)) {
        refusedUntil.delete(e.id); // added again: judge the new adder
        return void (await joined(e.id, [e.author, e.authorPn]));
      }
      const groupId = await deps.groupIdOfChat(e.id);
      if (!groupId) return; // a group Roomie never saw itself join: the first message there sorts it out
      for (const p of e.participants) {
        const { ids, name } = fromParticipant(p);
        const u = await member(ids, name);
        if (!u) continue;
        const res = await deps.onParticipantJoined(groupId, u);
        if (res.announce) await channel.sendToChat(e.id, res.announce);
      }
      await recount(e.id);
      return;
    }
    if (e.action === "remove" && e.participants.some(isMeParticipant)) {
      channel.dropIntro(e.id);
      console.log(`[whatsapp] removed from ${e.id}`);
      return;
    }
    // Someone else leaving or being removed: Members stay until an Admin removes them (as on Telegram); only the head
    // count changes.
    if (e.action === "remove") await recount(e.id);
  }

  /** The group's head count (people besides Roomie) for the Join link's free seats. */
  async function recount(jid: string) {
    if (!deps.setParticipantCount || !(await deps.groupIdOfChat(jid))) return;
    const meta = await metadata(jid, true);
    if (!meta) return;
    const n = meta.participants.filter((p) => !isMeParticipant(p)).length;
    await deps.setParticipantCount(jid, n).catch((err) => console.error(`[whatsapp] couldn't store the head count of ${jid}`, err));
  }

  async function groupsUpdate(updates: BaileysEventMap["groups.update"]) {
    for (const u of updates) {
      if (!u.id) continue;
      const cached = metaCache.get(u.id);
      if (cached) metaCache.set(u.id, { ...cached, ...u } as GroupMetadata);
      if (u.subject && (await deps.groupIdOfChat(u.id))) await deps.renameChat(u.id, u.subject);
    }
  }

  /* ----- messages ----- */

  /** The pipeline, with failures logged and, when Roomie was clearly being talked to, one friendly line instead. */
  async function pipeline(msg: IncomingMessage, presenceJid: string, reply: (out: Outgoing) => Promise<unknown>) {
    const addressed = wasAddressed(msg);
    if (addressed) await sock?.sendPresenceUpdate("composing", presenceJid).catch(() => {});
    let out: Outgoing | null = null;
    try {
      out = await deps.handleIncoming(msg);
    } catch (err) {
      console.error(`[roomie] couldn't handle a message from ${msg.userName} in ${msg.isPrivate ? "a DM" : `chat ${msg.chatExternalId}`}:`, err);
      if (addressed) await reply({ text: OOPS }).catch(() => {});
      return;
    } finally {
      if (addressed && !out) await sock?.sendPresenceUpdate("paused", presenceJid).catch(() => {});
    }
    if (out) await reply(out);
  }

  const helpFor = async (jid: string) =>
    helpText(await deps.tricksIn?.(jid).catch(() => undefined), { dashboard: await deps.dashboardIn?.(jid).catch(() => undefined) });

  // A failed lookup counts as paused: /help and /start can wait, a paused Group shouldn't hear from Roomie.
  const paused = (jid: string) =>
    deps.chatPaused?.(jid).catch((err) => {
      console.error(`[whatsapp] pause check for ${jid} failed; not answering /help or /start there`, err);
      return true;
    }) ?? Promise.resolve(false);

  /** Text, voice transcript or photo -> what the pipeline gets; null = nothing to pass on. */
  async function content(m: WAMessage, read: ReadMessage, replyTo: (out: Outgoing) => Promise<unknown>, toldKey: string, folderChat: string, from: ChannelUser, isPrivate = false) {
    const base = { text: read.text, mentionsRoomie: read.mentionsRoomie, isReplyToRoomie: read.isReplyToRoomie };
    const savePhoto = async () => deps.saveImage(folderChat, m.key.id ?? String(clock()), await download(m, sock!), read.mime ?? "image/jpeg");
    if (read.kind === "voice" || read.kind === "image") {
      const kind: "voice" | "photo" = read.kind === "voice" ? "voice" : "photo";
      const flags = { kind, isPrivate, mentionsRoomie: read.mentionsRoomie, isReplyToRoomie: read.isReplyToRoomie, caption: read.text };
      // The pipeline's answer wins when it's wired in: it also knows about paused Groups.
      const ask = async (gateActed?: boolean) => {
        const q = { ...flags, ...(gateActed ? { gateActed } : {}) };
        return deps.mediaWanted
          ? deps.mediaWanted({ channel: "whatsapp", chatExternalId: folderChat, userExternalId: from.userExternalId, ...q }).catch((err) => {
              console.error("[whatsapp] media check failed", err);
              return false;
            })
          : mediaWanted(q);
      };
      // Not for Roomie: logged as "(voice note)" / "(photo) caption", never downloaded, stored or transcribed; a photo
      // is fetched after all only if the Gate answers its caption.
      if (!(await ask())) {
        if (kind === "voice") return { ...base, text: "", skippedMedia: "voice" as const };
        const fetchSkippedPhoto = async () =>
          (await ask(true))
            ? savePhoto().catch((err) => {
                console.error("[whatsapp] photo", err);
                return null;
              })
            : null;
        return { ...base, skippedMedia: "photo" as const, fetchSkippedPhoto };
      }
    }
    if (read.kind === "voice") {
      if (!deps.transcribe) {
        if (!toldNoVoice.has(toldKey)) {
          toldNoVoice.add(toldKey);
          await replyTo({ text: NO_VOICE });
        }
        return null;
      }
      try {
        const bytes = await download(m, sock!);
        const text = await deps.transcribe(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { mime: read.mime, filename: "voice.ogg" });
        if (!text.trim()) return null;
        return { ...base, text, isVoice: true };
      } catch (err) {
        console.error("[whatsapp] voice note", err);
        await replyTo({ text: BAD_VOICE });
        return null;
      }
    }
    if (read.kind === "image") return { ...base, imageUrl: await savePhoto() };
    return base;
  }

  async function groupMessage(m: WAMessage, read: ReadMessage) {
    const jid = m.key.remoteJid!;
    if (isRefused(jid)) return;
    const senderIds = [m.key.participant, m.key.participantAlt, (m.key as { participantPn?: string }).participantPn];
    if (!(await deps.groupIdOfChat(jid))) {
      await person(senderIds, m.pushName); // in memory, so the join knows the sender's name
      // Joined while offline: who added Roomie isn't known, so the join goes by the metadata, never by this sender.
      if (!(await joined(jid, []))) return;
    }
    const from = await member(senderIds, m.pushName);
    if (!from) return;
    if (commandOf(read.text) === "help") {
      if (await paused(jid)) return;
      return channel.sendToChat(jid, { text: await helpFor(jid) });
    }
    const say = (out: Outgoing) => channel.sendToChat(jid, out);
    const got = await content(m, read, say, jid, jid, from);
    if (!got) return;
    const title = (await metadata(jid))?.subject || undefined;
    await pipeline({ channel: "whatsapp", chatExternalId: jid, ...(title ? { chatTitle: title } : {}), userExternalId: from.userExternalId, userName: from.name, ...got }, jid, say);
  }

  async function privateMessage(m: WAMessage, read: ReadMessage) {
    const jid = m.key.remoteJid!;
    const ids = [jid, m.key.remoteJidAlt, (m.key as { senderPn?: string }).senderPn];
    const from = await person(ids, m.pushName);
    if (!from) return;
    const say = (out: Outgoing) => channel.sendPrivate(jid, out);
    const command = commandOf(read.text);
    let chats = await deps.chatsOfUser(from.userExternalId);
    // A Member stored under their LID whose number we just learned: move them to it (rekey) first, then look again.
    const lid = ids.map(norm).find((j): j is string => !!j && !!isLidUser(j));
    if (!chats.length && lid && lid !== from.userExternalId && (await deps.chatsOfUser(lid)).length) {
      await member(ids, m.pushName);
      chats = await deps.chatsOfUser(from.userExternalId);
      if (!chats.length) {
        // The move didn't happen (yet): carry on as the LID, which is what their Member is stored under.
        chats = await deps.chatsOfUser(lid);
        from.userExternalId = lid;
      }
    } else if (chats.length) await member(ids, m.pushName); // a Member's DM: keep their pair and name
    if ((command === "help" || command === "start") && chats.length === 1 && (await paused(chats[0]))) return;
    if (command === "help") return say({ text: chats.length === 1 ? await helpFor(chats[0]) : helpText() });
    if (command === "start") return say({ text: startReply(from.name.split(" ")[0], chats.length, "whatsapp") });
    // In several Groups: the pipeline works out which one this DM is about (ADR 0020), `chatExternalId` is a hint.
    if (!chats.length) {
      if (toldNoGroup.has(from.userExternalId)) return;
      toldNoGroup.add(from.userExternalId);
      return say({ text: NO_GROUP });
    }
    const got = await content(m, read, say, `dm:${from.userExternalId}`, chats[0], from, true);
    if (!got) return;
    await pipeline({ channel: "whatsapp", chatExternalId: chats[0], userExternalId: from.userExternalId, userName: from.name, ...got, isPrivate: true }, jid, say);
  }

  /**
   * A vote on one of Roomie's Polls: the poll's secret and options come from the app (deps.pollSecret: the polls
   * row), the vote is decrypted here and its option hashes matched to the options. An empty selection = taken back.
   */
  async function pollVote(m: WAMessage, update: proto.Message.IPollUpdateMessage) {
    const pollId = update.pollCreationMessageKey?.id;
    if (!pollId || !update.vote || !deps.pollSecret || !deps.onPollVote) return;
    const poll = await deps.pollSecret(pollId).catch((err) => {
      console.error(`[whatsapp] couldn't load poll ${pollId}`, err);
      return null;
    });
    if (!poll) return; // not one of Roomie's polls (or long gone)
    const jid = m.key.remoteJid!;
    const voterIds = isGroupJid(jid) ? [m.key.participant, m.key.participantAlt, (m.key as { participantPn?: string }).participantPn] : [jid, m.key.remoteJidAlt];
    const { pn, lid } = me();
    const selected = decryptWaVote(update.vote, { pollMsgId: pollId, secret: poll.secret, creatorJids: [pn, lid], voterJids: voterIds });
    if (!selected) return console.warn(`[whatsapp] couldn't decrypt a vote on poll ${pollId}`);
    const voter = await member(voterIds, m.pushName);
    if (!voter) return;
    await deps
      .onPollVote({ channel: "whatsapp", chatExternalId: jid, pollExternalId: pollId, userExternalId: voter.userExternalId, optionIds: optionIdsFromHashes(selected, poll.options) })
      .catch((err) => console.error(`[whatsapp] poll vote on ${pollId} failed`, err));
  }

  /** Whether a live message is new: not ours, not a replay, not seen. */
  function fresh(m: WAMessage): boolean {
    const jid = m.key.remoteJid;
    if (!jid || !m.key.id || m.key.fromMe || !m.message || m.messageStubType) return false;
    if (isJidStatusBroadcast(jid) || isJidNewsletter(jid) || jid.endsWith("@broadcast")) return false;
    if (!isGroupJid(jid) && !isUserJid(jid)) return false;
    const ts = Number(m.messageTimestamp ?? 0) * 1000;
    if (ts && ts < connectedAt - STALE_MS) return false;
    const key = `${jid}:${m.key.id}`;
    if (handled.has(key)) return false;
    handled.add(key);
    return true;
  }

  function messagesUpsert({ messages, type }: BaileysEventMap["messages.upsert"]) {
    if (type !== "notify") return;
    if (roomiePaused()) return logPaused("WhatsApp messages"); // the kill switch: not even a read receipt
    for (const m of messages) {
      if (!fresh(m)) continue;
      const pollUpdate = normalizeMessageContent(m.message)?.pollUpdateMessage;
      if (pollUpdate) {
        const pollId = pollUpdate.pollCreationMessageKey?.id;
        if (pollId) queue.push(`poll:${pollId}`, () => pollVote(m, pollUpdate));
        continue;
      }
      const read = readWaMessage(m.message, me());
      if (!read) continue;
      const jid = m.key.remoteJid!;
      void sock?.readMessages([m.key]).catch(() => {});
      queue.push(isGroupJid(jid) ? jid : `dm:${norm(m.key.remoteJidAlt) ?? jid}`, () => (isGroupJid(jid) ? groupMessage(m, read) : privateMessage(m, read)));
    }
  }

  /* ----- connection ----- */

  async function connectionUpdate(s: WaSocket, u: BaileysEventMap["connection.update"]) {
    if (s !== sock) return; // an old socket's last words
    if (u.qr) {
      if (pairPhone && !pairingAsked) {
        pairingAsked = true;
        try {
          setStatus({ state: "pairing", pairingCode: await s.requestPairingCode(pairPhone) });
        } catch (err) {
          console.error("[whatsapp] pairing code request failed", err);
          setStatus({ state: "qr", qr: await QRCode.toDataURL(u.qr), error: "WhatsApp didn't give a pairing code; scan the QR or try again." });
        }
      } else if (!pairPhone) {
        setStatus({ state: "qr", qr: await QRCode.toDataURL(u.qr) });
        opts.onQr?.(u.qr);
      }
    }
    if (u.connection === "open") {
      attempt = 0;
      pairPhone = undefined;
      pairingAsked = false;
      const { pn } = me();
      setStatus({ state: "open", me: { jid: pn ?? s.user?.id ?? "", ...(s.user?.name ? { name: s.user.name } : {}) } });
      console.log(`[whatsapp] connected as ${s.user?.name ?? ""} (${pn ?? s.user?.id})`);
    }
    if (u.connection === "close") {
      sock = null;
      const code = statusCodeOf(u.lastDisconnect?.error);
      const wasLoggingIn = status.state === "qr" || status.state === "pairing";
      if (code === DisconnectReason.loggedOut) {
        stopped = true;
        await auth?.clear().catch((err) => console.error("[whatsapp] couldn't clear the session", err));
        auth = null;
        setStatus({ state: "logged_out", error: "WhatsApp unlinked this device. Log in again from /admin/whatsapp." });
        console.warn("[whatsapp] logged out: the session is cleared; log in again (docs/whatsapp.md)");
        return;
      }
      if (stopped) return setStatus({ state: "disconnected" });
      if (code === DisconnectReason.connectionReplaced) {
        stopped = true;
        console.warn("[whatsapp] another process opened this WhatsApp session; this one stops (docs/whatsapp.md: one process only)");
        return setStatus({ state: "disconnected", error: "Another process took over this WhatsApp session." });
      }
      if (wasLoggingIn && code === DisconnectReason.timedOut && !auth?.state.creds.registered) {
        stopped = true;
        return setStatus({ state: "disconnected", error: "The login wasn't finished in time (QR or code). Start again for a new one." });
      }
      const delay = code === DisconnectReason.restartRequired ? 0 : backoffMs(attempt++);
      console.warn(`[whatsapp] connection closed (${code ?? "?"} ${DisconnectReason[code ?? -1] ?? ""}), reconnecting in ${delay / 1000}s`);
      setStatus({ state: "connecting" });
      later(() => void connect().catch((err) => console.error("[whatsapp] reconnect failed", err)), delay);
    }
  }

  async function connect() {
    if (stopped || sock) return;
    setStatus({ state: "connecting" });
    auth ??= await opts.auth();
    await loadContacts();
    const version = await (opts.version ?? baileysVersion)().catch(() => undefined);
    if (stopped) return setStatus({ state: "disconnected" });
    connectedAt = clock();
    const s = makeSocket({
      auth: auth.state,
      version,
      logger,
      getMessage: async (key) => (key.id ? sent.get(key.id) : undefined),
      cachedGroupMetadata: async (jid) => metaCache.get(jid),
    });
    sock = s;
    const current = auth;
    s.ev.on("creds.update", () => void current.saveCreds().catch((err) => console.error("[whatsapp] couldn't save creds", err)));
    s.ev.on("connection.update", (u) => void connectionUpdate(s, u).catch((err) => console.error("[whatsapp] connection.update", err)));
    s.ev.on("messages.upsert", (e) => s === sock && messagesUpsert(e));
    s.ev.on("groups.upsert", (list) => {
      if (s !== sock) return;
      for (const g of list)
        queue.push(g.id, async () => {
          refusedUntil.delete(g.id);
          await joined(g.id, [g.author, g.authorPn], g);
        });
    });
    s.ev.on("group-participants.update", (e) => s === sock && queue.push(e.id, () => participantsUpdate(e)));
    s.ev.on("groups.update", (list) => s === sock && queue.push("groups.update", () => groupsUpdate(list)));
    // Every pair Baileys learns (contacts, members of every group the number is in): in memory only. Members' pairs
    // are stored when they show up (person(..., { member: true })).
    s.ev.on("lid-mapping.update", (p) => {
      const lid = norm(p.lid);
      const pn = norm(p.pn);
      if (s === sock && lid && pn && isLidUser(lid) && isPnUser(pn)) book.pair(lid, pn);
    });
  }

  const client: WhatsApp = {
    channel,
    status: () => status,
    socket: () => sock,
    async start(o = {}) {
      if (o.pairPhone) {
        pairPhone = o.pairPhone.replace(/\D/g, "");
        pairingAsked = false;
      }
      if (sock || !stopped) return status;
      stopped = false;
      await connect();
      return status;
    },
    async requestPairingCode(phone) {
      const digits = phone.replace(/\D/g, "");
      if (digits.length < 8 || digits.length > 15) throw new Error("Use the full number with its country code, digits only (e.g. 15551234567).");
      if (status.state === "open") throw new Error("Already linked. Log out first to link another number.");
      pairPhone = digits;
      pairingAsked = false;
      if (sock && (status.state === "qr" || status.state === "pairing")) {
        pairingAsked = true;
        setStatus({ state: "pairing", pairingCode: await sock.requestPairingCode(digits) });
        return status;
      }
      await client.start();
      return waitFor((s) => s.state === "pairing" || s.state === "open" || s.state === "disconnected" || s.state === "logged_out", 20_000);
    },
    async logout() {
      stopped = true;
      const s = sock;
      if (s) await s.logout().catch((err) => console.warn("[whatsapp] logout call failed; clearing the session anyway", err));
      sock = null;
      await (auth ?? (await opts.auth())).clear();
      auth = null;
      setStatus({ state: "logged_out" });
      return status;
    },
    async stop() {
      stopped = true;
      const s = sock;
      sock = null;
      if (s) await Promise.resolve(s.end(undefined)).catch(() => {});
      setStatus({ state: "disconnected" });
    },
    async hasSession() {
      auth ??= await opts.auth();
      return auth.hasSession;
    },
    async idle() {
      await queue.idle();
      await channel.idle();
      await queue.idle();
    },
  };
  return client;
}
