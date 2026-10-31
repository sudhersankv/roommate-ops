// Quick messages read as one (#41), with a fake clock: the sleeps only end when the test moves time on.
// Run: npx tsx --test src/channels/coalesce.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Coalescer } from "./coalesce";

function fake(windowMs = 4_000) {
  let now = 0;
  const sleepers: { until: number; wake: () => void }[] = [];
  const co = new Coalescer({
    windowMs,
    clock: () => now,
    sleep: (ms) => new Promise<void>((wake) => sleepers.push({ until: now + ms, wake })),
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const s of sleepers.splice(0)) (s.until <= now ? s.wake : () => sleepers.push(s))();
    await new Promise((r) => setImmediate(r));
  };
  return { co, advance };
}
const settle = () => new Promise((r) => setImmediate(r));

describe("quick messages from one Member", () => {
  test("two texts two seconds apart -> one run with both, addressed if either was; the first runs nothing", async () => {
    const { co, advance } = fake();
    const first = co.arrive("chat", "maya", true);
    const p1 = co.take(first, { text: "we need to make tacos tonight, what do we need" });
    await advance(2_000);
    const second = co.arrive("chat", "maya", true);
    assert.equal(await p1, null, "the first rides along with the second");
    const p2 = co.take(second, { text: "roomie suggest", mentionsRoomie: true });
    await advance(4_000);
    assert.deepEqual(await p2, { text: "we need to make tacos tonight, what do we need\nroomie suggest", mentionsRoomie: true, arrivedAt: 0, count: 2 });
  });

  test("a text alone runs once the window after it has passed, not before", async () => {
    const { co, advance } = fake();
    const a = co.arrive("chat", "maya", true);
    let done = false;
    const p = co.take(a, { text: "roomie add milk" }).then((r) => ((done = true), r));
    await advance(3_999);
    assert.equal(done, false);
    await advance(1);
    assert.deepEqual(await p, { text: "roomie add milk", arrivedAt: 0, count: 1 });
  });

  test("the second arrived before the first's turn came (the queue was busy): merged with no wait", async () => {
    const { co } = fake();
    const a = co.arrive("chat", "maya", true);
    const b = co.arrive("chat", "maya", true);
    assert.equal(await co.take(a, { text: "eggs" }), null);
    const c = co.arrive("chat", "sam", true); // someone else is next: Maya's run goes now
    assert.deepEqual(await co.take(b, { text: "and milk" }), { text: "eggs\nand milk", arrivedAt: 0, count: 2 });
    void c;
  });

  test("window 0: every message on its own, at once", async () => {
    const { co } = fake(0);
    const a = co.arrive("chat", "maya", true);
    co.arrive("chat", "maya", true);
    assert.deepEqual(await co.take(a, { text: "one" }), { text: "one", arrivedAt: 0, count: 1 });
  });
});

describe("other senders", () => {
  test("someone else's message is never merged, and it ends the wait at once instead of being held behind it", async () => {
    const { co, advance } = fake();
    const maya = co.arrive("chat", "maya", true);
    const p = co.take(maya, { text: "roomie add milk" });
    await advance(1_000);
    const dev = co.arrive("chat", "dev", true);
    assert.deepEqual(await p, { text: "roomie add milk", arrivedAt: 0, count: 1 }, "Maya's runs as soon as Dev spoke, alone");
    const q = co.take(dev, { text: "roomie what do I owe" });
    await advance(4_000);
    assert.deepEqual(await q, { text: "roomie what do I owe", arrivedAt: 1_000, count: 1 });
  });

  test("Maya, Dev, Maya: three runs (not consecutive)", async () => {
    const { co } = fake();
    const a = co.arrive("chat", "maya", true);
    const b = co.arrive("chat", "dev", true);
    const c = co.arrive("chat", "maya", true);
    assert.equal((await co.take(a, { text: "a" }))?.text, "a");
    assert.equal((await co.take(b, { text: "b" }))?.text, "b");
    co.arrive("chat", "sam", true);
    assert.equal((await co.take(c, { text: "c" }))?.text, "c");
  });

  test("another Chat's messages don't count", async () => {
    const { co, advance } = fake();
    const a = co.arrive("chat-1", "maya", true);
    const p = co.take(a, { text: "a" });
    co.arrive("chat-2", "maya", true);
    await settle();
    await advance(4_000);
    assert.equal((await p)?.count, 1);
  });

  test("a photo (not mergeable) after a text: the text runs alone, and the photo runs at once", async () => {
    const { co } = fake();
    const a = co.arrive("chat", "maya", true);
    const b = co.arrive("chat", "maya", false);
    assert.equal((await co.take(a, { text: "here's the receipt" }))?.count, 1);
    assert.deepEqual(await co.take(b, { text: "" }), { text: "", arrivedAt: 0, count: 1 });
  });
});

describe("review fixes (#51)", () => {
  test("a same-sender text that came after the window isn't merged, even if the queue was slow", async () => {
    const { co, advance } = fake();
    const a = co.arrive("chat", "maya", true);
    await advance(10_000);
    const b = co.arrive("chat", "maya", true);
    const ra = await co.take(a, { text: "add milk" });
    assert.deepEqual(ra, { text: "add milk", arrivedAt: 0, count: 1 }, "runs alone");
    const pb = co.take(b, { text: "and what's for dinner?" });
    await advance(4_000);
    assert.equal((await pb)?.count, 1);
  });

  test("a queue blocked for over a minute still merges two quick texts and loses none (no age pruning)", async () => {
    const { co, advance } = fake();
    const a = co.arrive("chat", "maya", true);
    await advance(1_000);
    const b = co.arrive("chat", "maya", true);
    await advance(90_000);
    co.arrive("chat", "dev", true);
    assert.equal(await co.take(a, { text: "one" }), null);
    const rb = await co.take(b, { text: "two" });
    assert.equal(rb?.text, "one\ntwo");
  });

  test("a bare poll number is never mergeable", async () => {
    const { mergeableText, looksLikeVote } = await import("./coalesce");
    for (const v of ["2", " 1, 3 ", "1 and 2"]) assert.equal(looksLikeVote(v), true, v);
    assert.equal(mergeableText("2"), false);
    assert.equal(mergeableText("2 slices left"), true);
    assert.equal(mergeableText("/help"), false);
    assert.equal(mergeableText("roomie suggest"), true);
  });
});
