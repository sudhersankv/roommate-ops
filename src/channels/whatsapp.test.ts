// The WhatsApp adapter offline: a fake Baileys socket (an EventEmitter plus the calls the adapter makes), events fed
// by hand, every send captured. The app side (pipeline, onboarding, DB) is stubbed via WhatsAppDeps and the login
// lives in an in-memory wa_sessions. Run: npx tsx --test src/channels/whatsapp.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { aesEncryptGCM, hmacSign, proto, sha256, type GroupMetadata, type WAMessage } from "baileys";
import type { IncomingMessage } from "./types";
import { helpText, NO_GROUP, NO_VOICE } from "./text";
import { makeAuthState, type AuthRows } from "./whatsapp-auth";
import {
  backoffMs,
  createWhatsApp,
  decryptWaVote,
  optionIdsFromHashes,
  pollOptionHash,
  placeholderName,
  readWaMessage,
  waLogger,
  whatsappLimiter,
  withButtonLines,
  type WaContact,
  type WaSocket,
  type WhatsAppDeps,
} from "./whatsapp";

const GROUP = "120363000000000001@g.us";
const ROOMIE = { id: "15550000000:7@s.whatsapp.net", lid: "990000000000001:7@lid", name: "Roomie" };
const ROOMIE_PN = "15550000000@s.whatsapp.net";
const ROOMIE_LID = "990000000000001@lid";
const MAYA = { pn: "15551110001@s.whatsapp.net", lid: "880000000000001@lid" };
const SAM = { pn: "15551110002@s.whatsapp.net", lid: "880000000000002@lid" };
const DEV = { pn: "15551110003@s.whatsapp.net", lid: "880000000000003@lid" };

const NOW = 1_800_000_000_000;
/** A fixed messageSecret, so the vote vectors below are the same every run. */
const POLL_SECRET = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256);

class FakeSocket implements WaSocket {
  readonly emitter = new EventEmitter();
  ev = { on: (event: string, listener: (arg: unknown) => void) => void this.emitter.on(event, listener) } as WaSocket["ev"];
  user?: WaSocket["user"] = ROOMIE;
  sent: { jid: string; text: string }[] = [];
  presence: [string, string | undefined][] = [];
  read: string[] = [];
  pairingFor: string[] = [];
  loggedOut = false;
  ended = false;
  constructor(
    private readonly meta: Map<string, GroupMetadata>,
    private readonly lidMap: Map<string, string>,
  ) {}
  emit(event: string, arg: unknown) {
    this.emitter.emit(event, arg);
  }
  polls: { jid: string; name: string; values: string[]; selectableCount: number }[] = [];
  async sendMessage(jid: string, content: { text: string } | { poll: { name: string; values: string[]; selectableCount: number } }) {
    if ("poll" in content) {
      // What Baileys' generateWAMessageContent does: a random 32-byte messageSecret rides on the poll.
      this.polls.push({ jid, ...content.poll });
      const id = `poll${this.polls.length}`;
      return { key: { id, remoteJid: jid, fromMe: true }, message: { pollCreationMessageV3: { name: content.poll.name, options: content.poll.values.map((optionName) => ({ optionName })) }, messageContextInfo: { messageSecret: POLL_SECRET } } } as WAMessage;
    }
    this.sent.push({ jid, text: content.text });
    return { key: { id: `out${this.sent.length}`, remoteJid: jid, fromMe: true }, message: { conversation: content.text } } as WAMessage;
  }
  async sendPresenceUpdate(type: "composing" | "paused" | "available" | "unavailable", jid?: string) {
    this.presence.push([type, jid]);
  }
  async readMessages(keys: { id?: string | null }[]) {
    this.read.push(...keys.map((k) => k.id ?? ""));
  }
  async groupMetadata(jid: string) {
    const m = this.meta.get(jid);
    if (!m) throw new Error("no such group");
    return m;
  }
  left: string[] = [];
  async groupLeave(jid: string) {
    this.left.push(jid);
  }
  async requestPairingCode(phone: string) {
    this.pairingFor.push(phone);
    return "ABCD1234";
  }
  async logout() {
    this.loggedOut = true;
  }
  end() {
    this.ended = true;
  }
  async updateMediaMessage(m: WAMessage) {
    return m;
  }
  signalRepository = { lidMapping: { getPNForLID: async (lid: string) => this.lidMap.get(lid.split("@")[0].split(":")[0] + "@lid") ?? null } };
}

function memoryRows() {
  const rows = new Map<string, unknown>();
  const store: AuthRows = {
    get: async (keys) => new Map(keys.filter((k) => rows.has(k)).map((k) => [k, rows.get(k)])),
    set: async (list) => void list.forEach((r) => rows.set(r.key, JSON.parse(JSON.stringify(r.value)))),
    del: async (keys) => void keys.forEach((k) => rows.delete(k)),
    clear: async () => rows.clear(),
  };
  return { store, rows };
}

const groupMeta = (participants: GroupMetadata["participants"], extra: Partial<GroupMetadata> = {}): GroupMetadata => ({
  id: GROUP,
  subject: "Apt 4B",
  owner: undefined,
  participants,
  ...extra,
});

type Harness = ReturnType<typeof harness>;

function harness(opts: { deps?: Partial<WhatsAppDeps>; contacts?: WaContact[]; lidMap?: [string, string][]; meta?: GroupMetadata; transcribe?: boolean } = {}) {
  const meta = new Map<string, GroupMetadata>([
    [
      GROUP,
      opts.meta ??
        groupMeta([
          { id: MAYA.lid, phoneNumber: MAYA.pn, admin: "superadmin" },
          { id: SAM.lid, phoneNumber: SAM.pn, admin: null },
          { id: DEV.lid, admin: null }, // number hidden: stays a LID
          { id: ROOMIE_LID, phoneNumber: ROOMIE_PN, admin: null },
        ]),
    ],
  ]);
  const lidMap = new Map(opts.lidMap ?? []);
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const auth = memoryRows();
  const seen = {
    incoming: [] as IncomingMessage[],
    joined: [] as unknown[][],
    participants: [] as unknown[][],
    renamed: [] as string[][],
    rekeyed: [] as string[][],
    names: [] as string[][],
    saved: [] as WaContact[],
    images: [] as string[],
    transcribed: 0,
  };
  let known = new Set<string>();
  let now = NOW;
  const clock = () => now;
  const sleep = async (ms: number) => void (now += ms);
  const deps: WhatsAppDeps = {
    handleIncoming: async (msg) => {
      seen.incoming.push(msg);
      return { text: `ok ${msg.text}` };
    },
    onGroupJoined: async (...args) => {
      seen.joined.push(args);
      known.add(args[0].externalId);
      return { intro: { text: "intro" } };
    },
    onParticipantJoined: async (...args) => {
      seen.participants.push(args);
      return { announce: { text: `approve ${args[1].name}?` } };
    },
    groupIdOfChat: async (jid) => (known.has(jid) ? "g1" : undefined),
    chatsOfUser: async () => [GROUP],
    renameChat: async (jid, title) => void seen.renamed.push([jid, title]),
    rekeyUser: async (lid, pn) => void seen.rekeyed.push([lid, pn]),
    nameSeen: async (id, name, placeholder) => void seen.names.push([id, name, placeholder]),
    contacts: { all: async () => opts.contacts ?? [], save: async (c) => void seen.saved.push(c) },
    saveImage: async (jid, id) => {
      seen.images.push(id);
      return `/uploads/wa/${id}.jpg`;
    },
    ...(opts.transcribe === false
      ? {}
      : {
          transcribe: async () => {
            seen.transcribed++;
            return "remind me to pay rent";
          },
        }),
    ...opts.deps,
  };
  const wa = createWhatsApp({
    deps,
    auth: () => makeAuthState(auth.store),
    socket: () => {
      const s = new FakeSocket(meta, lidMap);
      sockets.push(s);
      return s;
    },
    version: async () => [2, 3000, 1],
    download: async () => Buffer.from([1, 2, 3]),
    logger: waLogger("silent"),
    clock,
    later: (fn, ms) => void timers.push({ fn, ms }),
    joinDelayMs: 0,
    replyDelayMs: 0,
    sleep,
    limiter: whatsappLimiter({ clock, sleep }),
  });
  const sock = () => sockets.at(-1)!;
  const settle = async () => {
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
      await new Promise((r) => setTimeout(r, 5));
    }
    await wa.idle();
  };
  /** Waits (up to 5 s) for something async the adapter does on its own, like rendering the QR. */
  const until = async (ok: () => boolean) => {
    for (let waited = 0; !ok() && waited < 5_000; waited += 10) await new Promise((r) => setTimeout(r, 10));
  };
  const open = async () => {
    await wa.start();
    sock().emit("connection.update", { connection: "open" });
    await settle();
  };
  const feed = async (messages: WAMessage[], type: "notify" | "append" = "notify") => {
    sock().emit("messages.upsert", { messages, type });
    await settle();
  };
  const markKnown = (jid = GROUP) => known.add(jid);
  const reset = () => (known = new Set());
  return { wa, auth, sockets, sock, timers, seen, settle, until, open, feed, markKnown, reset, advance: (ms: number) => (now += ms) };
}

let n = 1;
const msg = (over: { key?: Partial<WAMessage["key"]>; message?: WAMessage["message"]; pushName?: string; ts?: number } = {}): WAMessage =>
  ({
    key: { remoteJid: GROUP, id: `in${n++}`, fromMe: false, participant: MAYA.lid, participantAlt: MAYA.pn, ...over.key },
    message: over.message ?? { conversation: "roomie hi" },
    messageTimestamp: Math.floor((over.ts ?? NOW) / 1000),
    pushName: over.pushName ?? "Maya",
  }) as WAMessage;

const close = (statusCode: number) => ({ connection: "close", lastDisconnect: { error: Object.assign(new Error("closed"), { output: { statusCode } }), date: new Date() } });

describe("reading a message", () => {
  const me = { pn: ROOMIE_PN, lid: ROOMIE_LID };
  test("text, extended text and captions; @Roomie's number reads as Roomie; mention and reply-to flags", () => {
    assert.deepEqual(readWaMessage({ conversation: "hi all" }, me), { text: "hi all", kind: "text", mentionsRoomie: false, isReplyToRoomie: false });
    const mention = readWaMessage({ extendedTextMessage: { text: "@990000000000001 who owes what?", contextInfo: { mentionedJid: [ROOMIE_LID] } } }, me);
    assert.equal(mention?.text, "Roomie who owes what?");
    assert.equal(mention?.mentionsRoomie, true);
    assert.equal(readWaMessage({ extendedTextMessage: { text: "@15550000000 hey", contextInfo: { mentionedJid: [ROOMIE_PN] } } }, me)?.text, "Roomie hey");
    assert.equal(readWaMessage({ extendedTextMessage: { text: "@15551110002 hey", contextInfo: { mentionedJid: [SAM.pn] } } }, me)?.mentionsRoomie, false);
    assert.equal(readWaMessage({ extendedTextMessage: { text: "yes", contextInfo: { participant: "15550000000:7@s.whatsapp.net", stanzaId: "x" } } }, me)?.isReplyToRoomie, true);
    assert.equal(readWaMessage({ extendedTextMessage: { text: "yes", contextInfo: { participant: SAM.pn, stanzaId: "x" } } }, me)?.isReplyToRoomie, false);
    const photo = readWaMessage({ imageMessage: { caption: "split this", mimetype: "image/jpeg" } }, me);
    assert.deepEqual(photo, { text: "split this", kind: "image", mime: "image/jpeg", mentionsRoomie: false, isReplyToRoomie: false });
    assert.equal(readWaMessage({ ephemeralMessage: { message: { conversation: "disappearing" } } }, me)?.text, "disappearing");
  });

  test("voice notes are flagged; audio files, reactions, stickers and empty messages are not passed on", () => {
    assert.equal(readWaMessage({ audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus" } }, me)?.kind, "voice");
    assert.equal(readWaMessage({ audioMessage: { ptt: false } }, me), null);
    assert.equal(readWaMessage({ reactionMessage: { text: "👍" } }, me), null);
    assert.equal(readWaMessage({ stickerMessage: {} }, me), null);
    assert.equal(readWaMessage({ conversation: "" }, me), null);
    assert.equal(readWaMessage(null, me), null);
  });

  test("links become trailing 'text — url' lines; placeholders; backoff", () => {
    assert.equal(withButtonLines({ text: "Here you go", buttons: [{ text: "Open dashboard", url: "https://tryroomie.me/claim/abc" }] }), "Here you go\nOpen dashboard — https://tryroomie.me/claim/abc");
    assert.equal(withButtonLines({ text: "plain" }), "plain");
    assert.equal(placeholderName(MAYA.pn), "+15551110001");
    assert.equal(placeholderName(undefined), "Someone");
    assert.deepEqual([0, 1, 2, 3, 10].map(backoffMs), [1_000, 2_000, 4_000, 8_000, 60_000]);
  });
});

describe("incoming messages", () => {
  test("group text -> IncomingMessage with the phone JID as the sender, read receipt, composing, reply", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    await h.feed([msg()]);
    assert.deepEqual(h.seen.incoming, [
      { channel: "whatsapp", chatExternalId: GROUP, chatTitle: "Apt 4B", userExternalId: MAYA.pn, userName: "Maya", text: "roomie hi", mentionsRoomie: false, isReplyToRoomie: false },
    ]);
    assert.deepEqual(h.sock().sent, [{ jid: GROUP, text: "ok roomie hi" }]);
    assert.equal(h.sock().read.length, 1);
    assert.equal(h.sock().presence[0][0], "composing", "composing while the pipeline runs (addressed)");
    assert.deepEqual(h.seen.rekeyed, [[MAYA.lid, MAYA.pn]], "the LID -> phone pair is learned once");
    assert.deepEqual(h.seen.saved[0], { lid: MAYA.lid, pn: MAYA.pn, name: "Maya" });
    assert.deepEqual(h.seen.names, [[MAYA.pn, "Maya", "+15551110001"]]);
    await h.feed([msg()]);
    assert.equal(h.seen.rekeyed.length, 1, "nothing new to learn the second time");
  });

  test("photo with caption -> stored, imageUrl + caption passed on", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    await h.feed([msg({ key: { id: "PHOTO1" }, message: { imageMessage: { caption: "roomie split this", mimetype: "image/jpeg" } } })]);
    assert.deepEqual(h.seen.images, ["PHOTO1"]);
    assert.equal(h.seen.incoming[0].imageUrl, "/uploads/wa/PHOTO1.jpg");
    assert.equal(h.seen.incoming[0].text, "roomie split this");
  });

  const toRoomie = { participant: ROOMIE_PN, stanzaId: "r1" };

  test("voice note replying to Roomie -> transcript with isVoice; without a transcriber, one 'can't hear' line per Chat", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    await h.feed([msg({ message: { audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus", contextInfo: toRoomie } } })]);
    assert.equal(h.seen.transcribed, 1);
    assert.equal(h.seen.incoming[0].isVoice, true);
    assert.equal(h.seen.incoming[0].isReplyToRoomie, true, "still addressed, so the Gate hears it");
    assert.equal(h.seen.incoming[0].text, "remind me to pay rent");

    const deaf = harness({ transcribe: false });
    deaf.markKnown();
    await deaf.open();
    const voice = () => msg({ message: { audioMessage: { ptt: true, contextInfo: toRoomie } } });
    await deaf.feed([voice()]);
    await deaf.feed([voice()]);
    assert.deepEqual(deaf.sock().sent.map((s) => s.text), [NO_VOICE]);
    assert.equal(deaf.seen.incoming.length, 0);
  });

  test("a voice note or photo nobody addressed is never downloaded, stored or transcribed", async () => {
    const asked: unknown[] = [];
    const h = harness({
      deps: {
        mediaWanted: async (q) => {
          asked.push(q);
          return false;
        },
      },
    });
    h.markKnown();
    await h.open();
    await h.feed([msg({ message: { audioMessage: { ptt: true } } })]);
    await h.feed([msg({ key: { id: "PHOTO2" }, message: { imageMessage: { caption: "sunset", mimetype: "image/jpeg" } } })]);
    assert.equal(h.seen.transcribed, 0);
    assert.deepEqual(h.seen.images, []);
    assert.deepEqual(
      h.seen.incoming.map((m) => [m.text, m.skippedMedia, m.isVoice, m.imageUrl]),
      [
        ["", "voice", undefined, undefined],
        ["sunset", "photo", undefined, undefined],
      ],
    );
    assert.deepEqual(asked[0], { channel: "whatsapp", chatExternalId: GROUP, userExternalId: MAYA.pn, kind: "voice", caption: "", isPrivate: false, mentionsRoomie: false, isReplyToRoomie: false });
  });

  test("in the follow-up window or during setup (the pipeline says so), media is handled", async () => {
    const h = harness({ deps: { mediaWanted: async () => true } });
    h.markKnown();
    await h.open();
    await h.feed([msg({ message: { audioMessage: { ptt: true } } })]);
    await h.feed([msg({ key: { id: "PHOTO3" }, message: { imageMessage: { mimetype: "image/jpeg" } } })]);
    assert.equal(h.seen.transcribed, 1);
    assert.deepEqual(h.seen.images, ["PHOTO3"]);
  });

  test("ignored: our own, history ('append'), status broadcasts, replays from before the connect, duplicates", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    await h.feed([msg({ key: { fromMe: true } })]);
    await h.feed([msg()], "append");
    await h.feed([msg({ key: { remoteJid: "status@broadcast" } })]);
    await h.feed([msg({ key: { remoteJid: "123@newsletter" } })]);
    await h.feed([msg({ ts: NOW - 61_000 })]);
    assert.equal(h.seen.incoming.length, 0);
    const once = msg({ ts: NOW - 30_000 });
    await h.feed([once]);
    await h.feed([once]);
    assert.equal(h.seen.incoming.length, 1, "a recent message counts once, even when it's delivered twice");
  });

  test("/help in a group is the help text; other text goes through", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    await h.feed([msg({ message: { conversation: "/help" } })]);
    assert.deepEqual(h.sock().sent.map((s) => s.text), [helpText()]);
    assert.equal(h.seen.incoming.length, 0);
  });

  test("/help in a group lists the Tricks that group taught Roomie", async () => {
    const h = harness({ deps: { tricksIn: async () => ["splitting"] } });
    h.markKnown();
    await h.open();
    await h.feed([msg({ message: { conversation: "/help" } })]);
    assert.deepEqual(h.sock().sent.map((s) => s.text), [helpText(["splitting"])]);
  });

  test("a 1:1 message from a Member of one Group -> isPrivate, answered in the DM", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    await h.feed([msg({ key: { remoteJid: SAM.lid, remoteJidAlt: SAM.pn, participant: undefined, participantAlt: undefined }, pushName: "Sam", message: { conversation: "send me the dashboard" } })]);
    assert.deepEqual(h.seen.incoming, [
      { channel: "whatsapp", chatExternalId: GROUP, userExternalId: SAM.pn, userName: "Sam", text: "send me the dashboard", mentionsRoomie: false, isReplyToRoomie: false, isPrivate: true },
    ]);
    assert.deepEqual(h.sock().sent, [{ jid: SAM.pn, text: "ok send me the dashboard" }], "a LID chat is answered at the phone JID");
  });

  test("a 1:1 message from someone in no Group: one 'add me first' line, then quiet", async () => {
    const h = harness({ deps: { chatsOfUser: async () => [] } });
    await h.open();
    const dm = () => msg({ key: { remoteJid: "15559990000@s.whatsapp.net", participant: undefined, participantAlt: undefined }, message: { conversation: "hello?" } });
    await h.feed([dm()]);
    await h.feed([dm()]);
    assert.deepEqual(h.sock().sent.map((s) => s.text), [NO_GROUP]);
    assert.equal(h.seen.incoming.length, 0);
  });

  test("a pipeline failure on an addressed message -> one friendly line", async () => {
    const h = harness({
      deps: {
        handleIncoming: async () => {
          throw new Error("boom");
        },
      },
    });
    h.markKnown();
    const err = console.error;
    console.error = () => {};
    try {
      await h.open();
      await h.feed([msg()]);
      await h.feed([msg({ message: { conversation: "just chatting" } })]);
    } finally {
      console.error = err;
    }
    assert.equal(h.sock().sent.length, 1);
    assert.match(h.sock().sent[0].text, /went sideways/);
  });
});

describe("who is who (LIDs)", () => {
  test("a LID with no phone on the message resolves through Baileys' map, and is stored", async () => {
    const h = harness({ lidMap: [[SAM.lid, SAM.pn]] });
    h.markKnown();
    await h.open();
    await h.feed([msg({ key: { participant: SAM.lid, participantAlt: undefined }, pushName: "Sam" })]);
    assert.equal(h.seen.incoming[0].userExternalId, SAM.pn);
    assert.deepEqual(h.seen.rekeyed, [[SAM.lid, SAM.pn]]);
  });

  test("a pair already in wa_contacts needs no lookup; an unknown LID stays the id", async () => {
    const h = harness({ contacts: [{ lid: SAM.lid, pn: SAM.pn, name: "Sam" }] });
    h.markKnown();
    await h.open();
    await h.feed([msg({ key: { participant: SAM.lid, participantAlt: undefined }, pushName: "Sam" })]);
    await h.feed([msg({ key: { participant: DEV.lid, participantAlt: undefined }, pushName: "Dev" })]);
    assert.deepEqual(
      h.seen.incoming.map((m) => m.userExternalId),
      [SAM.pn, DEV.lid],
    );
    assert.deepEqual(h.seen.rekeyed, [], "nothing new learned");
  });

  test("sendPrivate to a LID goes to the phone JID when known, else to the LID", async () => {
    const h = harness({ contacts: [{ lid: SAM.lid, pn: SAM.pn }] });
    await h.open();
    await h.wa.channel.sendPrivate(SAM.lid, { text: "your link" });
    await h.wa.channel.sendPrivate(DEV.lid, { text: "your link" });
    assert.deepEqual(
      h.sock().sent.map((s) => s.jid),
      [SAM.pn, DEV.lid],
    );
  });
});

describe("sending", () => {
  test("buttons as trailing lines, long text in 4096-character chunks, composing then paused", async () => {
    const h = harness();
    await h.open();
    await h.wa.channel.sendToChat(GROUP, { text: "Logged it", buttons: [{ text: "Open dashboard", url: "https://tryroomie.me/g/1" }] });
    assert.deepEqual(h.sock().sent, [{ jid: GROUP, text: "Logged it\nOpen dashboard — https://tryroomie.me/g/1" }]);
    await h.wa.channel.sendToChat(GROUP, { text: `${"a".repeat(4000)}\n${"b".repeat(1000)}` });
    assert.deepEqual(
      h.sock().sent.slice(1).map((s) => s.text.length),
      [4000, 1000],
    );
    assert.deepEqual(
      h.sock().presence.slice(0, 2).map((p) => p[0]),
      ["composing", "paused"],
    );
  });

  test("not connected -> the send fails (the scheduler retries later)", async () => {
    const h = harness();
    await assert.rejects(() => h.wa.channel.sendToChat(GROUP, { text: "hi" }), /isn't connected/);
  });
});

describe("groups", () => {
  test("Roomie added -> onGroupJoined with the whole roster (phone JIDs when known), the adder as Admin, then the intro", async () => {
    const h = harness();
    await h.open();
    h.sock().emit("group-participants.update", { id: GROUP, author: MAYA.lid, authorPn: MAYA.pn, action: "add", participants: [{ id: ROOMIE_LID, phoneNumber: ROOMIE_PN }] });
    await h.settle();
    assert.equal(h.seen.joined.length, 1);
    const [chat, participants, addedBy, opts] = h.seen.joined[0];
    assert.deepEqual(chat, { channel: "whatsapp", externalId: GROUP, title: "Apt 4B" });
    assert.deepEqual(participants, [
      { userExternalId: MAYA.pn, name: "+15551110001" },
      { userExternalId: SAM.pn, name: "+15551110002" },
      { userExternalId: DEV.lid, name: "Someone" },
    ]);
    assert.deepEqual(addedBy, { userExternalId: MAYA.pn, name: "+15551110001" });
    assert.deepEqual(opts, { participantCount: 3 }, "no 'press Start' line (WhatsApp can DM anyone); the head count, Roomie not included");
    assert.deepEqual(h.sock().sent, [{ jid: GROUP, text: "intro" }]);
  });

  test("the Admin's setup DM goes out right away, the Claim link as a trailing line; the intro still waits", async () => {
    const dm = { text: "Hi 👋 You added me to Apt 4B, so you're its admin.\nAnswer the setup here or in the group: what's the group for, currency, city.", buttons: [{ text: "Open dashboard", url: "https://tryroomie.me/claim/abc" }] };
    const h = harness({ deps: { onGroupJoined: async (...args) => (h.seen.joined.push(args), { intro: { text: "intro" }, setupDm: dm }) } });
    await h.open();
    h.sock().emit("group-participants.update", { id: GROUP, author: MAYA.lid, authorPn: MAYA.pn, action: "add", participants: [{ id: ROOMIE_LID, phoneNumber: ROOMIE_PN }] });
    await h.settle();
    const toMaya = h.sock().sent.find((s) => s.jid === MAYA.pn);
    assert.ok(toMaya, "the DM went to the adder's phone JID");
    assert.match(toMaya!.text, /Answer the setup here or in the group/);
    assert.match(toMaya!.text, /Open dashboard — https:\/\/tryroomie\.me\/claim\/abc/);
    assert.ok(!h.sock().sent.some((s) => s.jid === GROUP && /claim/.test(s.text)), "no Claim link in the group");
  });

  test("people added or leaving refresh the head count; /help names the Join link", async () => {
    const counts: [string, number | null][] = [];
    const h = harness({ deps: { setParticipantCount: async (id, n) => void counts.push([id, n]), dashboardIn: async () => "https://tryroomie.me/j/abcdefghij" } });
    h.markKnown();
    await h.open();
    h.sock().emit("group-participants.update", { id: GROUP, author: MAYA.lid, authorPn: MAYA.pn, action: "remove", participants: [{ id: SAM.lid, phoneNumber: SAM.pn }] });
    await h.settle();
    assert.equal(counts.length, 1);
    assert.equal(counts[0][0], GROUP);
    assert.equal(typeof counts[0][1], "number");
    await h.feed([msg({ message: { conversation: "/help" } })]);
    assert.match(h.sock().sent.at(-1)!.text, /Dashboard: https:\/\/tryroomie\.me\/j\/abcdefghij/);
  });

  test("groups.upsert (added at creation) is a join too, and a second event changes nothing", async () => {
    const h = harness();
    await h.open();
    const g = groupMeta([{ id: SAM.pn, admin: "superadmin" }, { id: ROOMIE_PN }], { author: SAM.pn });
    h.sock().emit("groups.upsert", [g]);
    h.sock().emit("groups.upsert", [g]);
    await h.settle();
    assert.equal(h.seen.joined.length, 1);
    assert.deepEqual(h.seen.joined[0][2], { userExternalId: SAM.pn, name: "+15551110002" });
  });

  test("a message in a group Roomie never saw itself join onboards it with the roster first", async () => {
    const h = harness();
    await h.open();
    await h.feed([msg({ pushName: "Maya" })]);
    assert.equal(h.seen.joined.length, 1);
    assert.equal((h.seen.joined[0][1] as unknown[]).length, 3);
    assert.deepEqual(h.seen.joined[0][2], { userExternalId: MAYA.pn, name: "Maya" });
    assert.deepEqual(h.sock().sent.map((s) => s.text), ["intro", "ok roomie hi"]);
  });

  test("someone added later -> onParticipantJoined (Pending) and the approval ask; subject change -> renameChat", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    h.sock().emit("group-participants.update", { id: GROUP, author: MAYA.lid, authorPn: MAYA.pn, action: "add", participants: [{ id: "880000000000009@lid", phoneNumber: "15551110009@s.whatsapp.net" }] });
    await h.settle();
    assert.deepEqual(h.seen.participants, [["g1", { userExternalId: "15551110009@s.whatsapp.net", name: "+15551110009" }]]);
    assert.deepEqual(h.sock().sent.map((s) => s.text), ["approve +15551110009?"]);
    h.sock().emit("groups.update", [{ id: GROUP, subject: "Apt 4C" }]);
    await h.settle();
    assert.deepEqual(h.seen.renamed, [[GROUP, "Apt 4C"]]);
  });

  test("added by someone the beta allowlist doesn't know: one line, Roomie leaves, no Group and nothing stored", async () => {
    const asked: string[] = [];
    const h = harness({
      deps: {
        admission: async (u) => {
          asked.push(u.userExternalId);
          return { ok: false, say: "I'm in a small beta right now: ask for access at https://roomie.example/#whatsapp-beta" };
        },
      },
    });
    await h.open();
    h.sock().emit("group-participants.update", { id: GROUP, author: MAYA.lid, authorPn: MAYA.pn, action: "add", participants: [{ id: ROOMIE_LID, phoneNumber: ROOMIE_PN }] });
    await h.settle();
    assert.deepEqual(asked, [MAYA.pn]);
    assert.equal(h.seen.joined.length, 0, "no Group");
    assert.deepEqual(h.seen.saved, [], "no roster stored");
    assert.deepEqual(h.seen.rekeyed, []);
    assert.deepEqual(h.sock().sent.map((s) => s.text), ["I'm in a small beta right now: ask for access at https://roomie.example/#whatsapp-beta"]);
    assert.deepEqual(h.sock().left, [GROUP]);
    await h.feed([msg()]);
    assert.equal(h.seen.incoming.length, 0, "messages from a refused group go nowhere");
    assert.equal(h.sock().sent.length, 1, "and the line isn't repeated");
  });

  test("joined while offline: the first sender isn't taken as the adder; the allowlist checks the group's creator", async () => {
    const asked: string[] = [];
    const h = harness({
      meta: groupMeta([{ id: MAYA.lid, phoneNumber: MAYA.pn, admin: "admin" }, { id: SAM.lid, phoneNumber: SAM.pn, admin: "superadmin" }, { id: ROOMIE_LID, phoneNumber: ROOMIE_PN }], { owner: SAM.pn }),
      deps: {
        admission: async (u) => {
          asked.push(u.userExternalId);
          return u.userExternalId === MAYA.pn ? { ok: true } : { ok: false, say: "beta only" };
        },
      },
    });
    await h.open();
    await h.feed([msg()]); // Maya (allowlisted) speaks first; Sam created the group
    assert.deepEqual(asked, [SAM.pn]);
    assert.equal(h.seen.joined.length, 0);
    assert.equal(h.seen.incoming.length, 0);
    assert.deepEqual(h.sock().left, [GROUP]);
  });

  test("joined while offline with an allowlist on and no creator or superadmin to go by: refused", async () => {
    const h = harness({
      meta: groupMeta([{ id: MAYA.lid, phoneNumber: MAYA.pn }, { id: ROOMIE_LID, phoneNumber: ROOMIE_PN }]),
      deps: { admission: async (u) => (u.userExternalId === MAYA.pn ? { ok: true } : { ok: false, say: "beta only" }) },
    });
    await h.open();
    await h.feed([msg()]);
    assert.equal(h.seen.joined.length, 0, "never admitted because of who spoke first");
  });

  test("a refusal lasts an hour, and a new 'added Roomie' event is judged afresh", async () => {
    let allowSam = false;
    const asked: string[] = [];
    const h = harness({
      deps: {
        admission: async (u) => {
          asked.push(u.userExternalId);
          return allowSam && u.userExternalId === SAM.pn ? { ok: true } : { ok: false, say: "beta only" };
        },
      },
    });
    await h.open();
    const add = (author: { lid: string; pn: string }) =>
      h.sock().emit("group-participants.update", { id: GROUP, author: author.lid, authorPn: author.pn, action: "add", participants: [{ id: ROOMIE_LID, phoneNumber: ROOMIE_PN }] });
    add(MAYA);
    await h.settle();
    await h.feed([msg()]);
    assert.deepEqual(asked, [MAYA.pn], "inside the hour, messages don't re-check");
    allowSam = true;
    add(SAM);
    await h.settle();
    assert.equal(h.seen.joined.length, 1, "Sam (allowed) added Roomie back: it joins");
  });

  test("a refused group is looked at again after an hour", async () => {
    const asked: string[] = [];
    const h = harness({
      deps: {
        admission: async (u) => {
          asked.push(u.userExternalId);
          return { ok: false, say: "beta only" };
        },
      },
    });
    await h.open();
    h.sock().emit("group-participants.update", { id: GROUP, author: MAYA.lid, authorPn: MAYA.pn, action: "add", participants: [{ id: ROOMIE_LID, phoneNumber: ROOMIE_PN }] });
    await h.settle();
    h.advance(61 * 60 * 1000);
    await h.feed([msg({ ts: NOW + 61 * 60 * 1000 })]);
    assert.equal(asked.length, 2);
  });

  test("an allowed adder: the roster's pairs are stored (they're Members now)", async () => {
    const h = harness({ deps: { admission: async () => ({ ok: true }) } });
    await h.open();
    h.sock().emit("group-participants.update", { id: GROUP, author: MAYA.lid, authorPn: MAYA.pn, action: "add", participants: [{ id: ROOMIE_LID, phoneNumber: ROOMIE_PN }] });
    await h.settle();
    assert.equal(h.seen.joined.length, 1);
    assert.deepEqual(
      h.seen.saved.map((c) => c.lid),
      [MAYA.lid, SAM.lid],
      "pairs for the Members (Dev's number is hidden: no pair)",
    );
  });

  test("Onboarding said no (too many new Groups today): nothing stored, the group is left alone afterwards", async () => {
    const h = harness({ deps: { onGroupJoined: async () => ({ intro: null, refused: true }) } });
    await h.open();
    h.sock().emit("group-participants.update", { id: GROUP, author: MAYA.lid, authorPn: MAYA.pn, action: "add", participants: [{ id: ROOMIE_LID, phoneNumber: ROOMIE_PN }] });
    await h.settle();
    assert.deepEqual(h.seen.saved, []);
    await h.feed([msg()]);
    assert.equal(h.seen.incoming.length, 0);
  });

  test("LID mappings Baileys learns are kept in memory only; a Member's pair is stored when they speak", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    h.sock().emit("lid-mapping.update", { lid: SAM.lid, pn: SAM.pn });
    h.sock().emit("lid-mapping.update", { lid: "880000000000077@lid", pn: "15551110077@s.whatsapp.net" });
    await h.settle();
    assert.equal(h.seen.saved.length, 0, "strangers' numbers aren't stored");
    await h.wa.channel.sendPrivate(SAM.lid, { text: "hi" });
    assert.equal(h.sock().sent.at(-1)?.jid, SAM.pn, "but the pair still works in memory");
    await h.feed([msg({ key: { participant: SAM.lid, participantAlt: undefined }, pushName: "Sam" })]);
    assert.equal(h.seen.saved.map((c) => c.lid)[0], SAM.lid);
    assert.deepEqual(h.seen.rekeyed, [[SAM.lid, SAM.pn]]);
  });

  test("a DM from a Member stored under their LID, whose number shows up now: moved to the phone JID, and answered", async () => {
    let moved = false;
    const rekeyed: string[][] = [];
    const h = harness({
      deps: {
        chatsOfUser: async (id) => (id === SAM.lid && !moved) || (id === SAM.pn && moved) ? [GROUP] : [],
        rekeyUser: async (lid, pn) => {
          rekeyed.push([lid, pn]);
          moved = true;
        },
      },
    });
    await h.open();
    await h.feed([msg({ key: { remoteJid: SAM.lid, remoteJidAlt: SAM.pn, participant: undefined, participantAlt: undefined }, pushName: "Sam", message: { conversation: "send me the dashboard" } })]);
    assert.deepEqual(rekeyed, [[SAM.lid, SAM.pn]]);
    assert.equal(h.seen.incoming[0]?.userExternalId, SAM.pn);
    assert.equal(h.seen.incoming[0]?.isPrivate, true);
  });

  test("the same, when the move doesn't happen: carried on as the LID, still answered", async () => {
    const h = harness({ deps: { chatsOfUser: async (id) => (id === SAM.lid ? [GROUP] : []) } });
    await h.open();
    await h.feed([msg({ key: { remoteJid: SAM.lid, remoteJidAlt: SAM.pn, participant: undefined, participantAlt: undefined }, pushName: "Sam", message: { conversation: "hi" } })]);
    assert.equal(h.seen.incoming[0]?.userExternalId, SAM.lid);
  });

  test("a Member stored under their LID who later speaks with only their phone JID still moves (no second Member)", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    h.sock().emit("lid-mapping.update", { lid: SAM.lid, pn: SAM.pn });
    await h.settle();
    await h.feed([msg({ key: { participant: SAM.pn, participantAlt: undefined }, pushName: "Sam" })]);
    assert.deepEqual(h.seen.rekeyed, [[SAM.lid, SAM.pn]]);
  });

  test("/help in a paused Group's chat gets nothing", async () => {
    const h = harness({ deps: { chatPaused: async () => true } });
    h.markKnown();
    await h.open();
    await h.feed([msg({ message: { conversation: "/help" } })]);
    assert.deepEqual(h.sock().sent, []);
  });

  test("a DM from someone in no Group stores nothing", async () => {
    const h = harness({ deps: { chatsOfUser: async () => [] } });
    await h.open();
    await h.feed([msg({ key: { remoteJid: SAM.lid, remoteJidAlt: SAM.pn, participant: undefined, participantAlt: undefined }, pushName: "Sam", message: { conversation: "hi" } })]);
    assert.deepEqual(h.seen.saved, []);
    assert.deepEqual(h.seen.names, []);
  });

  test("ROOMIE_PAUSED=1: messages and joins are ignored (not even a read receipt)", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    const log = console.log;
    process.env.ROOMIE_PAUSED = "1";
    console.log = () => {};
    try {
      await h.feed([msg()]);
      h.reset();
      h.sock().emit("groups.upsert", [groupMeta([{ id: SAM.pn, admin: "superadmin" }, { id: ROOMIE_PN }], { author: SAM.pn })]);
      await h.settle();
    } finally {
      delete process.env.ROOMIE_PAUSED;
      console.log = log;
    }
    assert.equal(h.seen.incoming.length, 0);
    assert.equal(h.seen.joined.length, 0);
    assert.deepEqual(h.sock().read, []);
    assert.deepEqual(h.sock().sent, []);
  });

  test("leaveChat leaves the group and drops a waiting intro", async () => {
    const h = harness();
    await h.open();
    h.wa.channel.introLater(GROUP, { text: "intro" }, 60_000);
    await h.wa.channel.leaveChat(GROUP);
    await h.wa.idle();
    assert.deepEqual(h.sock().left, [GROUP]);
    assert.deepEqual(h.sock().sent, []);
  });
});

describe("connection", () => {
  test("QR -> state qr with a PNG data URL; open -> me", async () => {
    const h = harness();
    await h.wa.start();
    h.sock().emit("connection.update", { qr: "2@abc,def,ghi" });
    await h.until(() => h.wa.status().state === "qr");
    assert.equal(h.wa.status().state, "qr");
    assert.match(h.wa.status().qr ?? "", /^data:image\/png;base64,/);
    h.sock().emit("connection.update", { connection: "open" });
    await h.settle();
    assert.deepEqual(h.wa.status().me, { jid: ROOMIE_PN, name: "Roomie" });
  });

  test("pairing code: asked on the first QR event for the given number", async () => {
    const h = harness();
    await h.wa.start({ pairPhone: "+1 (555) 000-0000" });
    h.sock().emit("connection.update", { qr: "2@abc" });
    await h.until(() => h.wa.status().state === "pairing");
    assert.deepEqual(h.sock().pairingFor, ["15550000000"]);
    assert.equal(h.wa.status().state, "pairing");
    assert.equal(h.wa.status().pairingCode, "ABCD1234");
  });

  test("loggedOut -> the session is cleared, state logged_out, no reconnect", async () => {
    const h = harness();
    await h.open();
    const auth = await makeAuthState(h.auth.store);
    await auth.saveCreds();
    assert.ok(h.auth.rows.size > 0);
    const warn = console.warn;
    console.warn = () => {};
    h.sock().emit("connection.update", close(401));
    await h.settle();
    console.warn = warn;
    assert.equal(h.wa.status().state, "logged_out");
    assert.equal(h.auth.rows.size, 0);
    assert.equal(h.timers.length, 0);
  });

  test("other closes reconnect with backoff (restartRequired at once); connectionReplaced stops", async () => {
    const h = harness();
    await h.open();
    const warn = console.warn;
    console.warn = () => {};
    try {
      h.sock().emit("connection.update", close(428));
      await h.settle();
      assert.equal(h.timers.at(-1)?.ms, 1_000);
      h.timers.at(-1)!.fn();
      await h.settle();
      assert.equal(h.sockets.length, 2);
      h.sock().emit("connection.update", close(408));
      await h.settle();
      assert.equal(h.timers.at(-1)?.ms, 2_000);
      h.timers.at(-1)!.fn();
      await h.settle();
      h.sock().emit("connection.update", close(515));
      await h.settle();
      assert.equal(h.timers.at(-1)?.ms, 0);
      h.timers.at(-1)!.fn();
      await h.settle();
      h.sock().emit("connection.update", { connection: "open" });
      await h.settle();
      h.sock().emit("connection.update", close(428));
      await h.settle();
      assert.equal(h.timers.at(-1)?.ms, 1_000, "an open connection resets the backoff");
      h.timers.at(-1)!.fn();
      await h.settle();
      const before = h.timers.length;
      h.sock().emit("connection.update", close(440));
      await h.settle();
      assert.equal(h.timers.length, before, "replaced by another process: no fight");
      assert.equal(h.wa.status().state, "disconnected");
      assert.match(h.wa.status().error ?? "", /Another process/);
    } finally {
      console.warn = warn;
    }
  });

  test("logout() unlinks, clears the session; stop() keeps it", async () => {
    const h = harness();
    await h.open();
    await (await makeAuthState(h.auth.store)).saveCreds();
    await h.wa.stop();
    assert.equal(h.sock().ended, true);
    assert.ok(h.auth.rows.size > 0, "stop keeps the login");
    await h.open();
    await h.wa.logout();
    assert.equal(h.sock().loggedOut, true);
    assert.equal(h.auth.rows.size, 0);
    assert.equal(h.wa.status().state, "logged_out");
  });
});

/* ---------- polls (ADR 0018) ---------- */

/**
 * A vote as a WhatsApp phone encrypts it: the inverse of Baileys' decryptPollVote (process-message.js), with the
 * library's own hmacSign / aesEncryptGCM / sha256 and the PollVoteMessage proto.
 */
function encryptVote(o: { pollMsgId: string; creatorJid: string; voterJid: string; options: string[]; secret?: Uint8Array }) {
  const secret = o.secret ?? POLL_SECRET;
  const sign = Buffer.concat([Buffer.from(o.pollMsgId), Buffer.from(o.creatorJid), Buffer.from(o.voterJid), Buffer.from("Poll Vote"), new Uint8Array([1])]);
  const key = hmacSign(sign, hmacSign(secret, new Uint8Array(32), "sha256"), "sha256");
  const iv = Buffer.alloc(12, 3);
  const payload = proto.Message.PollVoteMessage.encode({ selectedOptions: o.options.map((x) => sha256(Buffer.from(x))) }).finish();
  return { encPayload: aesEncryptGCM(payload, key, iv, Buffer.from(`${o.pollMsgId}\u0000${o.voterJid}`)), encIv: iv };
}

const voteMsg = (pollId: string, vote: ReturnType<typeof encryptVote>, voter = MAYA) =>
  msg({ key: { participant: voter.lid, participantAlt: voter.pn }, message: { pollUpdateMessage: { pollCreationMessageKey: { id: pollId, remoteJid: GROUP, fromMe: true }, vote, senderTimestampMs: NOW } } });

describe("polls", () => {
  const OPTIONS = ["I'm in", "Not me"];

  test("option hashes: a vote decrypts with the poll's secret and its SHA-256 hashes map to option indexes", () => {
    const vote = encryptVote({ pollMsgId: "poll1", creatorJid: ROOMIE_PN, voterJid: SAM.pn, options: ["Not me"] });
    const selected = decryptWaVote(vote, { pollMsgId: "poll1", secret: POLL_SECRET, creatorJids: [ROOMIE_PN], voterJids: [SAM.pn] });
    assert.ok(selected);
    assert.deepEqual(optionIdsFromHashes(selected, OPTIONS), [1]);
    assert.deepEqual(optionIdsFromHashes([pollOptionHash("Maya"), pollOptionHash("Sam")], ["Maya", "Dev", "Sam"]), [0, 2]);
    assert.deepEqual(optionIdsFromHashes([pollOptionHash("someone else")], OPTIONS), [], "an unknown hash is dropped");
    assert.equal(decryptWaVote(vote, { pollMsgId: "poll1", secret: new Uint8Array(32), creatorJids: [ROOMIE_PN], voterJids: [SAM.pn] }), null, "the wrong secret reads nothing");
    // A LID-addressed group: the phone used Roomie's and the voter's LIDs. Every pair is tried.
    const lidVote = encryptVote({ pollMsgId: "poll1", creatorJid: ROOMIE_LID, voterJid: SAM.lid, options: ["I'm in"] });
    const lidSelected = decryptWaVote(lidVote, { pollMsgId: "poll1", secret: POLL_SECRET, creatorJids: [ROOMIE_PN, ROOMIE_LID], voterJids: [SAM.pn, SAM.lid] });
    assert.deepEqual(optionIdsFromHashes(lidSelected!, OPTIONS), [0]);
  });

  test("a Poll goes out as WhatsApp's own (single choice = 1, several = 0) and returns its id and messageSecret", async () => {
    const h = harness();
    h.markKnown();
    await h.open();
    const sent = await h.wa.channel.sendToChat(GROUP, { text: "Who's in on the $60 pizza?", poll: { question: "Who's in on the $60 pizza?", options: OPTIONS, multi: false } });
    assert.deepEqual(h.sock().polls, [{ jid: GROUP, name: "Who's in on the $60 pizza?", values: OPTIONS, selectableCount: 1 }]);
    assert.equal(h.sock().sent.length, 0, "no text alongside the poll");
    assert.equal(sent.externalId, "poll1");
    assert.deepEqual([...sent.secret!], [...POLL_SECRET], "the secret goes to the polls row");
    await h.wa.channel.sendToChat(GROUP, { text: "Who had pizza?", poll: { question: "Who had pizza?", options: ["Maya", "Dev", "Sam"], multi: true } });
    assert.equal(h.sock().polls[1].selectableCount, 0);
  });

  test("a vote after a restart: the secret comes from the app (the polls row), not memory; taking it back is an empty vote", async () => {
    const stored = new Map<string, { secret: Uint8Array; options: string[] }>();
    const first = harness();
    first.markKnown();
    await first.open();
    const sent = await first.wa.channel.sendToChat(GROUP, { text: "q", poll: { question: "Who's in on the $60 pizza?", options: OPTIONS, multi: false } });
    stored.set(sent.externalId!, { secret: sent.secret!, options: OPTIONS }); // what services/polls.ts askPoll stores

    const votes: unknown[] = [];
    const h = harness({ deps: { pollSecret: async (id) => stored.get(id) ?? null, onPollVote: async (v) => void votes.push(v) } });
    h.markKnown();
    await h.open(); // a new process: nothing in its sent-message cache
    await h.feed([voteMsg("poll1", encryptVote({ pollMsgId: "poll1", creatorJid: ROOMIE_PN, voterJid: MAYA.lid, options: ["I'm in"] }))]);
    await h.feed([voteMsg("poll1", encryptVote({ pollMsgId: "poll1", creatorJid: ROOMIE_PN, voterJid: SAM.pn, options: ["Not me"] }), SAM)]);
    await h.feed([voteMsg("poll1", encryptVote({ pollMsgId: "poll1", creatorJid: ROOMIE_PN, voterJid: MAYA.lid, options: [] }))]);
    assert.deepEqual(votes, [
      { channel: "whatsapp", chatExternalId: GROUP, pollExternalId: "poll1", userExternalId: MAYA.pn, optionIds: [0] },
      { channel: "whatsapp", chatExternalId: GROUP, pollExternalId: "poll1", userExternalId: SAM.pn, optionIds: [1] },
      { channel: "whatsapp", chatExternalId: GROUP, pollExternalId: "poll1", userExternalId: MAYA.pn, optionIds: [] },
    ]);
    assert.equal(h.seen.incoming.length, 0, "a vote isn't a chat message");
    await h.feed([voteMsg("poll9", encryptVote({ pollMsgId: "poll9", creatorJid: ROOMIE_PN, voterJid: MAYA.lid, options: ["I'm in"] }))]);
    assert.equal(votes.length, 3, "not one of Roomie's polls: ignored");
  });
});
