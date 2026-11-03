import { test } from "node:test";
import assert from "node:assert/strict";
import { openerOf, recentPhrasing, shortLineOf, VARIETY_WINDOW } from "./variety";

const NAMES = ["Maya", "Dev", "Sam"];

test("openerOf: a short first clause, else the first two words", () => {
  assert.equal(openerOf("Logged. $60 internet, $20 each."), "Logged.");
  assert.equal(openerOf("Got it, trash goes out Tuesday."), "Got it");
  assert.equal(openerOf("On it! Emailed the leasing office."), "On it!");
  assert.equal(openerOf("Logged both: $20.00 paper towels and $42.18 Trader Joe's."), "Logged both");
  assert.equal(openerOf("Added milk, 1 gal."), "Added milk");
  assert.equal(openerOf("Nice one, that's the third week in a row."), "Nice one");
  assert.equal(openerOf("Set for Tuesday at 8 PM, everyone gets it."), "Set for");
});

test("openerOf: a reply that leads with the fact has no opener", () => {
  assert.equal(openerOf("$20.72 to Maya. That's it."), null, "an amount");
  assert.equal(openerOf("July 31. Nine months to go."), null, "a date");
  assert.equal(openerOf("9 PM works."), null, "a time");
  assert.equal(openerOf("Dev.", NAMES), null, "a name is the answer");
  assert.equal(openerOf("Sam's on trash.", NAMES), null, "a possessive name too");
  assert.equal(openerOf("Yours, Sam."), null, "you / yours is the answer");
  assert.equal(openerOf("(reacted ✅)"), null, "a reaction isn't phrasing");
  assert.equal(openerOf(""), null);
});

test("shortLineOf: a short closing line after the first sentence", () => {
  assert.equal(shortLineOf("$20.72 to Maya. That's it."), "That's it.");
  assert.equal(shortLineOf("Money, groceries, chores. Just talk to me."), "Just talk to me.");
  assert.equal(shortLineOf("Logged."), null, "one sentence");
  assert.equal(shortLineOf("Logged. Not everyone in? Say who."), "Say who.");
  assert.equal(shortLineOf("Done. I'll ping him at 9 tomorrow morning."), null, "too long to be a stock line");
});

test("recentPhrasing: the last four replies, each once, newest first", () => {
  const replies = ["Logged. $40 pizza, split 3 ways.", "Done. I'll ping him at 9.", "logged! $60 internet, $20 each.", "Got it, trash Tuesday.", "On it. Emailed them."];
  const v = recentPhrasing(replies, NAMES);
  assert.deepEqual(v.openers, ["Logged.", "Done.", "Got it"], "case and punctuation ignored; the fifth is outside the window");
  assert.equal(VARIETY_WINDOW, 4);
  assert.ok(!v.openers.includes("On it."));
});

test("recentPhrasing: answers and reactions add nothing", () => {
  const v = recentPhrasing(["Dev.", "(reacted ✅)", "$20.72 to Maya. That's it.", "Nothing. You're square."], NAMES);
  assert.deepEqual(v.openers, ["Nothing."]);
  assert.deepEqual(v.lines, ["That's it.", "You're square."]);
  assert.deepEqual(recentPhrasing([]), { openers: [], lines: [] });
});
