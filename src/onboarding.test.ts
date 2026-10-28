// Onboarding copy and defaults, no DB. Run: npx tsx --test src/onboarding.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalPrompt, introMessage } from "./onboarding";
import { defaultToolkitsFor, validateSettings } from "./services/groups";

test("intro: names the Admin and asks purpose, currency and time zone in one message", () => {
  const text = introMessage("Maya");
  assert.match(text, /Maya added me, so Maya's my admin/);
  for (const q of [/what's this group for/, /currency/, /time zone/]) assert.match(text, q);
  assert.match(text, /USD, Chicago/, "says what the defaults are");
  assert.ok(text.split("\n").length <= 3, "one short message");
  assert.ok(!/https?:\/\//.test(text), "no links at join time (ADR 0001)");
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
  assert.deepEqual(defaultToolkitsFor("family"), ["splitting", "groceries", "chores"]);
  assert.deepEqual(defaultToolkitsFor("work"), ["splitting"]);
  assert.deepEqual(defaultToolkitsFor(null), defaultToolkitsFor("roommates"), "no answer yet: everything on");
});

test("settings are normalized, and bad ones explained", () => {
  assert.deepEqual(validateSettings({ currency: " eur ", timezone: "Europe/Berlin", name: "  Lake   trip " }), { currency: "EUR", timezone: "Europe/Berlin", name: "Lake trip" });
  assert.throws(() => validateSettings({ currency: "XQZ" }), /isn't a currency code/);
  assert.throws(() => validateSettings({ timezone: "Chicago" }), /isn't a time zone/);
  assert.throws(() => validateSettings({ name: "  " }), /needs a name/);
  assert.throws(() => validateSettings({ purpose: "party" as never }), /Purpose must be one of/);
});
