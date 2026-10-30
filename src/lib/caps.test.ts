// The agent-run caps on in-memory counters (no DB). Run: npx tsx --test src/lib/caps.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { BREATHER_SHORT, CAPS, capKeys, clipInput, makeCaps, MAX_INPUT_CHARS } from "./caps";
import { MemoryCounters, WindowLimiter } from "./window-limit";

const DAY = 24 * 60 * 60 * 1000;

describe("WindowLimiter on a CounterStore (fixed windows)", () => {
  test("max per window, nothing counted past it, a new window starts over", async () => {
    let now = Date.UTC(2026, 9, 29, 10);
    const l = new WindowLimiter(2, DAY, () => now, new MemoryCounters());
    assert.equal(await l.hit("k"), true);
    assert.equal(await l.hit("k"), true);
    assert.equal(await l.hit("k"), false);
    assert.equal(await l.used("k"), 2, "the refused try wasn't counted");
    assert.equal(await l.hit("other"), true, "keys are separate");
    now = Date.UTC(2026, 9, 30, 0, 0, 1);
    assert.equal(await l.hit("k"), true, "a UTC day is a window");
    assert.equal(l.windowStart().toISOString(), "2026-10-30T00:00:00.000Z");
  });

  test("take() is still the sliding in-memory window (the beta form)", () => {
    let now = 0;
    const l = new WindowLimiter(1, 1000, () => now);
    assert.equal(l.take("ip"), true);
    assert.equal(l.take("ip"), false);
    now = 1000;
    assert.equal(l.take("ip"), true);
  });
});

describe("caps", () => {
  test("the numbers", () => {
    assert.deepEqual(
      [CAPS.memberDay.max, CAPS.groupBurst.max, CAPS.groupDay.max, CAPS.jevDay.max, CAPS.adderDay.max, MAX_INPUT_CHARS],
      [60, 30, 200, 2000, 3, 2000],
    );
    assert.equal(CAPS.groupBurst.windowMs, 10 * 60 * 1000);
    assert.doesNotMatch(BREATHER_SHORT, /tomorrow/, "the 10-minute cap says a few minutes");
  });

  test("a Member over 60 a day is stopped without using the Group's budget", async () => {
    const store = new MemoryCounters();
    const c = makeCaps(store, () => Date.UTC(2026, 9, 29, 12));
    let now = Date.UTC(2026, 9, 29, 0);
    const spread = makeCaps(store, () => (now += 30_000)); // 2 a minute: never the 10-minute cap
    for (let i = 0; i < 60; i++) assert.equal(await spread.run("g", "m1"), null, `run ${i + 1}`);
    assert.equal(await spread.run("g", "m1"), "member");
    assert.equal(await spread.run("g", "m1"), "member");
    assert.equal(await c.limiter.groupDay.used(capKeys.groupDay("g")), 60, "refused runs don't count for the Group");
    assert.equal(await spread.run("g", "m2"), null, "someone else still gets through");
  });

  test("a Group: 30 per 10 minutes, 200 a day", async () => {
    const burst = makeCaps(new MemoryCounters(), () => Date.UTC(2026, 9, 29, 12));
    for (let i = 0; i < 30; i++) assert.equal(await burst.run("g", `m${i}`), null);
    assert.equal(await burst.run("g", "m99"), "group-burst");

    let now = Date.UTC(2026, 9, 29, 0);
    const day = makeCaps(new MemoryCounters(), () => (now += 60_000)); // 1 a minute
    for (let i = 0; i < 200; i++) assert.equal(await day.run("g", `m${i % 50}`), null, `run ${i + 1}`);
    assert.equal(await day.run("g", "m-new"), "group-day");
  });

  test("a refused run counts for nobody: a burst-capped Group doesn't use up its Members' daily runs", async () => {
    const store = new MemoryCounters();
    const c = makeCaps(store, () => Date.UTC(2026, 9, 29, 12));
    for (let i = 0; i < 30; i++) await c.run("g", `m${i}`);
    for (let i = 0; i < 5; i++) assert.equal(await c.run("g", "late"), "group-burst");
    const l = new WindowLimiter(1, DAY, () => Date.UTC(2026, 9, 29, 12), store);
    assert.equal(await l.used(capKeys.member("late")), 0, "the Member's count is untouched");
    assert.equal(await l.used(capKeys.groupDay("g")), 30, "and so is the Group's daily count");
  });

  test("notices: once a day for the daily caps, once per 10 minutes for the burst cap; the dashboard's Jev budget is its own", async () => {
    let now = Date.UTC(2026, 9, 29, 12);
    const c = makeCaps(new MemoryCounters(), () => now);
    assert.equal(await c.noticeOnce("g", "burst"), true);
    assert.equal(await c.noticeOnce("g", "burst"), false);
    assert.equal(await c.noticeOnce("g", "day"), true, "a burst notice doesn't use up the daily one");
    now += 10 * 60 * 1000;
    assert.equal(await c.noticeOnce("g", "burst"), true);
    assert.equal(await c.noticeOnce("g", "day"), false);
    assert.equal(await c.noticeOnce("m1", "member"), true);
    assert.equal(await c.noticeOnce("m1", "member"), false);
    assert.equal(await c.noticeOnce("m2", "member"), true, "per Member");
    for (let i = 0; i < 2000; i++) await c.jev("g", "ui");
    assert.equal(await c.jev("g", "ui"), false);
    assert.equal(await c.jev("g", "chat"), true, "the Chat still gets Jev");
  });

  test("Jev: 2,000 a day per Group; new Groups: 3 a day per adder; the breather once a day", async () => {
    const c = makeCaps(new MemoryCounters(), () => Date.UTC(2026, 9, 29, 12));
    for (let i = 0; i < 2000; i++) await c.jev("g");
    assert.equal(await c.jev("g"), false);
    assert.equal(await c.jev("other"), true);
    for (let i = 0; i < 3; i++) assert.equal(await c.newGroup("telegram", "42"), true);
    assert.equal(await c.newGroup("telegram", "42"), false);
    assert.equal(await c.newGroup("whatsapp", "42"), true, "per Channel id");
    assert.equal(await c.noticeOnce("g"), true);
    assert.equal(await c.noticeOnce("g"), false);
  });

  test("clipInput: 2,000 characters, never half an emoji", () => {
    assert.equal(clipInput("short"), "short");
    assert.equal(clipInput("a".repeat(5000)).length, 2000);
    const cut = clipInput(`${"a".repeat(1999)}🦖🦖`);
    assert.equal(cut, "a".repeat(1999), "the dino's first half is dropped, not kept alone");
  });
});
