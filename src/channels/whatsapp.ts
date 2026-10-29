// The WhatsApp Channel, on Baileys (an unofficial WhatsApp Web client; ADR 0001, ADR 0013). It only maps: socket
// events -> onboarding calls and IncomingMessage, Outgoing -> sendMessage. Everything it needs from the app comes in as
// WhatsAppDeps (whatsapp-boot.ts wires the real pipeline), the socket comes from a factory and the login from an
// auth loader, so this file never touches the DB and whatsapp.test.ts runs on a fake socket.
//
// Who is who (the canonical id, docs/whatsapp.md): WhatsApp names a person by a phone JID (<number>@s.whatsapp.net)
// or, in more and more groups, by a LID (<opaque>@lid) that hides the number. userExternalId / members.channel_user_id
// is ALWAYS the phone JID when we can resolve it (participantAlt / remoteJidAlt / senderPn on the message, the
// participant's phoneNumber in group metadata, Baileys' own LID map, or wa_contacts), and the LID only when we can't.
// Every LID <-> phone pair we learn goes to wa_contacts, and Members stored under that LID are moved to the phone JID
// (deps.rekeyUser), so a person keeps one Member and sendPrivate reaches them.
//
// Inbound: only `messages.upsert` with type "notify" (live messages; history sync and "append" are ignored), never our
// own, never status broadcasts or newsletters; group (@g.us) and 1:1 (@s.whatsapp.net / @lid) chats only. A bounded set
// of handled message ids plus "nothing older than 60 s before this socket connected" keeps a reconnect replay from
// answering twice. Work is queued per Chat, like Telegram.
//
// Anti-ban (ADR 0001): the intro waits JOIN_DELAY_MS after joining; every send shows "composing", waits a human-ish
// moment (REPLY_DELAY_MS overrides) and goes through token buckets per Chat and overall. Links go as trailing
// "text — url" lines (unofficial clients have no reliable URL buttons), never with previews.
import makeWASocket, {
  Browsers,
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
import { envMs, SendLimiter, sleep as realSleep } from "./rate-limit";
import { BAD_VOICE, chunkText, commandOf, helpText, MANY_GROUPS, NO_GROUP, NO_VOICE, OOPS, startReply, wasAddressed } from "./text";
import type { Channel, ChannelUser, IncomingMessage, Outgoing } from "./types";
import type { StoredAuth } from "./whatsapp-auth";
import type { WaContact } from "./whatsapp-store";

export const WHATSAPP_MAX_TEXT = 4096;
/** Messages older than this before the socket connected are a replay, not something to answer. */
export const STALE_MS = 60_000;

export type { WaContact };

export type WhatsAppDeps = {
  handleIncoming(msg: IncomingMessage): Promise<Outgoing | null>;
  onGroupJoined(chat: ChatRef, participants: ChannelUser[], addedBy: ChannelUser, opts: { dmHandle?: string }): Promise<{ intro: Outgoing | null }>;
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
};

/** The part of a Baileys socket the adapter uses (the tests' fake implements just this). */
export type WaSocket = {
  ev: { on<E extends keyof BaileysEventMap>(event: E, listener: (arg: BaileysEventMap[E]) => void): void };
  user?: { id: string; lid?: string; name?: string };
  sendMessage(jid: string, content: { text: string }): Promise<WAMessage | undefined>;
  sendPresenceUpdate(type: "composing" | "paused" | "available" | "unavailable", jid?: string): Promise<void>;
  readMessages(keys: WAMessageKey[]): Promise<void>;
  groupMetadata(jid: string): Promise<GroupMetadata>;
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
  /** Pause after "composing" before each reply. Default REPLY_DELAY_MS, else 1.2-3.2 s. */
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

  async sendToChat(chatExternalId: string, msg: Outgoing) {
    await this.flushIntro(chatExternalId);
    await this.send(chatExternalId, msg);
  }

  /** WhatsApp lets Roomie message anyone first, so there's no "message me first" path here. */
  async sendPrivate(userExternalId: string, msg: Outgoing) {
    const to = isLidUser(userExternalId) && this.opts.recipientOf ? await this.opts.recipientOf(userExternalId) : userExternalId;
    await this.send(to, msg);
  }

  /** Post the intro `ms` from now, or right before anything else Roomie says in that Chat. */
  introLater(chatExternalId: string, out: Outgoing, ms: number) {
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const timer = setTimeout(() => void this.flushIntro(chatExternalId), ms);
    this.intros.set(chatExternalId, { timer, out, done, resolve });
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

  private async send(jid: string, msg: Outgoing) {
    const sock = this.socket();
    if (!sock) throw new WhatsAppNotConnectedError();
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    await this.sleep(this.replyDelayMs ?? 1_200 + Math.floor(Math.random() * 2_000));
    for (const chunk of chunkText(withButtonLines(msg), WHATSAPP_MAX_TEXT)) {
      await this.limiter.acquire(jid);
      const live = this.socket();
      if (!live) throw new WhatsAppNotConnectedError();
      const sent = await live.sendMessage(jid, { text: chunk });
      if (sent) this.opts.onSent?.(sent);
    }
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
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

  const loadContacts = () =>
    (contactsLoaded ??= deps.contacts
      .all()
      .then((list) => book.load(list))
      .catch((err) => console.error("[whatsapp] couldn't load wa_contacts", err)));

  async function pnOfLid(lid: string): Promise<string | undefined> {
    const known = book.pnOf(lid);
    if (known) return known;
    const found = norm(await sock?.signalRepository?.lidMapping?.getPNForLID(lid).catch(() => null));
    if (found && isPnUser(found)) {
      await learn(lid, found);
      return found;
    }
    return undefined;
  }

  /** A LID <-> phone pair: remembered, stored, and Members under the LID move to the phone JID. */
  async function learn(lid: string, pn: string, name?: string) {
    if (book.pnOf(lid) === pn) return;
    book.pair(lid, pn);
    try {
      await deps.contacts.save({ lid, pn, name: name ?? book.nameOf(lid) ?? null });
      await deps.rekeyUser(lid, pn);
    } catch (err) {
      console.error(`[whatsapp] couldn't store ${lid} -> ${pn}`, err);
    }
  }

  /** Any ids WhatsApp gave for one person -> the canonical ChannelUser (phone JID when resolvable, else LID). */
  async function person(ids: (string | null | undefined)[], heardName?: string | null): Promise<ChannelUser | null> {
    const all = ids.map(norm).filter((j): j is string => !!j);
    const lid = all.find((j) => isLidUser(j));
    let pn = all.find((j) => isPnUser(j));
    if (pn && lid) await learn(lid, pn, heardName ?? undefined);
    else if (!pn && lid) pn = await pnOfLid(lid);
    const id = pn ?? lid ?? all[0];
    if (!id) return null;
    const placeholder = placeholderName(pn);
    const name = heardName?.trim();
    if (name && namesHeard.get(id) !== name) {
      namesHeard.set(id, name);
      const before = book.nameOf(id);
      book.setName(id, name);
      if (before !== name) {
        if (lid) await deps.contacts.save({ lid, pn: pn ?? null, name }).catch((err) => console.error("[whatsapp] couldn't store a name", err));
        await deps.nameSeen(id, name, placeholder).catch((err) => console.error("[whatsapp] couldn't update a name", err));
      }
    }
    return { userExternalId: id, name: name || book.nameOf(id) || placeholder };
  }

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

  /** Roomie is in a group it has no Chat for: everyone listed becomes an active Member, the adder the Admin. */
  async function joined(jid: string, adderIds: (string | null | undefined)[], given?: GroupMetadata) {
    if (joining.has(jid)) return;
    joining.add(jid);
    try {
      if (await deps.groupIdOfChat(jid)) return;
      const meta = given?.participants?.length ? given : await metadata(jid, true);
      if (!meta) return;
      metaCache.set(jid, meta);
      const people: ChannelUser[] = [];
      for (const p of meta.participants) {
        if (isMeParticipant(p)) continue;
        const { ids, name } = fromParticipant(p);
        const u = await person(ids, name);
        if (u) people.push(u);
      }
      const superAdmin = meta.participants.find((p) => p.admin === "superadmin" && !isMeParticipant(p));
      const adder =
        (adderIds.some((j) => j && !isMe(j)) ? await person(adderIds) : null) ??
        (meta.author && !isMe(meta.author) ? await person([meta.author, meta.authorPn]) : null) ??
        (meta.owner && !isMe(meta.owner) ? await person([meta.owner, meta.ownerPn]) : null) ??
        (superAdmin ? await person(fromParticipant(superAdmin).ids) : null) ??
        people[0];
      if (!adder) return;
      const named = people.find((p) => p.userExternalId === adder.userExternalId);
      const res = await deps.onGroupJoined({ channel: "whatsapp", externalId: jid, title: meta.subject || undefined }, people, named ?? adder, {});
      console.log(`[whatsapp] joined ${JSON.stringify(meta.subject ?? "")} (${jid}) with ${people.length} people, added by ${(named ?? adder).name}`);
      if (res.intro) channel.introLater(jid, res.intro, joinDelayMs);
    } finally {
      joining.delete(jid);
    }
  }

  async function participantsUpdate(e: BaileysEventMap["group-participants.update"]) {
    metaCache.delete(e.id);
    if (e.action === "add") {
      if (e.participants.some(isMeParticipant)) return joined(e.id, [e.author, e.authorPn]);
      const groupId = await deps.groupIdOfChat(e.id);
      if (!groupId) return; // a group Roomie never saw itself join: the first message there sorts it out
      for (const p of e.participants) {
        const { ids, name } = fromParticipant(p);
        const u = await person(ids, name);
        if (!u) continue;
        const res = await deps.onParticipantJoined(groupId, u);
        if (res.announce) await channel.sendToChat(e.id, res.announce);
      }
      return;
    }
    if (e.action === "remove" && e.participants.some(isMeParticipant)) {
      channel.dropIntro(e.id);
      console.log(`[whatsapp] removed from ${e.id}`);
    }
    // Someone else leaving or being removed: nothing to do (as on Telegram, Members stay until an Admin removes them).
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
  async function pipeline(msg: IncomingMessage, presenceJid: string, reply: (out: Outgoing) => Promise<void>) {
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

  /** Text, voice transcript or photo -> what the pipeline gets; null = nothing to pass on. */
  async function content(m: WAMessage, read: ReadMessage, replyTo: (out: Outgoing) => Promise<void>, toldKey: string, folderChat: string) {
    const base = { text: read.text, mentionsRoomie: read.mentionsRoomie, isReplyToRoomie: read.isReplyToRoomie };
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
    if (read.kind === "image") {
      const bytes = await download(m, sock!);
      return { ...base, imageUrl: await deps.saveImage(folderChat, m.key.id ?? String(clock()), bytes, read.mime ?? "image/jpeg") };
    }
    return base;
  }

  async function groupMessage(m: WAMessage, read: ReadMessage) {
    const jid = m.key.remoteJid!;
    const from = await person([m.key.participant, m.key.participantAlt, (m.key as { participantPn?: string }).participantPn], m.pushName);
    if (!from) return;
    if (!(await deps.groupIdOfChat(jid))) await joined(jid, [m.key.participant, m.key.participantAlt]); // joined while offline
    if (commandOf(read.text) === "help") return channel.sendToChat(jid, { text: helpText(await deps.tricksIn?.(jid).catch(() => undefined)) });
    const say = (out: Outgoing) => channel.sendToChat(jid, out);
    const got = await content(m, read, say, jid, jid);
    if (!got) return;
    const title = (await metadata(jid))?.subject || undefined;
    await pipeline({ channel: "whatsapp", chatExternalId: jid, ...(title ? { chatTitle: title } : {}), userExternalId: from.userExternalId, userName: from.name, ...got }, jid, say);
  }

  async function privateMessage(m: WAMessage, read: ReadMessage) {
    const jid = m.key.remoteJid!;
    const from = await person([jid, m.key.remoteJidAlt, (m.key as { senderPn?: string }).senderPn], m.pushName);
    if (!from) return;
    const say = (out: Outgoing) => channel.sendPrivate(jid, out);
    const command = commandOf(read.text);
    const chats = await deps.chatsOfUser(from.userExternalId);
    if (command === "help") return say({ text: helpText(chats.length === 1 ? await deps.tricksIn?.(chats[0]).catch(() => undefined) : undefined) });
    if (command === "start") return say({ text: startReply(from.name.split(" ")[0], chats.length, "whatsapp") });
    if (chats.length !== 1) {
      if (chats.length) return say({ text: MANY_GROUPS });
      if (toldNoGroup.has(from.userExternalId)) return;
      toldNoGroup.add(from.userExternalId);
      return say({ text: NO_GROUP });
    }
    const got = await content(m, read, say, `dm:${from.userExternalId}`, chats[0]);
    if (!got) return;
    await pipeline({ channel: "whatsapp", chatExternalId: chats[0], userExternalId: from.userExternalId, userName: from.name, ...got, isPrivate: true }, jid, say);
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
    for (const m of messages) {
      if (!fresh(m)) continue;
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
      for (const g of list) queue.push(g.id, () => joined(g.id, [g.author, g.authorPn], g));
    });
    s.ev.on("group-participants.update", (e) => s === sock && queue.push(e.id, () => participantsUpdate(e)));
    s.ev.on("groups.update", (list) => s === sock && queue.push("groups.update", () => groupsUpdate(list)));
    s.ev.on("lid-mapping.update", (p) => {
      const lid = norm(p.lid);
      const pn = norm(p.pn);
      if (s === sock && lid && pn && isLidUser(lid) && isPnUser(pn)) void learn(lid, pn);
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
