// The personality model, no DB. Run: npx tsx --test src/lib/personality.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ARCHETYPE_IDS,
  ARCHETYPES,
  applyPersonalityPatch,
  archetypesUnlocked,
  confidenceFor,
  countEmoji,
  defaultPersonality,
  effectiveDials,
  greetingLine,
  isPetCommand,
  moodFrom,
  normalizePersonality,
  previewOwes,
  slangBudget,
  usableNicknames,
  validatePersonalityPatch,
  winLine,
  winsFrom,
} from "./personality";

/** Run `fn` with ROOMIE_ARCHETYPES / NODE_ENV set as given, then put them back. */
function withEnv(env: { ROOMIE_ARCHETYPES?: string; NODE_ENV?: string }, fn: () => void) {
  const before = { ROOMIE_ARCHETYPES: process.env.ROOMIE_ARCHETYPES, NODE_ENV: process.env.NODE_ENV };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(before)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

test("every archetype has a voice, 3 examples, an emoji policy and lines for greetings and wins", () => {
  for (const id of ARCHETYPE_IDS) {
    const a = ARCHETYPES[id];
    assert.ok(a.voice.length > 40, id);
    assert.equal(a.examples.length, 3);
    for (const part of ["morning", "day", "evening"] as const) assert.ok(a.greetings[part].length, `${id} ${part}`);
    for (const k of ["square", "streak", "checkout"] as const) assert.ok(a.wins[k].length, `${id} ${k}`);
    if (a.emoji === "none") for (const e of a.examples) assert.equal(countEmoji(e), 0, `${id} examples use no emoji`);
  }
});

test("normalize: {} is chill Roomie; junk is dropped, never thrown", () => {
  const p = normalizePersonality({});
  assert.equal(p.base, "chill");
  assert.equal(p.name, "Roomie");
  assert.deepEqual(p.quirks, []);
  assert.equal(p.learned.confidence, 0);
  assert.equal(p.learned.hours.length, 24);
  const junk = normalizePersonality({ base: "pirate", name: 5, quirks: ["a", 3, "b", "c", "d"], humor: 9, emoji: "lots", learned: { confidence: 4, slang: [{ phrase: "bet", count: 3 }, { nope: 1 }] } }, { archetypes: true });
  assert.equal(junk.base, "chill");
  assert.equal(junk.name, "Roomie");
  assert.deepEqual(junk.quirks, ["a", "b", "c"]);
  assert.equal(junk.humor, undefined);
  assert.equal(junk.emoji, "lots");
  assert.equal(junk.learned.confidence, 1);
  assert.deepEqual(junk.learned.slang, [{ phrase: "bet", count: 3 }]);
});

test("one voice (ADR 0020): a stored vibe, name, quirks and dials are ignored; languages and the Learned style are kept", () => {
  const stored = { base: "hype", name: "Dino", quirks: ["loves the plant"], emoji: "lots", humor: 3, formality: 0, languages: ["Hindi"], learned: { messagesSeen: 90, confidence: 0.42, tone: ["teasing"] } };
  withEnv({ ROOMIE_ARCHETYPES: undefined, NODE_ENV: "test" }, () => {
    const p = normalizePersonality(stored);
    assert.equal(p.base, "chill");
    assert.equal(p.name, "Roomie");
    assert.deepEqual(p.quirks, []);
    assert.deepEqual(effectiveDials(p), effectiveDials(defaultPersonality()), "chill's own dials");
    assert.deepEqual(p.languages, ["Hindi"]);
    assert.equal(p.learned.messagesSeen, 90);
    assert.deepEqual(p.learned.tone, ["teasing"]);
  });
});

test("the dev switch: ROOMIE_ARCHETYPES=1 outside production honours the stored object; production never does", () => {
  const stored = { base: "hype", name: "Dino", quirks: ["loves the plant"], humor: 3 };
  withEnv({ ROOMIE_ARCHETYPES: "1", NODE_ENV: "test" }, () => {
    assert.equal(archetypesUnlocked(), true);
    const p = normalizePersonality(stored);
    assert.equal(p.base, "hype");
    assert.equal(p.name, "Dino");
    assert.deepEqual(p.quirks, ["loves the plant"]);
    assert.equal(p.humor, 3);
  });
  withEnv({ ROOMIE_ARCHETYPES: "1", NODE_ENV: "production" }, () => {
    assert.equal(archetypesUnlocked(), false);
    assert.equal(normalizePersonality(stored).base, "chill");
  });
  withEnv({ ROOMIE_ARCHETYPES: undefined, NODE_ENV: "development" }, () => assert.equal(archetypesUnlocked(), false));
  assert.equal(normalizePersonality(stored, { archetypes: true }).base, "hype", "an explicit option wins over the env");
  assert.equal(normalizePersonality(stored, { archetypes: false }).base, "chill");
});

test("patch validation: vibe, name, quirks and dials, with messages Roomie can repeat", () => {
  assert.throws(() => validatePersonalityPatch({ base: "pirate" as never }), /Vibe must be one of: chill, hype/);
  assert.throws(() => validatePersonalityPatch({ name: "Al" }), /3 to 24/);
  assert.throws(() => validatePersonalityPatch({ name: "the" }), /too common/);
  assert.throws(() => validatePersonalityPatch({ name: "<b>x</b>" }), /letters, numbers/);
  assert.throws(() => validatePersonalityPatch({ quirks: ["a", "b", "c", "d"] }), /Up to 3/);
  assert.throws(() => validatePersonalityPatch({ humor: 4 }), /0 to 3/);
  assert.deepEqual(validatePersonalityPatch({ name: "  Dino  ", quirks: [" loves the plant ", "loves the plant", ""] }), { name: "Dino", quirks: ["loves the plant"] });
});

test("changing the vibe resets the dials to its defaults unless they're in the same patch", () => {
  const p = applyPersonalityPatch(defaultPersonality(), validatePersonalityPatch({ emoji: "lots", humor: 3 }));
  assert.equal(effectiveDials(p).emoji, "lots");
  const butler = applyPersonalityPatch(p, validatePersonalityPatch({ base: "butler" }));
  assert.deepEqual(effectiveDials(butler), { emoji: "none", humor: 1, formality: 3 });
  const keep = applyPersonalityPatch(p, validatePersonalityPatch({ base: "butler", humor: 2 }));
  assert.equal(effectiveDials(keep).humor, 2);
});

test("confidence rises with messages: 0 at 0, under .3 at 50, ~.8 at 300, never above .9", () => {
  assert.equal(confidenceFor(0), 0);
  assert.ok(confidenceFor(50) < 0.3);
  assert.ok(confidenceFor(100) > 0.4 && confidenceFor(100) < 0.6);
  assert.ok(Math.abs(confidenceFor(300) - 0.8) <= 0.02, String(confidenceFor(300)));
  assert.ok(confidenceFor(100_000) <= 0.9);
});

test("slang budget: none below .3, one per 5 replies between .3 and .6, free above .6", () => {
  const slang = [{ phrase: "no cap", count: 9 }, { phrase: "bet", count: 4 }];
  assert.equal(slangBudget({ confidence: 0.2, slang }, []).level, "none");
  assert.equal(slangBudget({ confidence: 0.45, slang }, ["logged, $20 each", "done"]).level, "one");
  assert.equal(slangBudget({ confidence: 0.45, slang }, ["ok", "bet, logged", "done"]).level, "none", "borrowed within the last 4");
  assert.equal(slangBudget({ confidence: 0.45, slang }, ["a", "b", "c", "d", "bet, logged"]).level, "one", "the 5th reply back is outside the window");
  assert.equal(slangBudget({ confidence: 0.45, slang }, ["alphabet soup"]).level, "one", "whole words only");
  assert.equal(slangBudget({ confidence: 0.7, slang }, ["bet"]).level, "free");
  assert.equal(slangBudget({ confidence: 0.9, slang: [] }, []).level, "none");
});

test("nicknames need 3 sightings by others", () => {
  const l = { nicknames: [{ nickname: "Devvy", member: "Dev", count: 2 }, { nickname: "Boss", member: "Maya", count: 3 }] };
  assert.deepEqual(usableNicknames(l).map((n) => n.nickname), ["Boss"]);
});

test("/pet and 'pet roomie' are pet commands; ordinary sentences and other names aren't", () => {
  for (const t of ["/pet", "/pet@roomie_house_bot", "/petRoomie", "pet roomie", "*pets roomie*", "pets Roomie 🥹", "pat the roomie"]) assert.ok(isPetCommand(t), t);
  for (const t of ["my pet roomie is cute lol", "roomie I paid for pet food", "/pets", "pet the dog", "pets dino 🥹", "pat Dino"]) assert.ok(!isPetCommand(t), t);
});

test("mood: worried > $100 owed, sleepy after 5 quiet days, happy when square, else calm", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  const recent = new Date("2026-10-28T10:00:00Z");
  assert.equal(moodFrom({ maxOwedCents: 10_001, allSquare: false, lastMessageAt: recent, now }).mood, "worried");
  assert.equal(moodFrom({ maxOwedCents: 10_000, allSquare: false, lastMessageAt: recent, now }).mood, "calm");
  assert.equal(moodFrom({ maxOwedCents: 0, allSquare: true, lastMessageAt: recent, now }).mood, "happy");
  assert.equal(moodFrom({ maxOwedCents: 0, allSquare: true, lastMessageAt: new Date("2026-10-23T11:00:00Z"), now }).mood, "sleepy");
  assert.equal(moodFrom({ maxOwedCents: 0, allSquare: true, lastMessageAt: null, now }).mood, "sleepy");
});

test("lines follow the dials: deadpan and butler never use emoji, chill keeps names capitalized, light has at most one", () => {
  for (const base of ["deadpan", "butler"] as const) {
    const p = { ...defaultPersonality(), base };
    for (let h = 0; h < 24; h++) assert.equal(countEmoji(greetingLine(p, h, `s${h}`)), 0);
    assert.equal(countEmoji(winLine(p, { kind: "square", key: "x" })), 0);
    assert.equal(countEmoji(previewOwes(p)), 0);
  }
  const chill = defaultPersonality();
  assert.match(previewOwes(chill), /^Dev owes you \$30\./, "a money line is a task line: the name stays a name, even under chill");
  assert.ok(countEmoji(previewOwes(chill)) <= 1);
  assert.ok(countEmoji(previewOwes({ ...chill, base: "hype" })) >= 1);
  assert.ok(!/remind/i.test(previewOwes({ ...chill, base: "gremlin", humor: 0 })), "humor 0 drops the quip");
  assert.match(previewOwes({ ...chill, base: "butler" }, "Sam", "$12.50"), /^Sam owes you \$12\.50\. I shall mention it to them, discreetly\.$/);
  assert.match(winLine({ ...chill, base: "hype" }, { kind: "streak", key: "k", who: "Dev", n: 7, chore: "Dishes" }), /7/);
});

test("wins: streak milestones 3/7/30, a Checkout, and square only when the Settlement made everyone square", () => {
  const day = "2026-10-28";
  const w = winsFrom(
    [
      { tool: "log_chore", args: { chore: "dishes" }, result: { chore: "Dishes", streak: 7 } },
      { tool: "log_chore", args: { chore: "trash", who: "Sam" }, result: { chore: "Trash", streak: 4 } },
      { tool: "cart_checkout", result: { available: true, checkoutId: "c1" } },
      { tool: "cart_checkout", result: { available: false, checkoutId: "c2" } },
      { tool: "settle_up", result: { recorded: true } },
    ],
    { day, senderName: "Dev", allSquareAfter: true },
  );
  assert.deepEqual(w.map((x) => x.key), ["streak:dishes:dev:7:2026-10-28", "checkout:c1", "square:2026-10-28"]);
  assert.equal(w[0].who, "Dev");
  assert.deepEqual(winsFrom([{ tool: "settle_up", result: { recorded: true } }], { day, senderName: "Dev", allSquareAfter: false }), []);
  assert.deepEqual(winsFrom([{ tool: "settle_up", result: { recorded: false } }], { day, senderName: "Dev", allSquareAfter: true }), []);
});
