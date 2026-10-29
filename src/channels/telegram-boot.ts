// Wires the Telegram adapter to the app. telegramChannel() is outbound only (instrumentation registers it so the
// scheduler, approvals and Claim links reach Telegram from the Next process); telegramBot() adds the inbound handlers
// over the real pipeline (scripts/telegram.ts polls, app/api/telegram is the webhook). Only one process may receive
// updates: polling and a webhook can't both be on.
import { Api } from "grammy";
import { registerChannel } from "./index";
import { botInfoFromToken, createTelegramBot, TelegramChannel, type TelegramBot, type TelegramDeps } from "./telegram";

export const telegramToken = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || undefined;
export const telegramUsername = () => process.env.TELEGRAM_BOT_USERNAME?.trim().replace(/^@/, "") || undefined;
export const TOKEN_MISSING = "TELEGRAM_BOT_TOKEN missing; see docs/telegram.md";

type State = { channel?: TelegramChannel; bot?: Promise<TelegramBot> };
const state = (): State => {
  const g = globalThis as { __roomieTelegram?: State };
  return (g.__roomieTelegram ??= {});
};

/** The registered Telegram Channel, or null without a token. */
export function telegramChannel(): TelegramChannel | null {
  const token = telegramToken();
  if (!token) return null;
  const s = state();
  if (!s.channel) {
    s.channel = new TelegramChannel(new Api(token), { username: telegramUsername() });
    registerChannel(s.channel);
  }
  return s.channel;
}

/** The app behind the adapter. Imported lazily so instrumentation doesn't load the agent just to register a Channel. */
const clip = (s: string, n = 90) => {
  const one = s.replace(/\s+/g, " ").trim();
  return JSON.stringify(one.length > n ? `${one.slice(0, n - 1)}…` : one);
};

export async function telegramDeps(): Promise<TelegramDeps> {
  const [{ respondToIncoming }, onboarding, groups, { saveUpload }, voice] = await Promise.all([
    import("@/pipeline"),
    import("@/onboarding"),
    import("@/services/groups"),
    import("@/services/receipts"),
    import("@/lib/voice"),
  ]);
  return {
    // One "[roomie]" line per message (what the Gate decided, the tools, the time) and one per reply, for bug reports.
    handleIncoming: async (msg) => {
      const started = Date.now();
      const r = await respondToIncoming(msg);
      const tools = r.toolCalls.filter((t) => t !== "updateWorkingMemory");
      const gate = `${r.gate.decision}/${r.gate.reason}${r.gate.toolkit ? `/${r.gate.toolkit}` : ""}`;
      console.log(`[roomie] ${msg.isPrivate ? "dm" : "chat"} ${msg.chatExternalId} ${msg.userName}: ${clip(msg.text)} | gate ${gate}${tools.length ? ` | tools ${tools.join(",")}` : ""} | ${((Date.now() - started) / 1000).toFixed(1)}s${r.traceId ? ` | trace ${r.traceId}` : ""}`);
      console.log(`[roomie]   ${r.out ? `-> ${clip(r.out.text, 140)}${r.out.buttons?.length ? ` [${r.out.buttons.length} button${r.out.buttons.length === 1 ? "" : "s"}]` : ""}` : "(stays quiet)"}`);
      return r.out;
    },
    onGroupJoined: async (chat, participants, addedBy, opts) => {
      const res = await onboarding.onGroupJoined(chat, participants, addedBy, opts);
      console.log(`[roomie] joined ${clip(chat.title ?? "")} (${chat.externalId}), added by ${addedBy.name}; ${res.created ? `new Group ${res.group.id}, intro queued` : "already known"}`);
      return res;
    },
    onParticipantJoined: async (groupId, user) => {
      const res = await onboarding.onParticipantJoined(groupId, user);
      console.log(`[roomie] ${user.name} joined group ${groupId}: ${res.member.status}${res.announce ? ", asked the Admins to approve" : ""}`);
      return res;
    },
    groupIdOfChat: async (id) => (await groups.chatFor("telegram", id))?.group.id,
    chatsOfUser: async (userId) => (await groups.chatsOfChannelUser("telegram", userId)).map((c) => c.externalId),
    moveChat: (from, to) => groups.moveChat("telegram", from, to),
    saveImage: async (chatId, fileUniqueId, bytes) => {
      const saved = await saveUpload(`tg/${chatId}`, bytes, "image/jpeg", fileUniqueId);
      return saved.url || saved.path;
    },
    ...(process.env.OPENROUTER_API_KEY ? { transcribe: voice.transcribe } : {}),
  };
}

/**
 * The bot over the real pipeline, built once per process. `presetIdentity` (the webhook) takes the bot's id from the
 * token and TELEGRAM_BOT_USERNAME instead of calling getMe.
 */
export function telegramBot(opts: { presetIdentity?: boolean } = {}): Promise<TelegramBot> {
  const token = telegramToken();
  if (!token) throw new Error(TOKEN_MISSING);
  const s = state();
  const username = telegramUsername();
  return (s.bot ??= telegramDeps().then((deps) =>
    createTelegramBot({
      token,
      deps,
      channel: telegramChannel() ?? undefined,
      ...(opts.presetIdentity && username ? { botInfo: botInfoFromToken(token, username) } : {}),
    }),
  ));
}
