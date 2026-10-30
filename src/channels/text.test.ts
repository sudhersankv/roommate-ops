// The first-contact copy (/help, /start) in Tricks words. Run: npx tsx --test src/channels/text.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { helpText, startReply } from "./text";

const BANNED = /toolkit|capabilit|module|plugin|enable|feature/i;

test("/help for a group: the Tricks it taught Roomie, one line each, and how to teach the next", () => {
  const text = helpText(["splitting", "groceries"]);
  const lines = text.split("\n");
  assert.ok(lines.length <= 8, `at most 8 lines, got ${lines.length}`);
  assert.match(lines[0], /^I'm Roomie 🦖 Say "roomie"/);
  assert.equal(lines[1], "Tricks I know here: Money and Groceries.");
  assert.match(text, /^Money: "I paid 60 for internet", "who owes what\?"$/m);
  assert.match(text, /^Groceries: "tacos for 5 friday"/m);
  assert.ok(!/^House:/m.test(text), "only what this group taught it");
  assert.match(lines.at(-1)!, /Teach me more: "roomie, learn house"\. Drop one: "roomie, forget groceries"\./);
  assert.ok(!BANNED.test(text));
  assert.ok(!/Splitting/.test(text), "the Trick is called Money");
  assert.ok(!/https?:\/\//.test(text));
});

test("/help with every Trick learned: at most 8 lines, no 'learn' suggestion for something it knows", () => {
  const text = helpText(["splitting", "groceries", "house"]);
  assert.ok(text.split("\n").length <= 8);
  assert.match(text, /Tricks I know here: Money, Groceries and House\./);
  assert.ok(!/roomie, learn/.test(text));
  assert.match(text, /Drop one any time: "roomie, forget house"\. Lease Inbox and more are on the way\./);
});

test("/help with nothing learned, and without a group (a DM): still short and in Tricks words", () => {
  assert.match(helpText([]), /Tricks I know here: none yet\.\n/);
  assert.match(helpText([]), /Teach me more: "roomie, learn money"\.$/);
  const dm = helpText();
  assert.ok(dm.split("\n").length <= 8);
  assert.match(dm, /Tricks I can learn: Money, Groceries and House, more on the way\./);
  assert.ok(!BANNED.test(dm));
});

test("/start for someone in no group: add me, say what it's for, I learn Tricks", () => {
  assert.equal(startReply("Sam", 0), `Hey Sam 👋 I'm Roomie. Add me to a group chat, tell me what it's for, and I'll learn the right Tricks.`);
  assert.equal(startReply("Sam", 1).split("\n").length, 1);
});
