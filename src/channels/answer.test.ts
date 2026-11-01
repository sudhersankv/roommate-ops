// Sending an answer with a reaction (#77). Run: npx tsx --test src/channels/answer.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { sendAnswer } from "./answer";
import type { Outgoing } from "./types";

function target(opts: { canReact?: boolean; refuse?: boolean } = {}) {
  const reacted: string[] = [];
  const sent: Outgoing[] = [];
  return {
    reacted,
    sent,
    to: {
      ...(opts.canReact === false
        ? {}
        : {
            react: async (e: string) => {
              if (opts.refuse) throw new Error("REACTION_INVALID");
              reacted.push(e);
            },
          }),
      send: async (o: Outgoing) => void sent.push(o),
    },
  };
}

test("a reaction alone: only the reaction, no message", async () => {
  const t = target();
  await sendAnswer({ text: "", react: "✅" }, t.to);
  assert.deepEqual(t.reacted, ["✅"]);
  assert.deepEqual(t.sent, []);
});

test("a reaction with a line: both, and the line goes without the react field", async () => {
  const t = target();
  await sendAnswer({ text: "Three in a row, Dev.", react: "✅" }, t.to);
  assert.deepEqual(t.reacted, ["✅"]);
  assert.deepEqual(t.sent, [{ text: "Three in a row, Dev." }]);
});

test("no way to react (no message id, a Channel without react) or a refused reaction: the emoji as text", async () => {
  for (const t of [target({ canReact: false }), target({ refuse: true })]) {
    await sendAnswer({ text: "", react: "👍" }, t.to);
    assert.deepEqual(t.sent, [{ text: "👍" }]);
  }
  const withLine = target({ refuse: true });
  await sendAnswer({ text: "Three in a row.", react: "✅" }, withLine.to);
  assert.deepEqual(withLine.sent, [{ text: "Three in a row." }], "the line is enough; no stray emoji");
});

test("a plain answer is sent as it is", async () => {
  const t = target();
  await sendAnswer({ text: "Yep?", buttons: [{ text: "Open", url: "https://x" }] }, t.to);
  assert.deepEqual(t.reacted, []);
  assert.deepEqual(t.sent, [{ text: "Yep?", buttons: [{ text: "Open", url: "https://x" }] }]);
});
