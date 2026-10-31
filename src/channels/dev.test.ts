// The dev Channel (dev-chat): a Poll prints with numbers and gets an id dev-chat's `vote` command can name.
// Run: npx tsx --test src/channels/dev.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { DevChannel, type DevOutput } from "./dev";
import { helpText, renderPollAsText } from "./text";

test("a Poll on the dev Channel: printed with numbered options, an id per poll, no native polls", async () => {
  const out: DevOutput[] = [];
  const dev = new DevChannel((o) => out.push(o));
  assert.equal(dev.nativePolls, false, "a bare number from a Member is the vote");
  const sent = await dev.sendToChat("dev-apt-4b", { text: "fallback", poll: { question: "Who's in on the $60 pizza?", options: ["I'm in", "Not me"], multi: false } });
  assert.equal(out[0].msg.text, "(poll 1) Who's in on the $60 pizza?\n1. I'm in\n2. Not me\nReply with a number.");
  assert.equal(sent.externalId, dev.pollExternalId(1));
  const second = await dev.sendToChat("dev-apt-4b", { text: "x", poll: { question: "Who had pizza?", options: ["Maya", "Dev", "Sam"], multi: true } });
  assert.equal(second.externalId, dev.pollExternalId(2));
  assert.notEqual(second.externalId, sent.externalId);
  assert.deepEqual(await dev.sendToChat("dev-apt-4b", { text: "hi" }), {}, "plain text has no id to keep");
});

test("renderPollAsText: question, numbered options, how to answer", () => {
  assert.equal(renderPollAsText({ question: "Who had pizza?", options: ["Maya", "Dev"], multi: true }), "Who had pizza?\n1. Maya\n2. Dev\nReply with the numbers (e.g. 1 3).");
});

test("/help mentions DMs in one line and stays within 8 lines", () => {
  for (const learned of [undefined, [], ["splitting"], ["splitting", "groceries", "house"]]) {
    const text = helpText(learned);
    assert.ok(text.split("\n").length <= 8, text);
    assert.equal(text.split("\n").filter((l) => /\bDM\b/.test(l)).length, 1);
  }
});
