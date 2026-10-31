// The Telegram adapter offline: a Bot with a fake token and preset identity, fake updates through handleUpdate, and
// every Bot API call captured by a transformer. The app side (pipeline, onboarding, DB) is stubbed via TelegramDeps.
// Run: npx tsx --test src/channels/telegram.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { Update } from "grammy/types";
import { CantMessagePrivatelyError, type IncomingMessage } from "./types";
import { TokenBucket } from "./rate-limit";
import { Coalescer } from "./coalesce";
import {
  botInfoFromToken,
  botWasAdded,
  chunkText,
  commandOf,
  createTelegramBot,
  helpText,
  OOPS,
  isButtonUrl,
  keyboardFor,
  readAddress,
  telegramLimiter,
  type TelegramDeps,
} from "./telegram";

const TOKEN = "123456:fake-token";
const ME = botInfoFromToken(TOKEN, "roomie_test_bot");
const GROUP = { id: -1001, type: "supergroup" as const, title: "Apt 4B" };
const MAYA = { id: 11, is_bot: false, first_name: "Maya", last_name: "Lee" };
const SAM = { id: 12, is_bot: false, first_name: "Sam" };
const DEV = { id: 13, is_bot: false, first_name: "Dev" };
const OTHER_BOT = { id: 77, is_bot: true, first_name: "Spam", username: "spam_bot" };
const BOT_USER = { id: ME.id, is_bot: true, first_name: "Roomie", username: ME.username };

type Call = { method: string; payload: Record<string, unknown> };
let updateId = 1;
let messageId = 1;

function harness(opts: { deps?: Partial<TelegramDeps>; joinDelayMs?: number; failSend?: { error_code: number; description: string }; coalescer?: Coalescer } = {}) {
  const calls: Call[] = [];
  const seen = { incoming: [] as IncomingMessage[], joined: [] as unknown[][], participants: [] as unknown[][], moved: [] as string[][], saved: [] as string[] };
  const deps: TelegramDeps = {
    handleIncoming: async (msg) => {
      seen.incoming.push(msg);
      return { text: `ok ${msg.text}` };
    },
    onGroupJoined: async (...args) => {
      seen.joined.push(args);
      return { intro: { text: "intro" } };
    },
    onParticipantJoined: async (...args) => {
      seen.participants.push(args);
      return { announce: { text: `approve ${args[1].name}?` } };
    },
    groupIdOfChat: async () => "g1",
    chatsOfUser: async () => [String(GROUP.id)],
    moveChat: async (from, to) => void seen.moved.push([from, to]),
    saveImage: async (chat, fileUniqueId) => {
      seen.saved.push(fileUniqueId);
      return `/uploads/tg/${chat}/${fileUniqueId}.jpg`;
    },
    ...opts.deps,
  };
  let now = 0;
  const clock = () => now;
  const sleep = async (ms: number) => void (now += ms);
  const tg = createTelegramBot({
    token: TOKEN,
    botInfo: ME,
    deps,
    joinDelayMs: opts.joinDelayMs ?? 0,
    replyDelayMs: 0,
    sleep,
    limiter: telegramLimiter({ clock, sleep }),
    download: async () => new Uint8Array([1, 2, 3]).buffer,
    coalescer: opts.coalescer ?? new Coalescer({ windowMs: 0, clock }),
  });
  tg.bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === "sendMessage" && opts.failSend) return { ok: false, ...opts.failSend } as never;
    const result =
      method === "getChatAdministrators"
        ? [
            { status: "creator", user: DEV, is_anonymous: false },
            { status: "administrator", user: OTHER_BOT },
          ]
        : method === "getChatMemberCount"
          ? 5
          : method === "getFile"
          ? { file_id: "f", file_unique_id: "u", file_path: "voice/file_1.oga" }
          : method === "sendMessage"
            ? { message_id: messageId++, date: 0, chat: { id: (payload as { chat_id: number }).chat_id, type: "supergroup" } }
            : method === "sendPoll"
              ? { message_id: messageId++, date: 0, chat: { id: (payload as { chat_id: number }).chat_id, type: "supergroup" }, poll: { id: "5460000000000000001", question: (payload as { question: string }).question, options: [], total_voter_count: 0, is_closed: false, is_anonymous: false, type: "regular", allows_multiple_answers: false } }
              : true;
    return { ok: true, result } as never;
  });
  const feed = async (u: object) => {
    await tg.bot.handleUpdate({ update_id: updateId++, ...u } as Update);
    await tg.idle();
  };
  const sent = () => calls.filter((c) => c.method === "sendMessage");
  return { tg, calls, sent, seen, feed, clock };
}

const message = (from: object, extra: object, chat: object = GROUP) => ({ message: { message_id: messageId++, date: 0, chat, from, ...extra } });

describe("group join", () => {
  test("Roomie added -> onGroupJoined with the adder as Admin, the chat's human admins, and the intro after the delay", async () => {
    const h = harness();
    await h.feed({
      my_chat_member: { chat: GROUP, from: MAYA, date: 0, old_chat_member: { status: "left", user: BOT_USER }, new_chat_member: { status: "member", user: BOT_USER } },
    } as never);
    assert.equal(h.seen.joined.length, 1);
    const [chat, participants, addedBy, opts] = h.seen.joined[0];
    assert.deepEqual(chat, { channel: "telegram", externalId: "-1001", title: "Apt 4B" });
    assert.deepEqual(addedBy, { userExternalId: "11", name: "Maya Lee" });
    assert.deepEqual(participants, [
      { userExternalId: "11", name: "Maya Lee" },
      { userExternalId: "13", name: "Dev" },
    ]);
    assert.deepEqual(opts, { dmHandle: "roomie_test_bot", participantCount: 4 }, "Telegram's member count, minus Roomie");
    const [intro] = h.sent();
    assert.equal(intro.payload.text, "intro");
    assert.equal(intro.payload.chat_id, "-1001");
    assert.deepEqual(intro.payload.link_preview_options, { is_disabled: true });
    assert.equal(h.calls.findIndex((c) => c.method === "sendChatAction") < h.calls.indexOf(intro), true, "typing first");
  });

  test("promotions and leaving aren't joins", () => {
    const c = { type: "supergroup" };
    assert.equal(botWasAdded({ chat: c, old_chat_member: { status: "member", user: BOT_USER }, new_chat_member: { status: "administrator", user: BOT_USER } as never }), false);
    assert.equal(botWasAdded({ chat: c, old_chat_member: { status: "member", user: BOT_USER }, new_chat_member: { status: "left", user: BOT_USER } }), false);
    assert.equal(botWasAdded({ chat: { type: "private" }, old_chat_member: { status: "kicked", user: BOT_USER } as never, new_chat_member: { status: "member", user: BOT_USER } }), false);
  });

  test("a message before the join delay is over gets the intro first", async () => {
    const h = harness({ joinDelayMs: 60_000 });
    await h.tg.bot.handleUpdate({
      update_id: updateId++,
      my_chat_member: { chat: GROUP, from: MAYA, date: 0, old_chat_member: { status: "left", user: BOT_USER }, new_chat_member: { status: "member", user: BOT_USER } },
    } as never);
    await h.feed(message(MAYA, { text: "roomie hi" }));
    assert.deepEqual(h.sent().map((c) => c.payload.text), ["intro", "ok roomie hi"]);
  });

  test("new_chat_members -> each person through onParticipantJoined (Pending), and the approval ask is posted", async () => {
    const h = harness();
    await h.feed(message(MAYA, { new_chat_members: [SAM, OTHER_BOT] }));
    assert.deepEqual(h.seen.participants, [["g1", { userExternalId: "12", name: "Sam" }]]);
    assert.deepEqual(h.sent().map((c) => c.payload.text), ["approve Sam?"]);
  });

  test("new_chat_members with Roomie in it, for a Chat not known yet, is the join (the others came with Roomie)", async () => {
    const h = harness({ deps: { groupIdOfChat: async () => undefined } });
    await h.feed(message(MAYA, { new_chat_members: [BOT_USER, SAM] }));
    assert.equal(h.seen.participants.length, 0);
    assert.equal(h.seen.joined.length, 1);
    assert.deepEqual((h.seen.joined[0][1] as { name: string }[]).map((p) => p.name), ["Maya Lee", "Sam", "Dev"]);
  });

  test("the Admin's setup DM: tried at once; refused (never pressed Start) it waits, the intro still goes out", async () => {
    const dm = { text: "Hi Maya 👋 setup", buttons: [{ text: "Open dashboard", url: "https://roomie.example/claim/abc" }] };
    const h = harness({ deps: { onGroupJoined: async () => ({ intro: { text: "intro" }, setupDm: dm }) }, failSend: { error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" } });
    await h.feed({
      my_chat_member: { chat: GROUP, from: MAYA, date: 0, old_chat_member: { status: "left", user: BOT_USER }, new_chat_member: { status: "member", user: BOT_USER } },
    } as never);
    const tries = h.sent().map((c) => c.payload.chat_id);
    assert.ok(tries.includes("11"), "the DM to Maya was tried");
    assert.ok(tries.includes("-1001"), "the intro was still sent");
    const ok = harness({ deps: { onGroupJoined: async () => ({ intro: { text: "intro" }, setupDm: dm }) } });
    await ok.feed({
      my_chat_member: { chat: GROUP, from: MAYA, date: 0, old_chat_member: { status: "left", user: BOT_USER }, new_chat_member: { status: "member", user: BOT_USER } },
    } as never);
    const toMaya = ok.sent().find((c) => c.payload.chat_id === "11");
    assert.equal(toMaya?.payload.text, "Hi Maya 👋 setup", "she pressed Start for Roomie before: it arrives now");
    assert.ok(JSON.stringify(toMaya?.payload.reply_markup).includes("https://roomie.example/claim/abc"), "the Claim link is a button in the DM");
  });

  test("people joining or leaving refresh the Chat's head count", async () => {
    const counts: [string, number | null][] = [];
    const h = harness({ deps: { setParticipantCount: async (id, n) => void counts.push([id, n]) } });
    await h.feed(message(MAYA, { new_chat_members: [SAM] }));
    await h.feed(message(MAYA, { left_chat_member: SAM }));
    assert.deepEqual(counts, [
      ["-1001", 4],
      ["-1001", 4],
    ]);
  });

  test("a group upgraded to a supergroup moves the Chat", async () => {
    const h = harness();
    await h.feed(message(MAYA, { migrate_to_chat_id: -100999 }, { id: -55, type: "group", title: "Apt 4B" }));
    assert.deepEqual(h.seen.moved, [["-55", "-100999"]]);
  });
});

describe("incoming messages", () => {
  test("text -> IncomingMessage: name, @mention read as Roomie", async () => {
    const h = harness();
    await h.feed(message(MAYA, { text: "@roomie_test_bot who's here", entities: [{ type: "mention", offset: 0, length: 16 }] }));
    assert.deepEqual(h.seen.incoming, [
      { channel: "telegram", chatExternalId: "-1001", chatTitle: "Apt 4B", userExternalId: "11", userName: "Maya Lee", text: "Roomie who's here", mentionsRoomie: true, isReplyToRoomie: false, receivedAt: new Date(0) },
    ]);
    assert.equal(h.sent().at(-1)?.payload.text, "ok Roomie who's here");
  });

  test("two quick texts from one Member -> ONE pipeline run with both and one reply; someone else's text isn't merged (#41)", async () => {
    // Real time here (the updates go in one by one): a 150 ms window stands in for the 4 s one.
    const h = harness({ coalescer: new Coalescer({ windowMs: 150 }) });
    const push = (from: object, text: string) => h.tg.bot.handleUpdate({ update_id: updateId++, ...message(from, { text }) } as Update);
    await push(MAYA, "we need to make tacos tonight, what do we need");
    await push(MAYA, "roomie suggest");
    await h.tg.idle();
    await push(SAM, "roomie add eggs");
    await push(MAYA, "and bread");
    await h.tg.idle();
    assert.deepEqual(
      h.seen.incoming.map((m) => [m.userName, m.text, m.merged]),
      [
        ["Maya Lee", "we need to make tacos tonight, what do we need\nroomie suggest", 2],
        ["Sam", "roomie add eggs", undefined],
        ["Maya Lee", "and bread", undefined],
      ],
    );
    assert.equal(h.sent().length, 3, "one reply per run");
  });

  test("a reply to Roomie is flagged; one to someone else isn't", () => {
    const toRoomie = readAddress(ME, { text: "yes", reply_to_message: { from: BOT_USER } as never });
    const toSam = readAddress(ME, { text: "yes", reply_to_message: { from: SAM } as never });
    assert.equal(toRoomie.isReplyToRoomie, true);
    assert.equal(toSam.isReplyToRoomie, false);
    assert.equal(toSam.mentionsRoomie, false);
    assert.equal(readAddress(ME, { text: "hi", entities: [{ type: "text_mention", offset: 0, length: 2, user: BOT_USER }] }).mentionsRoomie, true);
  });

  test("other bots, channel/anonymous-admin posts, edits and /start in a group are ignored", async () => {
    const h = harness();
    await h.feed(message(OTHER_BOT, { text: "buy crypto" }));
    await h.feed(message(MAYA, { text: "hi", sender_chat: { id: -1001, type: "supergroup", title: "Apt 4B" } }));
    await h.feed({ edited_message: { message_id: 1, date: 0, edit_date: 1, chat: GROUP, from: MAYA, text: "edited" } } as never);
    await h.feed(message(MAYA, { text: "/start@roomie_test_bot" }));
    assert.equal(h.seen.incoming.length, 0);
    assert.equal(h.sent().length, 0);
  });

  const PHOTO = [
    { file_id: "small", file_unique_id: "s1", width: 90, height: 90 },
    { file_id: "big", file_unique_id: "b1", width: 1280, height: 1280 },
  ];
  const VOICE = { voice: { file_id: "v", file_unique_id: "v1", duration: 3, mime_type: "audio/ogg" } };
  const toRoomie = { reply_to_message: { message_id: 1, date: 0, chat: GROUP, from: BOT_USER, text: "what's this for?" } };

  test("photo addressed to Roomie -> largest size stored, imageUrl + caption passed on", async () => {
    const h = harness();
    await h.feed(message(SAM, { caption: "roomie split this", photo: PHOTO }));
    assert.deepEqual(h.seen.saved, ["b1"]);
    assert.equal(h.calls.find((c) => c.method === "getFile")?.payload.file_id, "big");
    assert.equal(h.seen.incoming[0].imageUrl, "/uploads/tg/-1001/b1.jpg");
    assert.equal(h.seen.incoming[0].text, "roomie split this");
  });

  test("a photo nobody addressed to Roomie is never fetched: the caption goes on as text, marked skipped", async () => {
    const asked: unknown[] = [];
    const h = harness({
      deps: {
        mediaWanted: async (q) => {
          asked.push(q);
          return false;
        },
      },
    });
    await h.feed(message(SAM, { caption: "look at this sunset", photo: PHOTO }));
    await h.feed(message(SAM, { photo: PHOTO }));
    assert.deepEqual(h.seen.saved, []);
    assert.equal(h.calls.filter((c) => c.method === "getFile").length, 0, "nothing downloaded");
    assert.deepEqual(
      h.seen.incoming.map((m) => [m.text, m.skippedMedia, m.imageUrl]),
      [
        ["look at this sunset", "photo", undefined],
        ["", "photo", undefined],
      ],
    );
    assert.deepEqual(asked[0], { channel: "telegram", chatExternalId: "-1001", userExternalId: "12", kind: "photo", caption: "look at this sunset", isPrivate: false, mentionsRoomie: false, isReplyToRoomie: false });
  });

  test("a skipped photo is fetched later only when the pipeline asks again with gateActed and gets a yes (#40)", async () => {
    const asked: { gateActed?: boolean }[] = [];
    const h = harness({
      deps: {
        mediaWanted: async (q) => {
          asked.push(q);
          return !!q.gateActed;
        },
      },
    });
    await h.feed(message(SAM, { caption: "Your bill sreyas, you owe", photo: PHOTO }));
    const skipped = h.seen.incoming[0];
    assert.equal(skipped.skippedMedia, "photo");
    assert.deepEqual(h.seen.saved, [], "nothing fetched before the Gate answers");
    assert.equal(await skipped.fetchSkippedPhoto?.(), "/uploads/tg/-1001/b1.jpg");
    assert.deepEqual(h.seen.saved, ["b1"]);
    assert.deepEqual(asked.map((q) => !!q.gateActed), [false, true]);

    const no = harness({ deps: { mediaWanted: async () => false } });
    await no.feed(message(SAM, { caption: "Your bill sreyas, you owe", photo: PHOTO }));
    assert.equal(await no.seen.incoming[0].fetchSkippedPhoto?.(), null, "a paused Group still says no");
    assert.deepEqual(no.seen.saved, []);
  });

  test("with the pipeline wired in, its answer wins even for an addressed photo (a paused Group fetches nothing)", async () => {
    const h = harness({ deps: { mediaWanted: async () => false } });
    await h.feed(message(SAM, { caption: "roomie split this", photo: PHOTO }));
    assert.deepEqual(h.seen.saved, []);
    assert.equal(h.seen.incoming[0].skippedMedia, "photo");
  });

  test("a photo in the follow-up window (the pipeline says so) is fetched; a reply to Roomie or @mention always is", async () => {
    const h = harness({ deps: { mediaWanted: async () => true } });
    await h.feed(message(SAM, { photo: PHOTO }));
    assert.equal(h.seen.incoming[0].imageUrl, "/uploads/tg/-1001/b1.jpg");
    const r = harness();
    await r.feed(message(SAM, { photo: PHOTO, ...toRoomie }));
    await r.feed(message(SAM, { photo: PHOTO, caption: "@roomie_test_bot this one" }));
    assert.equal(r.seen.saved.length, 2);
  });

  test("voice nobody addressed: never downloaded or transcribed, passed on as a skipped voice note", async () => {
    let transcribed = 0;
    const h = harness({ deps: { transcribe: async () => `t${++transcribed}` } });
    await h.feed(message(SAM, VOICE));
    assert.equal(transcribed, 0);
    assert.equal(h.calls.filter((c) => c.method === "getFile").length, 0);
    assert.deepEqual(h.seen.incoming.map((m) => [m.text, m.skippedMedia, m.isVoice]), [["", "voice", undefined]], "the pipeline logs it as (voice note)");
  });

  test("voice without a transcriber, replying to Roomie: says so once per Chat, passes nothing on", async () => {
    const h = harness();
    await h.feed(message(SAM, { ...VOICE, ...toRoomie }));
    await h.feed(message(SAM, { ...VOICE, ...toRoomie }));
    assert.equal(h.seen.incoming.length, 0);
    assert.deepEqual(h.sent().map((c) => c.payload.text), ["I can't hear voice notes yet, mind typing that?"]);
  });

  test("voice replying to Roomie, or in the window / setup (the pipeline says so): the transcript goes through", async () => {
    const h = harness({ deps: { transcribe: async (_a, o) => `transcript of ${o.mime}` } });
    await h.feed(message(SAM, { ...VOICE, ...toRoomie }));
    assert.equal(h.seen.incoming[0].text, "transcript of audio/ogg");
    assert.equal(h.seen.incoming[0].isVoice, true);
    assert.equal(h.seen.incoming[0].isReplyToRoomie, true, "still addressed, so the Gate hears it");
    const w = harness({ deps: { transcribe: async () => "roommates, USD, Chicago", mediaWanted: async (q) => q.kind === "voice" } });
    await w.feed(message(MAYA, VOICE));
    assert.equal(w.seen.incoming[0].text, "roommates, USD, Chicago");
  });
});

describe("the kill switch", () => {
  test("ROOMIE_PAUSED=1: no message reaches the pipeline, no join is onboarded, nothing is sent", async () => {
    const h = harness();
    const log = console.log;
    process.env.ROOMIE_PAUSED = "1";
    console.log = () => {};
    try {
      await h.feed(message(MAYA, { text: "roomie hi" }));
      await h.feed({
        my_chat_member: { chat: GROUP, from: MAYA, date: 0, old_chat_member: { status: "left", user: BOT_USER }, new_chat_member: { status: "member", user: BOT_USER } },
      } as never);
    } finally {
      delete process.env.ROOMIE_PAUSED;
      console.log = log;
    }
    assert.equal(h.seen.incoming.length, 0);
    assert.equal(h.seen.joined.length, 0);
    assert.equal(h.sent().length, 0);
  });
});

describe("a paused Group", () => {
  test("/help in its Chat, and /help or /start from its Member in a DM, get nothing", async () => {
    const h = harness({ deps: { chatPaused: async () => true } });
    await h.feed(message(MAYA, { text: "/help" }));
    await h.feed(message(SAM, { text: "/help" }, { id: 12, type: "private", first_name: "Sam" }));
    await h.feed(message(SAM, { text: "/start" }, { id: 12, type: "private", first_name: "Sam" }));
    assert.equal(h.sent().length, 0);
  });

  test("a failed pause check counts as paused for /help", async () => {
    const h = harness({
      deps: {
        chatPaused: async () => {
          throw new Error("db down");
        },
      },
    });
    const err = console.error;
    console.error = () => {};
    try {
      await h.feed(message(MAYA, { text: "/help" }));
    } finally {
      console.error = err;
    }
    assert.equal(h.sent().length, 0);
  });
});

describe("leaving", () => {
  test("leaveChat calls leaveChat and drops a waiting intro", async () => {
    const h = harness();
    h.tg.channel.introLater("-1001", { text: "intro" }, 60_000);
    await h.tg.channel.leaveChat("-1001");
    await h.tg.idle();
    assert.equal(h.calls.find((c) => c.method === "leaveChat")?.payload.chat_id, "-1001");
    assert.equal(h.sent().length, 0);
  });
});

describe("private messages", () => {
  const PRIVATE = { id: 12, type: "private" as const, first_name: "Sam" };

  test("a Member of one Group: routed to that Group's Chat as private, reply in the DM", async () => {
    const h = harness();
    await h.feed(message(SAM, { text: "send me the dashboard" }, PRIVATE));
    assert.equal(h.seen.incoming[0].chatExternalId, "-1001");
    assert.equal(h.seen.incoming[0].isPrivate, true);
    assert.equal(h.sent()[0].payload.chat_id, "12");
  });

  test("no Group: asked to add Roomie first, nothing reaches the pipeline; several: the pipeline picks the Group (ADR 0020)", async () => {
    const none = harness({ deps: { chatsOfUser: async () => [] } });
    await none.feed(message(SAM, { text: "hi" }, PRIVATE));
    assert.match(String(none.sent()[0].payload.text), /Add me to your group chat first/);
    assert.equal(none.seen.incoming.length, 0);
    const many = harness({ deps: { chatsOfUser: async () => ["-1", "-2"] } });
    await many.feed(message(SAM, { text: "for Lisbon: what do I owe" }, PRIVATE));
    assert.equal(many.seen.incoming.length, 1);
    assert.equal(many.seen.incoming[0].isPrivate, true);
    assert.equal(many.seen.incoming[0].text, "for Lisbon: what do I owe");
  });

  test("/start: one line, no links; a Member hears DMs work now, a stranger how to get going", async () => {
    const h = harness();
    await h.feed(message(SAM, { text: "/start" }, PRIVATE));
    const member = String(h.sent()[0].payload.text);
    assert.match(member, /^Hey Sam 👋 Now I can DM you: ask for "the dashboard"/);
    assert.equal(member.split("\n").length, 1);
    assert.ok(!/https?:\/\//.test(member), "no Claim link on /start");
    assert.equal(h.sent()[0].payload.reply_markup, undefined, "no buttons either");
    const stranger = harness({ deps: { chatsOfUser: async () => [] } });
    await stranger.feed(message(SAM, { text: "/start" }, PRIVATE));
    assert.equal(String(stranger.sent()[0].payload.text), `Hey Sam 👋 I'm Roomie. Add me to a group chat, tell me what it's for, and I'll learn the right Tricks.`);
    assert.equal(h.seen.incoming.length + stranger.seen.incoming.length, 0);
  });

  test("/start from the Admin of a Group still waiting for setup: the setup DM (with their Claim link button) instead", async () => {
    const asked: string[] = [];
    const dm = { text: "Hi Maya 👋 You added me to Apt 4B, so you're its admin.\nAnswer the setup here or in the group: what's the group for, currency, city.", buttons: [{ text: "Open dashboard", url: "https://roomie.example/claim/abc" }] };
    const h = harness({ deps: { setupDmFor: async (id) => (asked.push(id), id === "11" ? dm : null) } });
    await h.feed(message(MAYA, { text: "/start" }, { id: 11, type: "private", first_name: "Maya" }));
    assert.deepEqual(asked, ["11"]);
    assert.match(String(h.sent()[0].payload.text), /Answer the setup here or in the group/);
    assert.ok(JSON.stringify(h.sent()[0].payload.reply_markup).includes("/claim/abc"));
    await h.feed(message(SAM, { text: "/start" }, PRIVATE));
    assert.match(String(h.sent().at(-1)!.payload.text), /^Hey Sam 👋 Now I can DM you/, "anyone else: the usual line");
  });

  test("/help in a Group with a Join link: 'Dashboard: <link>' on the Always line, still 8 lines at most", async () => {
    const h = harness({ deps: { tricksIn: async () => ["splitting", "groceries", "house"], dashboardIn: async () => "https://roomie.example/j/abcdefghij" } });
    await h.feed(message(MAYA, { text: "/help" }));
    const text = String(h.sent()[0].payload.text);
    assert.match(text, /Dashboard: https:\/\/roomie\.example\/j\/abcdefghij/);
    assert.ok(text.split("\n").length <= 8);
  });

  test("/help in a DM: what Roomie does, even before the person is in a group", async () => {
    const h = harness({ deps: { chatsOfUser: async () => [] } });
    await h.feed(message(SAM, { text: "/help" }, PRIVATE));
    assert.equal(h.sent()[0].payload.text, helpText());
    assert.equal(h.seen.incoming.length, 0);
  });

  test("/help in a DM from a Member of one Group: that Group's Tricks", async () => {
    const h = harness({ deps: { tricksIn: async (id) => (id === "-1001" ? ["splitting"] : undefined) } });
    await h.feed(message(SAM, { text: "/help" }, PRIVATE));
    assert.equal(h.sent()[0].payload.text, helpText(["splitting"]));
  });

  test("a failure while handling a DM: a friendly line, never the error", async () => {
    const h = harness({ deps: { handleIncoming: async () => Promise.reject(new Error("ECONNRESET at db.query (pg/lib/client.js:12)")) } });
    await h.feed(message(SAM, { text: "what do I owe?" }, PRIVATE));
    assert.equal(h.sent()[0].payload.text, OOPS);
  });
});

describe("commands and failures in a group", () => {
  test("/help (and /help@roomie) -> the group's Tricks in at most 8 lines; another bot's /help is ignored", async () => {
    const h = harness({ deps: { tricksIn: async () => ["splitting", "groceries"] } });
    await h.feed(message(MAYA, { text: "/help" }));
    await h.feed(message(MAYA, { text: "/help@roomie_test_bot" }));
    await h.feed(message(MAYA, { text: "/help@spam_bot" }));
    const texts = h.sent().map((c) => String(c.payload.text));
    assert.equal(texts.length, 2);
    assert.equal(texts[0], helpText(["splitting", "groceries"]));
    assert.match(texts[0], /Tricks I know here: Money and Groceries\./);
    assert.ok(texts[0].split("\n").length <= 8);
    assert.match(texts[0], /Say "roomie"/);
    assert.ok(!/https?:\/\//.test(texts[0]));
    assert.equal(h.seen.incoming.length, 0, "commands don't reach the pipeline");
  });

  test("commandOf", () => {
    assert.equal(commandOf("/help", "roomie_test_bot"), "help");
    assert.equal(commandOf("/HELP@Roomie_Test_Bot please", "roomie_test_bot"), "help");
    assert.equal(commandOf("/help@other_bot", "roomie_test_bot"), null);
    assert.equal(commandOf("help me", "roomie_test_bot"), null);
    assert.equal(commandOf(undefined, "roomie_test_bot"), null);
  });

  test("Roomie's own messages are ignored", async () => {
    const h = harness();
    await h.feed(message(BOT_USER, { text: "roomie, I said something" }));
    assert.equal(h.seen.incoming.length + h.sent().length, 0);
  });

  test("a pipeline failure: one friendly line when Roomie was addressed, nothing for chatter, the stack only in the log", async () => {
    const h = harness({ deps: { handleIncoming: async () => Promise.reject(new Error("TypeError: cannot read 'cents' of undefined\n    at money.ts:42")) } });
    const logged: unknown[] = [];
    const was = console.error;
    console.error = (...args: unknown[]) => void logged.push(args);
    try {
      await h.feed(message(MAYA, { text: "roomie I paid 20 for pizza" }));
      await h.feed(message(DEV, { text: "lol same" }));
    } finally {
      console.error = was;
    }
    const texts = h.sent().map((c) => String(c.payload.text));
    assert.deepEqual(texts, [OOPS]);
    assert.ok(!/money\.ts|TypeError/.test(texts[0]));
    assert.equal(logged.length, 2, "both failures are logged");
    assert.match(String((logged[0] as unknown[])[0]), /^\[roomie\] couldn't handle a message from Maya Lee/);
  });
});

describe("outgoing", () => {
  test("buttons become an inline keyboard of URL buttons on the message", async () => {
    const h = harness();
    await h.tg.channel.sendToChat("-1001", {
      text: "Here you go",
      buttons: [
        { text: "Open dashboard", url: "https://roomie.example/g/1" },
        { text: "Cart", url: "https://roomie.example/g/1/cart" },
      ],
    });
    const [m] = h.sent();
    assert.deepEqual((m.payload.reply_markup as { inline_keyboard: unknown }).inline_keyboard, [
      [{ text: "Open dashboard", url: "https://roomie.example/g/1" }],
      [{ text: "Cart", url: "https://roomie.example/g/1/cart" }],
    ]);
    assert.equal(m.payload.parse_mode, undefined, "plain text");
    assert.equal(keyboardFor([]), undefined);
  });

  test("localhost links (dev APP_URL) go as text, since Telegram refuses them as buttons", async () => {
    const h = harness();
    await h.tg.channel.sendToChat("-1001", { text: "Here", buttons: [{ text: "Open dashboard", url: "http://localhost:3000/g/1" }] });
    const [m] = h.sent();
    assert.equal(m.payload.text, "Here\nOpen dashboard: http://localhost:3000/g/1");
    assert.equal(m.payload.reply_markup, undefined);
    assert.equal(isButtonUrl("https://roomie.example/x"), true);
    assert.equal(isButtonUrl("http://127.0.0.1:3000/x"), false);
  });

  test("long replies are chunked under 4096; buttons only on the last piece", async () => {
    const long = Array.from({ length: 300 }, (_, i) => `line ${i} ${"x".repeat(25)}`).join("\n");
    const chunks = chunkText(long);
    assert.ok(chunks.length >= 3);
    assert.ok(chunks.every((c) => c.length <= 4096));
    assert.equal(chunks.join("\n"), long, "nothing lost at the cuts");
    assert.deepEqual(chunkText("short"), ["short"]);
    assert.ok(chunkText("y".repeat(5000)).every((c) => c.length <= 4096));

    const h = harness();
    await h.tg.channel.sendToChat("-1001", { text: long, buttons: [{ text: "Open", url: "https://roomie.example" }] });
    const sent = h.sent();
    assert.equal(sent.length, chunks.length);
    assert.deepEqual(sent.map((c) => c.payload.reply_markup !== undefined), [...chunks.slice(1).map(() => false), true]);
  });

  test("rate limits: about 1 message a second per Chat, others not held up; groups 20 a minute", async () => {
    let now = 0;
    const clock = () => now;
    const sleep = async (ms: number) => void (now += ms);
    const limiter = telegramLimiter({ clock, sleep });
    const at: Record<string, number[]> = { a: [], b: [] };
    await Promise.all([1, 2, 3].map(() => limiter.acquire("-1").then(() => at.a.push(now))));
    assert.deepEqual(at.a, [0, 1000, 2000]);
    now = 0;
    const fresh = telegramLimiter({ clock, sleep });
    await fresh.acquire("-1");
    await fresh.acquire("-2");
    assert.equal(now, 0, "another Chat doesn't wait");

    const group = new TokenBucket({ capacity: 20, perSecond: 20 / 60 }, 0);
    for (let i = 0; i < 20; i++) group.take(0);
    assert.equal(group.waitMs(0), 3000);
  });

  test("a private send Telegram refuses (never pressed Start) surfaces as 'DM me first'", async () => {
    const h = harness({ failSend: { error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" } });
    await assert.rejects(
      () => h.tg.channel.sendPrivate("12", { text: "your link", buttons: [{ text: "Open dashboard", url: "https://roomie.example/claim/x" }] }),
      (err: unknown) => err instanceof CantMessagePrivatelyError && /tap @roomie_test_bot and press Start/.test(err.message),
    );
  });

  test("a group send that fails is not dressed up as a DM problem", async () => {
    const h = harness({ failSend: { error_code: 403, description: "Forbidden: bot was kicked from the supergroup chat" } });
    await assert.rejects(() => h.tg.channel.sendToChat("-1001", { text: "hi" }), (err: unknown) => !(err instanceof CantMessagePrivatelyError));
  });
});

describe("webhook route", () => {
  const update = JSON.stringify({ update_id: 1, message: { message_id: 1, date: 0, chat: GROUP, from: MAYA, text: "hi" } });
  const post = (headers: Record<string, string>) => new Request("http://localhost/api/telegram", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: update });

  test("401 without the secret, with a wrong one, and while TELEGRAM_WEBHOOK_SECRET is unset", async () => {
    const { POST } = await import("@/app/api/telegram/route");
    const before = process.env.TELEGRAM_WEBHOOK_SECRET;
    try {
      process.env.TELEGRAM_WEBHOOK_SECRET = "right-secret";
      assert.equal((await POST(post({}))).status, 401);
      assert.equal((await POST(post({ "x-telegram-bot-api-secret-token": "wrong-secret" }))).status, 401);
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      assert.equal((await POST(post({ "x-telegram-bot-api-secret-token": "" }))).status, 401);
    } finally {
      if (before === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
      else process.env.TELEGRAM_WEBHOOK_SECRET = before;
    }
  });
});

describe("polls (ADR 0018)", () => {
  test("a Poll goes out as Telegram's own, non-anonymous, and its id comes back", async () => {
    const h = harness();
    const sent = await h.tg.channel.sendToChat("-1001", { text: "Who's in on the $60 pizza?", poll: { question: "Who's in on the $60 pizza?", options: ["I'm in", "Not me"], multi: false } });
    const poll = h.calls.find((c) => c.method === "sendPoll");
    assert.ok(poll);
    assert.equal(poll.payload.chat_id, "-1001");
    assert.equal(poll.payload.question, "Who's in on the $60 pizza?");
    assert.deepEqual(poll.payload.options, [{ text: "I'm in" }, { text: "Not me" }]);
    assert.equal(poll.payload.is_anonymous, false, "anonymous polls tell nobody who voted");
    assert.equal(poll.payload.allows_multiple_answers, false);
    assert.equal(h.sent().length, 0, "no text alongside the poll");
    assert.deepEqual(sent, { externalId: "5460000000000000001" });
    await h.tg.channel.sendToChat("-1001", { text: "Who had pizza?", poll: { question: "Who had pizza?", options: ["Maya", "Dev", "Sam"], multi: true } });
    assert.equal(h.calls.filter((c) => c.method === "sendPoll")[1].payload.allows_multiple_answers, true);
  });

  test("poll_answer -> a PollVote (0-based ids); an empty option list takes the vote back", async () => {
    const votes: unknown[] = [];
    const h = harness({ deps: { onPollVote: async (v) => void votes.push(v) } });
    await h.feed({ poll_answer: { poll_id: "5460000000000000001", user: DEV, option_ids: [0], option_persistent_ids: ["a"] } });
    await h.feed({ poll_answer: { poll_id: "5460000000000000001", user: SAM, option_ids: [0, 1], option_persistent_ids: ["a", "b"] } });
    await h.feed({ poll_answer: { poll_id: "5460000000000000001", user: DEV, option_ids: [], option_persistent_ids: [] } });
    assert.deepEqual(votes, [
      { channel: "telegram", chatExternalId: "", pollExternalId: "5460000000000000001", userExternalId: "13", optionIds: [0] },
      { channel: "telegram", chatExternalId: "", pollExternalId: "5460000000000000001", userExternalId: "12", optionIds: [0, 1] },
      { channel: "telegram", chatExternalId: "", pollExternalId: "5460000000000000001", userExternalId: "13", optionIds: [] },
    ]);
    assert.equal(h.seen.incoming.length, 0, "a vote isn't a message");
  });

  test("poll_answer is one of the updates polling and the webhook ask for", async () => {
    const { TELEGRAM_UPDATES } = await import("./telegram");
    assert.ok((TELEGRAM_UPDATES as readonly string[]).includes("poll_answer"));
  });
});
