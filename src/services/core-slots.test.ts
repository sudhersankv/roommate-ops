// Core slots, pure: the Bundle with core's Reminders line last, and the urgent slot's decision table. Apt 4B (Maya,
// Dev, Sam) in Chicago. No DB. Run: npx tsx --test src/services/core-slots.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeBundle, coreBundleLine } from "./bundle";
import { urgentOutcome, urgentPlan } from "./urgent";

const CHI = "America/Chicago";
const NOW = new Date("2026-11-02T15:05:00Z"); // Mon 9:05 CST, the Bundle's hour
const rem = (text: string, iso: string, memberId: string | null = null) => ({ text, dueAt: new Date(iso), memberId });

test("core's Bundle line: whole-group Reminders still to come today, at most three; none -> null", () => {
  const upcoming = [
    rem("Trash goes out", "2026-11-03T02:00:00Z"), // 8 PM tonight
    rem("Landlord's plumber", "2026-11-02T20:30:00Z"), // 2:30 PM
    rem("Call mom", "2026-11-02T22:00:00Z", "dev-id"), // Dev's own: private, never in the Bundle
    rem("Rent", "2026-11-03T16:00:00Z"), // tomorrow
    rem("Earlier today", "2026-11-02T14:00:00Z"), // already gone off
  ];
  assert.equal(coreBundleLine(upcoming, CHI, NOW), "⏰ Today: Trash goes out (8 PM), Landlord's plumber (2:30 PM).");
  assert.equal(coreBundleLine([rem("Rent", "2026-11-03T16:00:00Z")], CHI, NOW), null);
  assert.equal(coreBundleLine([], CHI, NOW), null);
  const many = ["a", "b", "c", "d"].map((t, i) => rem(t, `2026-11-02T2${i}:00:00Z`));
  assert.match(coreBundleLine(many, CHI, NOW)!, /, \+1 more\.$/);
});

test("the Bundle: the Tricks' lines in post order, core's Reminders line last; nothing to say -> no post", () => {
  const house = "🧹 On the chart today: dishes (Dev). Tell me when it's done.";
  const core = coreBundleLine([rem("Trash goes out", "2026-11-03T02:00:00Z")], CHI, NOW);
  assert.equal(composeBundle(["💸 Rent's due Friday.", null, house, null, core]), `💸 Rent's due Friday.\n${house}\n⏰ Today: Trash goes out (8 PM).`);
  assert.equal(composeBundle([null, null, coreBundleLine([], CHI, NOW)]), null);
});

test("urgentPlan: daytime posts now; at 23:00 it waits for 08:00 and takes tomorrow's slot", () => {
  assert.deepEqual(urgentPlan(NOW, CHI), { quiet: false, at: NOW, period: "2026-11-02" });
  const night = urgentPlan(new Date("2026-11-03T05:00:00Z"), CHI); // Mon 23:00 CST
  assert.equal(night.quiet, true);
  assert.equal(night.at.toISOString(), "2026-11-03T14:00:00.000Z");
  assert.equal(night.period, "2026-11-03");
  assert.equal(urgentPlan(new Date("2026-11-02T12:00:00Z"), CHI).period, "2026-11-02", "06:00 waits for 08:00 the same day");
});

test("urgentOutcome: paused -> nothing; slot already taken -> refused; quiet -> held; else post", () => {
  const at = new Date("2026-11-03T14:00:00Z");
  assert.deepEqual(urgentOutcome({ paused: true, claimed: false, quiet: false, at }), { posted: false, reason: "paused" });
  assert.deepEqual(urgentOutcome({ paused: false, claimed: false, quiet: false, at }), { posted: false, reason: "claimed" });
  assert.deepEqual(urgentOutcome({ paused: false, claimed: false, quiet: true, at }), { posted: false, reason: "claimed" });
  assert.deepEqual(urgentOutcome({ paused: false, claimed: true, quiet: true, at }), { posted: false, reason: "quiet", dueAt: at });
  assert.equal(urgentOutcome({ paused: false, claimed: true, quiet: false, at }), "post");
});
