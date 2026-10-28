// Pure tests for WHEN Roomie speaks: decideReply (attention window) and parseSilent. No DB, no model.
// Run: npx tsx --test src/router.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { ATTENTION_MAX_FOLLOW_UPS, ATTENTION_WINDOW_MS, decideReply, parseSilent, saysRoomie } from "./router-policy";

const now = new Date("2026-10-04T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const min = 60_000;

describe("saysRoomie", () => {
  test("the word roomie, any case, anywhere", () => {
    for (const t of ["roomie add milk", "Roomie, who owes what?", "ok ROOMIE", "thanks roomie!"]) assert.equal(saysRoomie(t), true, t);
  });

  test("not inside other words", () => {
    for (const t of ["my roomies are out", "roomiebot", "add milk", ""]) assert.equal(saysRoomie(t), false, t);
  });
});

describe("decideReply", () => {
  test("defaults: 3 minutes, 4 messages", () => {
    assert.equal(ATTENTION_WINDOW_MS, 3 * min);
    assert.equal(ATTENTION_MAX_FOLLOW_UPS, 4);
  });

  test("hard trigger always replies, window or not", () => {
    assert.equal(decideReply({ hardTrigger: true, lastRoomieAt: null, humanSinceRoomie: 0, now }), "reply");
    assert.equal(decideReply({ hardTrigger: true, lastRoomieAt: ago(10 * min), humanSinceRoomie: 99, now }), "reply");
    assert.equal(decideReply({ hardTrigger: true, lastRoomieAt: ago(10_000), humanSinceRoomie: 1, now }), "reply");
  });

  test("no Roomie reply ever -> ignore", () => {
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: null, humanSinceRoomie: 0, now }), "ignore");
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: null, humanSinceRoomie: 1, now }), "ignore");
  });

  test("in window: within 3 min and fewer than 4 human messages -> maybe", () => {
    // humanSinceRoomie includes the message being handled (logged before the decision): 1 = first follow-up.
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(5_000), humanSinceRoomie: 1, now }), "maybe");
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(2 * min), humanSinceRoomie: 2, now }), "maybe");
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(3 * min), humanSinceRoomie: 3, now }), "maybe"); // edges inclusive
  });

  test("4th follow-up closes the window -> ignore", () => {
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(5_000), humanSinceRoomie: 4, now }), "ignore");
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(5_000), humanSinceRoomie: 12, now }), "ignore");
  });

  test("stale reply (> 3 min) -> ignore even with no messages since", () => {
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(3 * min + 1), humanSinceRoomie: 1, now }), "ignore");
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(10 * min), humanSinceRoomie: 1, now }), "ignore");
  });

  test("a Roomie timestamp in the future (clock skew) is not a window", () => {
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(-5_000), humanSinceRoomie: 1, now }), "ignore");
  });

  test("windowMs and maxFollowUps are tunable", () => {
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(9 * min), humanSinceRoomie: 1, now, windowMs: 10 * min }), "maybe");
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(5_000), humanSinceRoomie: 2, now, maxFollowUps: 2 }), "ignore");
    assert.equal(decideReply({ hardTrigger: false, lastRoomieAt: ago(5_000), humanSinceRoomie: 1, now, maxFollowUps: 2 }), "maybe");
  });
});

describe("parseSilent", () => {
  test("[silent] variants mean no reply", () => {
    for (const t of ["[silent]", "[SILENT]", "  [Silent]  ", "[silent].", "[silent]!!", "*[silent]*", "\"[silent]\"", "([silent])", "\n[silent]\n"]) {
      assert.equal(parseSilent(t), null, JSON.stringify(t));
    }
  });

  test("normal text passes through (trimmed)", () => {
    assert.equal(parseSilent("Bet. Chips added 🛒"), "Bet. Chips added 🛒");
    assert.equal(parseSilent("  two lines\nhere  "), "two lines\nhere");
    assert.equal(parseSilent("👍"), "👍");
  });

  test("the word silent without brackets, or mid-text, is a normal reply", () => {
    assert.equal(parseSilent("silent"), "silent");
    assert.equal(parseSilent("ok staying [silent] on that one"), "ok staying [silent] on that one");
  });

  test("a leading [silent] followed by real text is stripped and sent", () => {
    assert.equal(parseSilent("[silent] actually wait, chips are already in the cart"), "actually wait, chips are already in the cart");
    assert.equal(parseSilent("[silent]\n\nLogged it anyway 🛒"), "Logged it anyway 🛒");
    assert.equal(parseSilent("[silent] - Ryan owes $20 btw"), "Ryan owes $20 btw");
  });
});
