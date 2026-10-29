// Pet moments are said once: the day's greeting and each win. In-memory MomentStore (same contract as pet_moments).
// Run: npx tsx --test src/services/pet.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPersonality, winsFrom } from "@/lib/personality";
import { claimWins, dayGreeting, memoryMoments } from "./pet";

const TZ = "America/Chicago";
const at = (iso: string) => new Date(iso);
const base = { groupId: "g1", chattiness: "normal" as const, personality: defaultPersonality(), timezone: TZ, roomieSpokeAt: null };

test("greeting: the first message of the local day gets one line, the rest of the day none", async () => {
  const store = memoryMoments();
  const first = await dayGreeting(store, { ...base, now: at("2026-10-28T13:00:00Z") }); // 8 AM Chicago
  assert.ok(first && first.split("\n").length === 1 && !/https?:/.test(first), `one line, no link: ${first}`);
  assert.equal(await dayGreeting(store, { ...base, now: at("2026-10-28T13:05:00Z") }), null);
  assert.equal(await dayGreeting(store, { ...base, now: at("2026-10-29T04:00:00Z") }), null, "11 PM Chicago is still the 28th");
  assert.ok(await dayGreeting(store, { ...base, now: at("2026-10-29T13:00:00Z") }), "next day, again once");
  assert.ok(await dayGreeting(store, { ...base, groupId: "g2", now: at("2026-10-28T13:00:00Z") }), "per Group");
});

test("greeting: never when Chattiness is quiet; not when Roomie already posted today (the day is still used up)", async () => {
  const store = memoryMoments();
  assert.equal(await dayGreeting(store, { ...base, chattiness: "quiet", now: at("2026-10-28T13:00:00Z") }), null);
  assert.equal(store.claimed.size, 0, "quiet doesn't even claim");
  assert.equal(await dayGreeting(store, { ...base, roomieSpokeAt: at("2026-10-28T12:00:00Z"), now: at("2026-10-28T15:00:00Z") }), null);
  assert.equal(await dayGreeting(store, { ...base, now: at("2026-10-28T16:00:00Z") }), null, "claimed by the earlier check");
});

test("greeting: in the archetype's voice (butler is formal, deadpan has no emoji)", async () => {
  const butler = await dayGreeting(memoryMoments(), { ...base, personality: { ...defaultPersonality(), base: "butler" }, now: at("2026-10-28T13:00:00Z") });
  assert.match(butler ?? "", /^Good morning/);
  const deadpan = await dayGreeting(memoryMoments(), { ...base, personality: { ...defaultPersonality(), base: "deadpan" }, now: at("2026-10-28T23:00:00Z") });
  assert.equal(deadpan, "Evening.");
});

test("milestones: each win is celebrated once, even if the same result comes back twice", async () => {
  const store = memoryMoments();
  const p = { ...defaultPersonality(), base: "hype" as const };
  const run = () => winsFrom([{ tool: "log_chore", args: {}, result: { chore: "Dishes", streak: 3 } }], { day: "2026-10-28", senderName: "Dev" });
  const once = await claimWins(store, "g1", run(), p);
  assert.equal(once.length, 1);
  assert.match(once[0], /3/);
  assert.deepEqual(await claimWins(store, "g1", run(), p), [], "same streak, same day: already said");
  assert.deepEqual(await claimWins(store, "g1", winsFrom([{ tool: "log_chore", args: {}, result: { chore: "Dishes", streak: 4 } }], { day: "2026-10-28", senderName: "Dev" }), p), [], "4 isn't a milestone");
  assert.equal((await claimWins(store, "g1", winsFrom([{ tool: "log_chore", args: {}, result: { chore: "Dishes", streak: 7 } }], { day: "2026-11-01", senderName: "Dev" }), p)).length, 1, "7 is");
  const checkout = winsFrom([{ tool: "cart_checkout", result: { available: true, checkoutId: "c1" } }], { day: "2026-10-28", senderName: "Dev" });
  assert.equal((await claimWins(store, "g1", checkout, p)).length, 1);
  assert.equal((await claimWins(store, "g1", checkout, p)).length, 0, "the same Checkout reused: no second cheer");
  const square = winsFrom([{ tool: "settle_up", result: { recorded: true } }], { day: "2026-10-28", senderName: "Dev", allSquareAfter: true });
  assert.equal((await claimWins(store, "g1", square, p)).length, 1);
  assert.equal((await claimWins(store, "g1", square, p)).length, 0, "everyone square: once a day");
});
