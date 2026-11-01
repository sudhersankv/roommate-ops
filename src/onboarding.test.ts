// Onboarding copy and defaults, no DB. Run: npx tsx --test src/onboarding.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalPrompt, introMessage, rosterStillOpen, setupDmText, setupLine } from "./onboarding";
import { MANIFESTS } from "./toolkits/manifests";
import { defaultToolkitsFor, validateSettings } from "./services/groups";

const BANNED = /toolkit|capabilit|module|plugin|enable|feature|\bpet\b|slang|how you (all )?talk|adapt|\bvibe\b|\bAI\b|\bbot\b|assistant|brain|smart/i;

test("intro (#68): one line, one question; no admin line, no list of Tricks, no vibe offer, no link", () => {
  const text = introMessage();
  assert.equal(text, "Hey all! I'm Roomie. What's this chat for?");
  assert.ok(!text.includes("\n"), "one line");
  assert.ok(!/chill|hype|deadpan|gremlin|butler/.test(text), "one voice (ADR 0020): setup offers no vibe");
  assert.ok(!/Money|Groceries|House|Chores|Upkeep|Tricks?\b|Cart/.test(text), "no list of Tricks");
  assert.ok(!BANNED.test(text));
  assert.ok(!/https?:\/\//.test(text), "no links at join time (ADR 0001)");
});

test("the Admin's setup DM (ADR 0014): who they are to the group, then the same question, answerable right there", () => {
  const text = setupDmText("Maya Lee", "Apt 4B");
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "Hi Maya! You added me to Apt 4B, so you're its admin. Your own dashboard link is below (just for you, it works once).");
  assert.equal(lines[1], "What's this chat for? Answer here or in the group.");
  assert.doesNotMatch(text, /currency|city/i, "no currency or city unless needed (#68)");
  assert.ok(!/https?:\/\//.test(text), "the Claim link rides as a button, never in the text");
  assert.ok(!BANNED.test(text));
  assert.match(setupDmText("+15551110001", "Apt 4B"), /^Hi! You added me/, "never reads a number out as a name");
});

test("the setup line (#68): one plain line that fits the purpose; never names a Trick, never 'Learned X', never a tip", () => {
  const all = ["splitting", "groceries", "house"];
  const household = ["Got it. I've got the house stuff from here.", "Got it. I'll keep track of the house stuff from here.", "Sorted. I've got the house stuff from here."];
  const seeds = ["a", "b", "c", "d", "e", "f", "g", "h"];
  for (const seed of seeds) assert.ok(household.includes(setupLine("roommates", all, { seed })), "roommates: the house stuff");
  assert.ok(new Set(seeds.map((seed) => setupLine("roommates", all, { seed }))).size > 1, "varied across Groups");
  assert.equal(setupLine("roommates", all, { seed: "g1" }), setupLine("roommates", all, { seed: "g1" }), "stable for one Group");
  for (const seed of seeds) assert.doesNotMatch(setupLine("trip", ["splitting", "groceries"], { seed }), /house/i, "a trip never hears house");
  assert.equal(setupLine(null, all, { defaulted: true }), "Got it. You didn't say what this chat is for, so I set it up like a shared apartment.");
  assert.match(setupLine("roommates", []), /^Got it\. Just reminders for now/);
  const names = new RegExp([...MANIFESTS.map((m) => m.name), "Learned", "roomie, learn", "any time", "want me to"].join("|"));
  for (const p of ["roommates", "trip", "friends", "family", "work", "other", null] as const) {
    for (const seed of seeds) {
      const line = setupLine(p, defaultToolkitsFor(p), { seed, defaulted: p === null });
      assert.ok(!line.includes("\n"), "one line");
      assert.ok(!BANNED.test(line), line);
      assert.doesNotMatch(line, names, line);
    }
  }
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
  assert.deepEqual(defaultToolkitsFor("roommates"), ["splitting", "groceries", "house"]);
  assert.deepEqual(defaultToolkitsFor("trip"), ["splitting", "groceries"]);
  assert.deepEqual(defaultToolkitsFor("friends"), ["splitting"]);
  assert.deepEqual(defaultToolkitsFor("family"), ["splitting", "groceries", "house"]);
  assert.deepEqual(defaultToolkitsFor("work"), ["splitting"]);
  assert.deepEqual(defaultToolkitsFor(null), defaultToolkitsFor("roommates"), "no answer yet: every defaultOn Toolkit");
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
