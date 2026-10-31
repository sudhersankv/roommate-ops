// The Telegram Channel, on grammY. It only maps: Telegram updates -> onboarding calls and IncomingMessage, Outgoing ->
// Bot API calls. Everything it needs from the app comes in as TelegramDeps (telegram-boot.ts wires the real pipeline),
// so this file never touches the DB and its tests run offline.
//
// Handlers return at once and queue the work per Chat: one slow agent run doesn't hold up other Chats (long polling
// handles updates one by one) and a webhook is answered right away; messages within a Chat stay in order.
//
// Anti-spam (ADR 0001): the intro waits JOIN_DELAY_MS after joining (sent early if Roomie has to speak sooner); every
// send shows "typing", waits a short human-like moment (REPLY_DELAY_MS overrides) and goes through token buckets
// (1/s per Chat, 20/min per group, 25/s overall). Links go as buttons, never previews.
import { Api, Bot, GrammyError, InlineKeyboard } from "grammy";
import type { ChatMember, Message, User, UserFromGetMe } from "grammy/types";
import type { ChatRef } from "@/onboarding";
import { KeyedQueue } from "./queue";
import { planDelivery } from "./humanize";
import { envMs, SendLimiter, sleep as realSleep } from "./rate-limit";
import { BAD_VOICE, chunkText, commandOf, helpText, MANY_GROUPS, MAX_TEXT, NO_GROUP, NO_VOICE, OOPS, startReply, wasAddressed } from "./text";
import { logPaused, roomiePaused } from "@/lib/kill-switch";
import { mediaWanted } from "@/mastra/gate/policy";
import { CantMessagePrivatelyError, type Button, type Channel, type ChannelUser, type IncomingMessage, type MediaQuestion, type Outgoing, type PollVote, type Sent } from "./types";

export const TELEGRAM_MAX_TEXT = MAX_TEXT;
export { chunkText, commandOf, helpText, OOPS, startReply };
/** The update types Roomie handles (polling and setWebhook ask for exactly these). */
export const TELEGRAM_UPDATES = ["message", "my_chat_member", "poll_answer"] as const;

export type TelegramDeps = {
  handleIncoming(msg: IncomingMessage): Promise<Outgoing | null>;
  /** `setupDm`: the Admin's private setup message (ADR 0014); tried at once, else sent when they press Start. */
  onGroupJoined(chat: ChatRef, participants: ChannelUser[], addedBy: ChannelUser, opts: { dmHandle?: string; participantCount?: number | null }): Promise<{ intro: Outgoing | null; setupDm?: Outgoing | null }>;
  /** /start in a DM: the setup DM when this person is the Admin of a Group still waiting for its setup, else null. */
  setupDmFor?(userExternalId: string): Promise<Outgoing | null>;
  /** The Chat's head count changed (people besides Roomie; null = unknown). Join link seats use it. */
  setParticipantCount?(chatExternalId: string, count: number | null): Promise<void>;
  /** The Group's Join link for /help ("dashboard: <link>"); undefined when there's none. */
  dashboardIn?(chatExternalId: string): Promise<string | undefined>;
  onParticipantJoined(groupId: string, user: ChannelUser): Promise<{ announce: Outgoing | null }>;
  groupIdOfChat(chatExternalId: string): Promise<string | undefined>;
  /** External ids of the Chats where this person is a Member (where their DMs belong). */
  chatsOfUser(userExternalId: string): Promise<string[]>;
  /** The Tricks (Toolkit ids) the Chat's Group taught Roomie, for /help; undefined when it's not a known Chat. */
  tricksIn?(chatExternalId: string): Promise<string[] | undefined>;
  moveChat(fromExternalId: string, toExternalId: string): Promise<void>;
  /** Store a photo where the server can read it; returns its URL. */
  saveImage(chatExternalId: string, fileUniqueId: string, bytes: Buffer): Promise<string>;
  /** Voice note -> text. Absent: Roomie says once per Chat that it can't hear voice notes yet. */
  transcribe?: (audio: ArrayBuffer, opts: { mime?: string; filename?: string }) => Promise<string>;
  /** A photo or voice note nobody @mentioned, replied to or named Roomie in: handle it anyway? (the pipeline's
   * mediaWantedFor: follow-up window, setup pending). Absent: no. */
  mediaWanted?: (q: MediaQuestion) => Promise<boolean>;
  /** An operator paused this Chat's Group (/admin/groups): Roomie answers nothing there, /help included. */
  chatPaused?: (chatExternalId: string) => Promise<boolean>;
  /** Someone answered (or took back) a Poll Roomie asked (the pipeline's handlePollVote). Absent: votes are dropped. */
  onPollVote?: (vote: PollVote) => Promise<void>;
};

/* ---------- pure helpers (telegram.test.ts) ---------- */

export const userName = (u: Pick<User, "first_name" | "last_name">) => [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || "Someone";
export const person = (u: User): ChannelUser => ({ userExternalId: String(u.id), name: userName(u) });

const isIn = (m: ChatMember) => m.status === "member" || m.status === "administrator" || m.status === "creator" || (m.status === "restricted" && m.is_member);
/** A my_chat_member change that means "Roomie was just added to this group". */
export function botWasAdded(u: { chat: { type: string }; old_chat_member: ChatMember; new_chat_member: ChatMember }): boolean {
  return (u.chat.type === "group" || u.chat.type === "supergroup") && isIn(u.new_chat_member) && !isIn(u.old_chat_member);
}

/** The message's text with "@<bot>" read as "Roomie", plus whether Roomie was mentioned or replied to. */
export function readAddress(me: Pick<UserFromGetMe, "id" | "username">, m: Pick<Message, "text" | "caption" | "entities" | "caption_entities" | "reply_to_message">) {
  const raw = m.text ?? m.caption ?? "";
  const handle = new RegExp(`@${me.username}\\b`, "gi");
  const entities = [...(m.entities ?? []), ...(m.caption_entities ?? [])];
  const mentionsRoomie = handle.test(raw) || entities.some((e) => e.type === "text_mention" && e.user.id === me.id);
  return {
    text: raw.replace(handle, "Roomie").trim(),
    mentionsRoomie,
    isReplyToRoomie: m.reply_to_message?.from?.id === me.id,
  };
}

/** Telegram refuses buttons that point at localhost; in local dev those links go as text instead. */
export const isButtonUrl = (url: string) => {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname);
  } catch {
    return false;
  }
};

export function keyboardFor(buttons: Button[] = []): InlineKeyboard | undefined {
  if (!buttons.length) return undefined;
  const kb = new InlineKeyboard();
  buttons.forEach((b, i) => {
    kb.url(b.text, b.url);
    if (i < buttons.length - 1) kb.row();
  });
  return kb;
}

/** A poll_answer update -> a PollVote (no user = an anonymous vote, which Roomie's polls never get). Empty option ids =
 * the vote was taken back. Telegram doesn't name the Chat: `chatExternalId` is empty and the Poll's id finds it. */
export function pollVoteFrom(a: { poll_id: string; user?: User; option_ids: number[] }): PollVote | null {
  if (!a.user || a.user.is_bot) return null;
  return { channel: "telegram", chatExternalId: "", pollExternalId: a.poll_id, userExternalId: String(a.user.id), optionIds: [...a.option_ids] };
}

export const dmFirstMessage = (username?: string) =>
  username ? `I can't DM you yet: tap @${username} and press Start, then ask me again.` : "I can't DM you yet: open a chat with me and press Start, then ask me again.";

/** The bot's identity from its token ("<id>:<secret>") and username, so the webhook needs no getMe call. */
export function botInfoFromToken(token: string, username: string): UserFromGetMe {
  return {
    id: Number(token.split(":")[0]),
    is_bot: true,
    first_name: "Roomie",
    username,
    can_join_groups: true,
    can_read_all_group_messages: true,
    supports_inline_queries: false,
    can_connect_to_business: false,
    has_main_web_app: false,
    has_topics_enabled: false,
    allows_users_to_create_topics: false,
    can_manage_bots: false,
    supports_join_request_queries: false,
  };
}


export const telegramLimiter = (opts: { clock?: () => number; sleep?: (ms: number) => Promise<void> } = {}) =>
  new SendLimiter({
    // Group ids are negative. Telegram: about 1 message/s in a chat, 20/min in a group, 30/s overall.
    perKey: (chatId) => (chatId.startsWith("-") ? [{ capacity: 1, perSecond: 1 }, { capacity: 20, perSecond: 20 / 60 }] : [{ capacity: 1, perSecond: 1 }]),
    global: { capacity: 25, perSecond: 25 },
    ...opts,
  });

/* ---------- the Channel (outbound) ---------- */

export type TelegramChannelOptions = {
  username?: string;
  limiter?: SendLimiter;
  sleep?: (ms: number) => Promise<void>;
  /** Pause after "typing" before each reply. Default REPLY_DELAY_MS, else 600-1800 ms. */
  replyDelayMs?: number;
};

export class TelegramChannel implements Channel {
  readonly name = "telegram" as const;
  readonly nativePolls = true;
  username?: string;
  private readonly limiter: SendLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly replyDelayMs?: number;
  private readonly intros = new Map<string, { timer: ReturnType<typeof setTimeout>; out: Outgoing; done: Promise<void>; resolve: () => void }>();
  private warnedLocalLinks = false;

  constructor(
    readonly api: Api,
    opts: TelegramChannelOptions = {},
  ) {
    this.username = opts.username;
    this.sleep = opts.sleep ?? realSleep;
    this.limiter = opts.limiter ?? telegramLimiter({ sleep: this.sleep });
    this.replyDelayMs = opts.replyDelayMs ?? envMs("REPLY_DELAY_MS");
  }

  async sendToChat(chatExternalId: string, msg: Outgoing): Promise<Sent> {
    await this.flushIntro(chatExternalId);
    return this.send(chatExternalId, msg);
  }

  async sendPrivate(userExternalId: string, msg: Outgoing): Promise<Sent> {
    try {
      return await this.send(userExternalId, msg);
    } catch (err) {
      // 403: the person never pressed Start (a bot can't open a 1:1 chat) or blocked Roomie.
      if (err instanceof GrammyError && (err.error_code === 403 || /chat not found/i.test(err.description))) throw new CantMessagePrivatelyError(dmFirstMessage(this.username));
      throw err;
    }
  }

  /** People in the Chat besides Roomie (Telegram counts bots too; Roomie is one). */
  async participantCount(chatExternalId: string): Promise<number | null> {
    try {
      return Math.max(0, (await this.api.getChatMemberCount(chatExternalId)) - 1);
    } catch {
      return null;
    }
  }

  /** Post the intro `ms` from now, or right before anything else Roomie says in that Chat. */
  introLater(chatExternalId: string, out: Outgoing, ms: number) {
    let resolve!: () => void;
    const done = new Promise<void>((r) => (resolve = r));
    const timer = setTimeout(() => void this.flushIntro(chatExternalId), ms);
    this.intros.set(chatExternalId, { timer, out, done, resolve });
  }

  /** Resolves when no intro is waiting (tests). */
  async idle() {
    while (this.intros.size) await Promise.all([...this.intros.values()].map((i) => i.done));
  }

  /** Leave the group (the intro, if still waiting, never goes out). */
  async leaveChat(chatExternalId: string) {
    this.dropIntro(chatExternalId);
    await this.api.leaveChat(chatExternalId);
  }

  /** The intro, if still waiting, never goes out (the Group was paused, or Roomie left). */
  dropIntro(chatExternalId: string) {
    const intro = this.intros.get(chatExternalId);
    if (!intro) return;
    this.intros.delete(chatExternalId);
    clearTimeout(intro.timer);
    intro.resolve();
  }

  private async flushIntro(chatExternalId: string) {
    const intro = this.intros.get(chatExternalId);
    if (!intro) return;
    this.intros.delete(chatExternalId);
    clearTimeout(intro.timer);
    try {
      await this.send(chatExternalId, intro.out);
    } catch (err) {
      console.error(`[telegram] intro to ${chatExternalId} failed`, err);
    } finally {
      intro.resolve();
    }
  }

  /** A Poll goes out as Telegram's own, non-anonymous (anonymous polls tell nobody who voted); its id is what
   * poll_answer updates point at. */
  private async sendPoll(chatId: string, poll: NonNullable<Outgoing["poll"]>): Promise<Sent> {
    await this.api.sendChatAction(chatId, "typing").catch(() => {});
    await this.sleep(this.replyDelayMs ?? 1_200);
    await this.limiter.acquire(chatId);
    const sent = await this.retryOn429(() => this.api.sendPoll(chatId, poll.question, poll.options, { is_anonymous: false, allows_multiple_answers: poll.multi }));
    return { externalId: sent.poll.id };
  }

  private async send(chatId: string, msg: Outgoing): Promise<Sent> {
    if (msg.poll) return this.sendPoll(chatId, msg.poll);
    const buttons = (msg.buttons ?? []).filter((b) => isButtonUrl(b.url));
    const asText = (msg.buttons ?? []).filter((b) => !isButtonUrl(b.url));
    if (asText.length && !this.warnedLocalLinks) {
      this.warnedLocalLinks = true;
      console.warn("[telegram] APP_URL is local, and Telegram won't take localhost buttons: sending those links as text (docs/telegram.md)");
    }
    const text = [msg.text, ...asText.map((b) => `${b.text}: ${b.url}`)].join("\n");
    // Typed like a person (humanize.ts): "typing…" sized to the text, then the bubble; the buttons ride on the last one.
    const bubbles = planDelivery(text);
    for (const [bi, bubble] of bubbles.entries()) {
      await this.api.sendChatAction(chatId, "typing").catch(() => {});
      await this.sleep(this.replyDelayMs ?? bubble.typingMs);
      const chunks = chunkText(bubble.text);
      for (const [i, chunk] of chunks.entries()) {
        const markup = bi === bubbles.length - 1 && i === chunks.length - 1 ? keyboardFor(buttons) : undefined;
        await this.limiter.acquire(chatId);
        await this.retryOn429(() => this.api.sendMessage(chatId, chunk, { link_preview_options: { is_disabled: true }, ...(markup ? { reply_markup: markup } : {}) }));
      }
    }
    return {};
  }

  private async retryOn429<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (!(err instanceof GrammyError) || err.error_code !== 429) throw err;
      await this.sleep((err.parameters.retry_after ?? 1) * 1000);
      return call();
    }
  }
}

/* ---------- the bot (inbound) ---------- */

export type TelegramBotOptions = {
  token: string;
  deps: TelegramDeps;
  /** Preset identity (tests, webhook); otherwise getMe on start. */
  botInfo?: UserFromGetMe;
  channel?: TelegramChannel;
  /** Default JOIN_DELAY_MS, else 60 s. */
  joinDelayMs?: number;
  /** Fetch a file by its Telegram file_path (tests stub it). */
  download?: (filePath: string) => Promise<ArrayBuffer>;
} & Omit<TelegramChannelOptions, "username">;

export type TelegramBot = { bot: Bot; channel: TelegramChannel; idle: () => Promise<void> };

export function createTelegramBot(opts: TelegramBotOptions): TelegramBot {
  const { deps } = opts;
  const bot = new Bot(opts.token, opts.botInfo ? { botInfo: opts.botInfo } : undefined);
  const channel =
    opts.channel ?? new TelegramChannel(bot.api, { username: opts.botInfo?.username, limiter: opts.limiter, sleep: opts.sleep, replyDelayMs: opts.replyDelayMs });
  const joinDelayMs = opts.joinDelayMs ?? envMs("JOIN_DELAY_MS") ?? 60_000;
  const download =
    opts.download ??
    (async (filePath: string) => {
      const res = await fetch(`https://api.telegram.org/file/bot${opts.token}/${filePath}`);
      if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
      return res.arrayBuffer();
    });
  const queue = new KeyedQueue("telegram");
  const toldNoVoice = new Set<string>();

  async function fetchFile(fileId: string) {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) throw new Error("Telegram gave no file path");
    return { bytes: await download(file.file_path), path: file.file_path };
  }

  async function joined(me: UserFromGetMe, chat: Message["chat"], adder: User, alsoAdded: User[]) {
    const externalId = String(chat.id);
    // Bots can't list a group's members: the chat's admins are the only ones Telegram names (ADR 0010).
    const admins = await bot.api
      .getChatAdministrators(externalId)
      .then((list) => list.map((a) => a.user).filter((u) => !u.is_bot))
      .catch(() => [] as User[]);
    const title = "title" in chat ? chat.title : undefined;
    const participantCount = await channel.participantCount(externalId);
    const res = await deps.onGroupJoined({ channel: "telegram", externalId, title }, [adder, ...alsoAdded, ...admins].map(person), person(adder), { dmHandle: me.username, participantCount });
    if (res.intro) channel.introLater(externalId, res.intro, joinDelayMs);
    // The Admin's setup DM: only reaches someone who pressed Start for Roomie before; otherwise /start sends it.
    if (res.setupDm) {
      await channel.sendPrivate(String(adder.id), res.setupDm).catch((err) => {
        if (err instanceof CantMessagePrivatelyError) console.log(`[telegram] setup DM for ${adder.id} waits for /start`);
        else console.error("[telegram] setup DM failed", err);
      });
    }
  }

  /** Someone joined or left: the Chat's head count for the Join link's free seats. */
  async function recount(chatId: string) {
    if (!deps.setParticipantCount) return;
    const n = await channel.participantCount(chatId);
    await deps.setParticipantCount(chatId, n).catch((err) => console.error(`[telegram] couldn't store the head count of ${chatId}`, err));
  }

  const helpFor = async (chatId: string) =>
    helpText(await deps.tricksIn?.(chatId).catch(() => undefined), { dashboard: await deps.dashboardIn?.(chatId).catch(() => undefined) });

  // A failed lookup counts as paused: /help and /start can wait, a paused Group shouldn't hear from Roomie.
  const paused = (chatId: string) =>
    deps.chatPaused?.(chatId).catch((err) => {
      console.error(`[telegram] pause check for ${chatId} failed; not answering /help or /start there`, err);
      return true;
    }) ?? Promise.resolve(false);

  /** Photos and voice notes are only fetched when Roomie is being talked to (policy.ts mediaWanted). */
  async function wanted(kind: "photo" | "voice", addressed: ReturnType<typeof readAddress>, from: User, chatId: string, isPrivate: boolean) {
    const flags = { kind, isPrivate, mentionsRoomie: addressed.mentionsRoomie, isReplyToRoomie: addressed.isReplyToRoomie, caption: addressed.text };
    // The pipeline's answer wins when it's wired in: it also knows about paused Groups.
    if (!deps.mediaWanted) return mediaWanted(flags);
    return deps.mediaWanted({ channel: "telegram", chatExternalId: chatId, userExternalId: String(from.id), ...flags }).catch((err) => {
      console.error("[telegram] media check failed", err);
      return false;
    });
  }

  /** Text, voice transcript or photo -> what the pipeline gets; null = nothing to pass on. */
  async function readContent(me: UserFromGetMe, m: Message, from: User, replyTo: string, folderChat: string, isPrivate = false) {
    const addressed = readAddress(me, m);
    if (m.voice) {
      // Not for Roomie: logged as "(voice note)", never downloaded or sent to the transcriber.
      if (!(await wanted("voice", addressed, from, folderChat, isPrivate))) return { ...addressed, text: "", skippedMedia: "voice" as const };
      if (!deps.transcribe) {
        if (!toldNoVoice.has(replyTo)) {
          toldNoVoice.add(replyTo);
          await channel.sendToChat(replyTo, { text: NO_VOICE });
        }
        return null;
      }
      try {
        const file = await fetchFile(m.voice.file_id);
        const text = await deps.transcribe(file.bytes, { mime: m.voice.mime_type, filename: file.path });
        if (!text.trim()) return null;
        return { ...addressed, text, isVoice: true };
      } catch (err) {
        console.error("[telegram] voice note", err);
        await channel.sendToChat(replyTo, { text: BAD_VOICE });
        return null;
      }
    }
    if (m.photo?.length) {
      // Not for Roomie: the caption goes on as text, the photo itself is never fetched or stored.
      if (!(await wanted("photo", addressed, from, folderChat, isPrivate))) return { ...addressed, skippedMedia: "photo" as const };
      const largest = m.photo[m.photo.length - 1];
      const file = await fetchFile(largest.file_id);
      return { ...addressed, imageUrl: await deps.saveImage(folderChat, largest.file_unique_id, Buffer.from(file.bytes)) };
    }
    if (m.text === undefined && m.caption === undefined) return null;
    if (/^\/\w+(@\w+)?/.test(m.text ?? "")) return null; // other commands (the "add to group" deep link posts /start)
    return addressed;
  }

  /** The pipeline, with failures logged and, when Roomie was clearly being talked to, one friendly line instead. */
  async function pipeline(msg: IncomingMessage, reply: (out: Outgoing) => Promise<unknown>) {
    let out: Outgoing | null;
    try {
      out = await deps.handleIncoming(msg);
    } catch (err) {
      console.error(`[roomie] couldn't handle a message from ${msg.userName} in ${msg.isPrivate ? "a DM" : `chat ${msg.chatExternalId}`}:`, err);
      if (wasAddressed(msg)) await reply({ text: OOPS }).catch(() => {});
      return;
    }
    if (out) await reply(out);
  }

  async function groupMessage(me: UserFromGetMe, m: Message, from: User) {
    const chatId = String(m.chat.id);
    if (commandOf(m.text, me.username) === "help") {
      if (await paused(chatId)) return;
      return channel.sendToChat(chatId, { text: await helpFor(chatId) });
    }
    const content = await readContent(me, m, from, chatId, chatId);
    if (!content) return;
    await pipeline(
      { channel: "telegram", chatExternalId: chatId, chatTitle: "title" in m.chat ? m.chat.title : undefined, userExternalId: String(from.id), userName: userName(from), ...content },
      (out) => channel.sendToChat(chatId, out),
    );
  }

  async function privateMessage(me: UserFromGetMe, m: Message, from: User) {
    const userId = String(from.id);
    const command = commandOf(m.text, me.username);
    const chats = await deps.chatsOfUser(userId);
    if ((command === "help" || command === "start") && chats.length === 1 && (await paused(chats[0]))) return;
    if (command === "help") return channel.sendPrivate(userId, { text: chats.length === 1 ? await helpFor(chats[0]) : helpText() });
    if (command === "start") {
      // The Admin who added Roomie pressed Start: now the setup DM can go out (ADR 0014).
      const setup = await deps.setupDmFor?.(userId).catch((err) => {
        console.error(`[telegram] setup DM lookup for ${userId} failed`, err);
        return null;
      });
      return channel.sendPrivate(userId, setup ?? { text: startReply(from.first_name, chats.length) });
    }
    // In several Groups: the pipeline works out which one this DM is about (ADR 0020), `chatExternalId` is a hint.
    if (!chats.length) return channel.sendPrivate(userId, { text: NO_GROUP });
    const content = await readContent(me, m, from, userId, chats[0], true);
    if (!content) return;
    await pipeline({ channel: "telegram", chatExternalId: chats[0], userExternalId: userId, userName: userName(from), ...content, isPrivate: true }, async (out) => void (await channel.sendPrivate(userId, out)));
  }

  bot.use(async (ctx, next) => {
    channel.username ??= ctx.me.username;
    // The kill switch: nothing is read, answered or joined (the webhook still answers 200, so nothing is replayed).
    if (roomiePaused()) return logPaused("Telegram updates");
    await next();
  });

  bot.on("my_chat_member", (ctx) => {
    const u = ctx.myChatMember;
    if (!botWasAdded(u)) return;
    queue.push(String(u.chat.id), () => joined(ctx.me, u.chat, u.from, []));
  });

  bot.on("message:new_chat_members", (ctx) => {
    const m = ctx.message;
    const me = ctx.me;
    const people = m.new_chat_members.filter((u) => !u.is_bot);
    const meAdded = m.new_chat_members.some((u) => u.id === me.id);
    const chatId = String(m.chat.id);
    queue.push(chatId, async () => {
      const groupId = await deps.groupIdOfChat(chatId);
      // Added together with Roomie: already there as far as Roomie is concerned (active on their first message).
      if (meAdded) {
        if (!groupId) await joined(me, m.chat, m.from, people);
        return;
      }
      if (!groupId) return; // a Chat Roomie never saw itself join: the pipeline sorts people out on their first message
      for (const u of people) {
        const res = await deps.onParticipantJoined(groupId, person(u));
        if (res.announce) await channel.sendToChat(chatId, res.announce);
      }
      await recount(chatId);
    });
  });

  bot.on("message:left_chat_member", (ctx) => {
    const chatId = String(ctx.message.chat.id);
    if (ctx.message.left_chat_member.id === ctx.me.id) return;
    queue.push(chatId, async () => {
      if (await deps.groupIdOfChat(chatId)) await recount(chatId);
    });
  });

  // A group upgraded to a supergroup gets a new id; both service messages arrive, the second update is a no-op.
  bot.on("message:migrate_to_chat_id", (ctx) => {
    const to = String(ctx.message.migrate_to_chat_id);
    queue.push(to, () => deps.moveChat(String(ctx.chat.id), to));
  });
  bot.on("message:migrate_from_chat_id", (ctx) => {
    const to = String(ctx.chat.id);
    queue.push(to, () => deps.moveChat(String(ctx.message.migrate_from_chat_id), to));
  });

  bot.on("message", (ctx) => {
    const m = ctx.message;
    const from = m.from;
    // Other bots, posts sent as a channel or an anonymous admin, and channel auto-forwards are not people.
    if (!from || from.is_bot || m.sender_chat || m.is_automatic_forward) return;
    const me = ctx.me;
    if (m.chat.type === "private") return queue.push(`dm:${from.id}`, () => privateMessage(me, m, from));
    if (m.chat.type === "group" || m.chat.type === "supergroup") queue.push(String(m.chat.id), () => groupMessage(me, m, from));
  });

  // A vote on one of Roomie's Polls (only non-anonymous polls send these). Telegram doesn't say which Chat: the Poll's
  // id is enough. Queued per Poll so one person's quick change of mind stays in order.
  bot.on("poll_answer", (ctx) => {
    const vote = pollVoteFrom(ctx.pollAnswer);
    if (!vote || !deps.onPollVote) return;
    queue.push(`poll:${vote.pollExternalId}`, () => deps.onPollVote!(vote).catch((err) => console.error("[telegram] poll vote failed", err)));
  });

  bot.catch((err) => console.error("[telegram] update failed", err.error));

  const idle = async () => {
    await queue.idle();
    await channel.idle();
    await queue.idle();
  };
  return { bot, channel, idle };
}
