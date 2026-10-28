// THROWAWAY SPIKE: answers "does Baileys on this number connect, see group messages, reply, and DM?"
// Not app code. Nothing here is imported by src/. Delete once step 2 (WhatsApp channel) lands.
//
// Run:  npm start                     (shows a QR: WhatsApp on the bot phone > Linked devices > Link a device)
//       WA_PHONE=15551234567 npm start (pairing code instead of QR: digits only, with country code)
//
// In a group with the bot:   "roomie ping" | "roomie who" | "roomie dm" | @mention it | reply to it | send a voice note
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  isJidGroup,
  isJidStatusBroadcast,
  jidNormalizedUser,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
  type proto,
} from "baileys";
import qrcode from "qrcode-terminal";
import P from "pino";

const AUTH_DIR = "auth"; // gitignored. BACK THIS UP: with a rented number you can't re-verify if it's lost.
const JOIN_DELAY_MS = Number(process.env.WA_JOIN_DELAY_MS ?? 75_000); // wait after being added before the intro
const MIN_GAP_MS = 2_000; // global gap between outgoing messages

const logger = P({ level: process.env.WA_LOG ?? "warn" });
const sent = new Map<string, proto.IMessage>(); // for Baileys message retries
const introduced = new Set<string>();
let pairingRequested = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (min: number, max: number) => min + Math.floor(Math.random() * (max - min));
const ts = () => new Date().toLocaleTimeString();
const log = (tag: string, data: unknown) => console.log(`[${ts()}] ${tag}`, typeof data === "string" ? data : JSON.stringify(data));

// One outgoing queue: typing indicator, a human-ish pause, then send. Keeps a minimum gap between all sends.
let queue: Promise<void> = Promise.resolve();
let lastSentAt = 0;
function say(sock: WASocket, jid: string, text: string, quoted?: WAMessage) {
  queue = queue.then(async () => {
    const wait = lastSentAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    await sock.sendPresenceUpdate("composing", jid).catch(() => {});
    await sleep(jitter(1_200, 3_200));
    const res = await sock.sendMessage(jid, { text }, quoted ? { quoted } : undefined);
    if (res?.key.id && res.message) sent.set(res.key.id, res.message);
    await sock.sendPresenceUpdate("paused", jid).catch(() => {});
    lastSentAt = Date.now();
    log("SENT", { to: jid, text });
  }).catch((e) => log("SEND ERROR", String(e)));
  return queue;
}

function textOf(msg: proto.IMessage | null | undefined): string {
  if (!msg) return "";
  return msg.conversation ?? msg.extendedTextMessage?.text ?? msg.imageMessage?.caption ?? msg.videoMessage?.caption ?? "";
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version, isLatest } = await fetchLatestBaileysVersion();
  log("BOOT", { waVersion: version.join("."), isLatest, registered: state.creds.registered });

  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    browser: Browsers.macOS("Desktop"),
    markOnlineOnConnect: false, // keep the phone getting notifications; less "always online bot"
    syncFullHistory: false,
    getMessage: async (key) => (key.id ? sent.get(key.id) : undefined),
  });
  sock.ev.on("creds.update", saveCreds);

  const me = () => ({
    pn: sock.user?.id ? jidNormalizedUser(sock.user.id) : "",
    lid: sock.user?.lid ? jidNormalizedUser(sock.user.lid) : "",
  });
  const isMe = (jid?: string | null) => !!jid && [me().pn, me().lid].includes(jidNormalizedUser(jid));

  sock.ev.on("connection.update", async (u) => {
    const { connection, lastDisconnect, qr } = u;
    if (qr) {
      const phone = process.env.WA_PHONE?.replace(/\D/g, "");
      if (phone && !pairingRequested) {
        pairingRequested = true;
        const code = await sock.requestPairingCode(phone);
        log("PAIRING CODE", `${code}  -> WhatsApp on the bot phone: Linked devices > Link a device > Link with phone number`);
      } else if (!phone) {
        console.log("\nScan with WhatsApp on the BOT phone: Settings > Linked devices > Link a device\n");
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === "open") log("CONNECTED", me());
    if (connection === "close") {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        log("LOGGED OUT", "WhatsApp unlinked this session. Delete ./auth and pair again (needs the bot phone).");
        process.exit(1);
      }
      log("RECONNECTING", { code, reason: DisconnectReason[code ?? -1] ?? "unknown" });
      await sleep(code === DisconnectReason.restartRequired ? 0 : 3_000);
      start();
    }
  });

  // Roomie added to a group (or a group synced on connect).
  sock.ev.on("groups.upsert", async (groups) => {
    for (const g of groups) {
      log("GROUP UPSERT", {
        id: g.id,
        subject: g.subject,
        addressingMode: g.addressingMode,
        owner: g.owner,
        ownerPn: g.ownerPn,
        participants: g.participants.map((p) => ({ id: p.id, pn: p.phoneNumber, lid: p.lid, admin: p.admin ?? null })),
      });
      if (introduced.has(g.id)) continue;
      introduced.add(g.id);
      log("INTRO SCHEDULED", `${g.subject} in ${Math.round(JOIN_DELAY_MS / 1000)}s`);
      setTimeout(() => say(sock, g.id, "hey all 👋 roomie here (test mode). say \"roomie ping\" and I'll answer."), JOIN_DELAY_MS);
    }
  });

  sock.ev.on("group-participants.update", (e) => {
    log("PARTICIPANTS", {
      group: e.id,
      action: e.action,
      author: e.author,
      authorPn: e.authorPn,
      participants: e.participants.map((p) => ({ id: p.id, pn: p.phoneNumber, lid: p.lid })),
      includesMe: e.participants.some((p) => isMe(p.id) || isMe(p.phoneNumber) || isMe(p.lid)),
    });
  });

  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const m of messages) await onMessage(sock, m, isMe);
  });
}

async function onMessage(sock: WASocket, m: WAMessage, isMe: (jid?: string | null) => boolean) {
  const chat = m.key.remoteJid ?? "";
  if (!chat || isJidStatusBroadcast(chat)) return;
  const group = !!isJidGroup(chat);

  // Group system events ("X added Roomie") arrive as stub messages with no content.
  if (m.messageStubType) {
    log("STUB", { chat, stubType: m.messageStubType, params: m.messageStubParameters, author: m.key.participant, authorAlt: m.key.participantAlt });
    return;
  }
  if (!m.message || m.key.fromMe) return;

  const kind = getContentType(m.message);
  const text = textOf(m.message);
  const ctx = m.message.extendedTextMessage?.contextInfo ?? m.message.imageMessage?.contextInfo ?? undefined;
  const sender = group ? m.key.participant : chat;
  const senderAlt = group ? m.key.participantAlt : m.key.remoteJidAlt; // phone-number jid when sender is a @lid
  const mentioned = (ctx?.mentionedJid ?? []).some((j) => isMe(j));
  const repliedToMe = isMe(ctx?.participant);
  const voice = kind === "audioMessage" && !!m.message.audioMessage?.ptt;

  log("IN", { chat, group, sender, senderAlt, name: m.pushName, kind, text, mentioned, repliedToMe, voice });

  const addressed = /\broomie\b/i.test(text) || mentioned || repliedToMe || voice || !group;
  if (!addressed) return;

  await sock.readMessages([m.key]).catch(() => {});

  if (voice) {
    const buf = await downloadMediaMessage(m, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
    const secs = m.message.audioMessage?.seconds ?? 0;
    await say(sock, chat, `got your voice note 🎙️ ${(buf.length / 1024).toFixed(0)} KB, ${secs}s (transcription comes in step 2)`, m);
    return;
  }

  const cmd = text.toLowerCase();
  if (/\bping\b/.test(cmd)) {
    await say(sock, chat, "pong 🏓", m);
  } else if (/\bwho\b/.test(cmd) && group) {
    const meta = await sock.groupMetadata(chat);
    const admins = meta.participants.filter((p) => p.admin).map((p) => p.phoneNumber ?? p.id);
    await say(sock, chat, `"${meta.subject}": ${meta.participants.length} people, ${admins.length} admin(s). addressing: ${meta.addressingMode ?? "?"}`, m);
    log("META", { participants: meta.participants });
  } else if (/\bdm\b/.test(cmd)) {
    const to = senderAlt ?? sender;
    if (!to) return;
    await say(sock, to, `hey ${m.pushName ?? ""}, this is a private test message from roomie 🔒 (your id: ${sender})`);
    if (group) await say(sock, chat, "sent you a DM 👀", m);
  } else {
    await say(sock, chat, `👋 roomie (test mode). try: "roomie ping", "roomie who", "roomie dm", or send a voice note`, m);
  }
}

process.on("unhandledRejection", (e) => log("UNHANDLED", String(e)));
start();
