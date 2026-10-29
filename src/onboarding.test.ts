// Onboarding copy and defaults, no DB. Run: npx tsx --test src/onboarding.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalPrompt, introMessage, rosterStillOpen } from "./onboarding";
import { defaultToolkitsFor, validateSettings } from "./services/groups";

test("intro: names the Admin and asks purpose, currency and time zone in one message", () => {
  const text = introMessage("Maya");
  assert.match(text, /Maya added me, so Maya's my admin/);
  for (const q of [/what's this group for/, /currency/, /time zone/]) assert.match(text, q);
  assert.match(text, /USD, Chicago/, "says what the defaults are");
  assert.ok(text.split("\n").length <= 3, "one short message");
  assert.ok(!/https?:\/\//.test(text), "no links at join time (ADR 0001)");
});

test("intro on Telegram: one extra line asking people to press Start, still no URL", () => {
  const text = introMessage("Maya", { dmHandle: "roomie_house_bot" });
  assert.match(text, /tap @roomie_house_bot and press Start/);
  assert.equal(text.split("\n").length, 3);
  assert.ok(!/https?:\/\//.test(text));
});

test("roster grace (ADR 0010): Telegram first-time senders count as already there for 24 hours; other Channels never", () => {
  const joined = new Date("2026-10-28T12:00:00Z");
  const at = (h: number) => new Date(joined.getTime() + h * 3_600_000);
  assert.equal(rosterStillOpen({ channel: "telegram", createdAt: joined }, at(1)), true);
  assert.equal(rosterStillOpen({ channel: "telegram", createdAt: joined }, at(23.9)), true);
  assert.equal(rosterStillOpen({ channel: "telegram", createdAt: joined }, at(24)), false);
  assert.equal(rosterStillOpen({ channel: "whatsapp", createdAt: joined }, at(1)), false);
  assert.equal(rosterStillOpen({ channel: "dev", createdAt: joined }, at(0)), false);
});

test("approval prompt: asks the Admins by name and says what Pending means", () => {
  assert.match(approvalPrompt("Priya", ["Maya"]), /Maya: approve Priya\? Say "roomie approve Priya"/);
  assert.match(approvalPrompt("Priya", ["Maya", "Dev"]), /Maya and Dev: approve Priya/);
  assert.match(approvalPrompt("Priya", []), /Admins: approve Priya/);
  assert.match(approvalPrompt("Priya", ["Maya"]), /won't log anything/);
});

test("default Toolkits per purpose (core is always on and not listed)", () => {
  assert.deepEqual(defaultToolkitsFor("roommates"), ["splitting", "groceries", "chores", "upkeep"]);
  assert.deepEqual(defaultToolkitsFor("trip"), ["splitting", "groceries"]);
  assert.deepEqual(defaultToolkitsFor("friends"), ["splitting"]);
  assert.deepEqual(defaultToolkitsFor("family"), ["splitting", "groceries", "chores", "upkeep"]);
  assert.deepEqual(defaultToolkitsFor("work"), ["splitting"]);
  assert.deepEqual(defaultToolkitsFor(null), defaultToolkitsFor("roommates"), "no answer yet: everything on");
});

test("settings are normalized, and bad ones explained", () => {
  assert.deepEqual(validateSettings({ currency: " eur ", timezone: "Europe/Berlin", name: "  Lake   trip " }), { currency: "EUR", timezone: "Europe/Berlin", name: "Lake trip" });
  assert.throws(() => validateSettings({ currency: "XQZ" }), /isn't a currency code/);
  assert.equal(validateSettings({ timezone: "Chicago" }).timezone, "America/Chicago", "what people say maps to IANA");
  assert.equal(validateSettings({ timezone: "CST" }).timezone, "America/Chicago");
  assert.equal(validateSettings({ timezone: "india" }).timezone, "Asia/Kolkata");
  assert.throws(() => validateSettings({ timezone: "my place" }), /don't know the time zone "my place"\. Which city are you in\?/);
  assert.throws(() => validateSettings({ name: "  " }), /needs a name/);
  assert.throws(() => validateSettings({ purpose: "party" as never }), /Purpose must be one of/);
});
