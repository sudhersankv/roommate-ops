// Trick votes without a DB: only coming-soon Tricks, one per Trick per address a day, the hourly limit, failures.
// Run: npx tsx --test src/services/trick-votes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { WindowLimiter } from "@/lib/window-limit";
import { MANIFESTS } from "@/toolkits/manifests";
import { SHOW_COUNT_FROM, SOON_CHANNELS, shownCount, voteForTrick, votableTrickIds } from "./trick-votes";

const silence = async <T>(fn: () => Promise<T>): Promise<T> => {
  const [log, err] = [console.log, console.error];
  console.log = console.error = () => {};
  try {
    return await fn();
  } finally {
    [console.log, console.error] = [log, err];
  }
};

const fresh = () => ({ limiter: new WindowLimiter(3, 60_000), perTrick: new WindowLimiter(1, 60_000) });

test("only coming-soon Tricks and the Soon Channels can be voted for", async () => {
  const ids = votableTrickIds();
  assert.ok(ids.includes("trips") && ids.includes("stickers"));
  assert.ok(ids.includes("outings") && ids.includes("cooking"));
  for (const m of MANIFESTS) assert.ok(!ids.includes(m.id), `${m.id} is built, not votable`);
  const rows: unknown[] = [];
  for (const bad of ["splitting", "nope", 42, undefined, "channel:telegram", "channel:whatsapp", "channel:"]) {
    const r = await voteForTrick(bad, { ip: "1.2.3.4" }, { ...fresh(), insert: async (row) => void rows.push(row) });
    assert.deepEqual(r.ok, false, String(bad));
  }
  assert.equal(rows.length, 0);
});

test("channel votes (ADR 0015): channel:discord and channel:imessage are rows like any Trick, with the same per-address limit", async () => {
  assert.deepEqual(
    SOON_CHANNELS.map((c) => c.id),
    ["channel:discord", "channel:imessage"],
  );
  const rows: { trickId: string }[] = [];
  const deps = { ...fresh(), insert: async (row: { trickId: string }) => void rows.push(row) };
  assert.deepEqual(await silence(() => voteForTrick("channel:discord", { ip: "1.2.3.4" }, deps)), { ok: true, counted: true });
  assert.deepEqual(await silence(() => voteForTrick("channel:imessage", { ip: "1.2.3.4" }, deps)), { ok: true, counted: true });
  assert.deepEqual(await silence(() => voteForTrick("channel:discord", { ip: "1.2.3.4" }, deps)), { ok: true, counted: false }, "one per Channel per address a day");
  assert.deepEqual(
    rows.map((r) => r.trickId),
    ["channel:discord", "channel:imessage"],
  );
  assert.equal(shownCount(SHOW_COUNT_FROM), SHOW_COUNT_FROM, "a Channel's count shows from the same threshold");
});

test("a vote stores the Trick and an IP hash, never the IP; a repeat that day is a quiet no-op", async () => {
  const rows: { trickId: string; ipHash?: string | null }[] = [];
  const deps = { ...fresh(), insert: async (row: { trickId: string; ipHash?: string | null }) => void rows.push(row) };
  assert.deepEqual(await silence(() => voteForTrick("trips", { ip: "1.2.3.4" }, deps)), { ok: true, counted: true });
  assert.deepEqual(await silence(() => voteForTrick("trips", { ip: "1.2.3.4" }, deps)), { ok: true, counted: false });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trickId, "trips");
  assert.match(rows[0].ipHash ?? "", /^[0-9a-f]{32}$/);
  assert.ok(!JSON.stringify(rows).includes("1.2.3.4"));
});

test("the hourly limit per address, and a failed insert is a message, not a throw", async () => {
  const deps = { ...fresh(), insert: async () => {} };
  const ids = votableTrickIds();
  for (const id of ids.slice(0, 3)) assert.equal((await silence(() => voteForTrick(id, { ip: "5.6.7.8" }, deps))).ok, true);
  const limited = await silence(() => voteForTrick(ids[3], { ip: "5.6.7.8" }, deps));
  assert.equal(limited.ok === false && limited.reason, "rate_limited");

  const failed = await silence(() => voteForTrick("trips", { ip: "9.9.9.9" }, { ...fresh(), insert: async () => Promise.reject(new Error("db down")) }));
  assert.equal(failed.ok === false && failed.reason, "failed");
});

test("counts show only from SHOW_COUNT_FROM", () => {
  assert.equal(shownCount(undefined), null);
  assert.equal(shownCount(SHOW_COUNT_FROM - 1), null);
  assert.equal(shownCount(SHOW_COUNT_FROM), SHOW_COUNT_FROM);
});

test("a counted vote tells the operator once; a repeat that day doesn't", async () => {
  const told: string[] = [];
  const deps = { ...fresh(), insert: async () => {}, notify: async (id: string) => void told.push(id) };
  await silence(() => voteForTrick("channel:discord", { ip: "9.9.9.9" }, deps));
  await silence(() => voteForTrick("channel:discord", { ip: "9.9.9.9" }, deps));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(told, ["channel:discord"]);
});

test("voteLabel: a Channel or a coming-soon Trick by name", async () => {
  const { voteLabel } = await import("./trick-votes");
  assert.equal(voteLabel("channel:imessage"), "iMessage");
  assert.equal(voteLabel("outings"), "Outings");
});
