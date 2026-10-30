// Replies typed like a person. Run: npx tsx --test src/channels/humanize.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { betweenDelayMs, HUMANIZE, planDelivery, splitBubbles, typingDelayMs } from "./humanize";

test("typing delay: about 2.5 s for a normal line, never under 1.2 s or over 4 s", () => {
  const normal = typingDelayMs("Logged. $60 internet, $20 each.");
  assert.ok(normal >= 1500 && normal <= 3000, String(normal));
  assert.equal(typingDelayMs("ok"), HUMANIZE.minMs);
  assert.equal(typingDelayMs("x".repeat(2000)), HUMANIZE.maxFirstMs);
  assert.ok(betweenDelayMs("x".repeat(2000)) <= HUMANIZE.maxBetweenMs);
});

test("a short reply is one bubble; sentences pack into a few", () => {
  assert.deepEqual(splitBubbles("Nothing of yours right now, Ryan. Just sudhersan's milk and eggs."), ["Nothing of yours right now, Ryan. Just sudhersan's milk and eggs."]);
  const long =
    "Your eggs aren't in the cart, Ryan. It only has sudhersan's milk and eggs, about $8.78 total. Your add said it went through, but it isn't showing now. Want me to add them again?";
  const b = splitBubbles(long);
  assert.ok(b.length >= 2 && b.length <= 3, JSON.stringify(b));
  assert.equal(b.join(" "), long, "nothing lost");
  for (const x of b) assert.ok(x.length <= 200, x);
});

test("decimals and numbered items don't split; lists and links stay whole", () => {
  assert.deepEqual(splitBubbles("Sam owes Maya $16.50. Dev's all square. Trash is next, Sam's up."), ["Sam owes Maya $16.50. Dev's all square. Trash is next, Sam's up."]);
  const list = "This week:\n1. dishes: Dev\n2. trash: Sam\n3. bathroom: Maya\nSwap if you need to, just tell me.";
  assert.deepEqual(splitBubbles(list), [list]);
  const linked = "Here's your dashboard. Works once, expires in 24 hours. Open dashboard — https://roomie.fly.dev/claim/abc";
  const b = splitBubbles(linked);
  assert.equal(b.at(-1), "Open dashboard — https://roomie.fly.dev/claim/abc", JSON.stringify(b));
  assert.ok(!b[0].includes("https://"));
});

test("paragraphs always split; never more than 3 bubbles", () => {
  const b = splitBubbles("Hey all, I'm Roomie.\n\nTell me what this group is for.\n\nMaya added me.\n\nOne more thing.");
  assert.equal(b.length, 3);
  assert.ok(b[2].includes("Maya added me.") && b[2].includes("One more thing."));
});

test("the whole delivery is capped at 10 s", () => {
  const plan = planDelivery(("A long sentence about rent and bills that goes on. ").repeat(12));
  assert.ok(plan.length <= 3);
  assert.ok(plan.reduce((s, b) => s + b.typingMs, 0) <= HUMANIZE.totalCapMs);
  assert.ok(plan[0].typingMs > 0);
});
