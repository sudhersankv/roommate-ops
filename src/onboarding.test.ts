// Onboarding copy and defaults, no DB. Run: npx tsx --test src/onboarding.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { approvalPrompt, introMessage, learnedLine, rosterStillOpen, setupDmText } from "./onboarding";
import { defaultToolkitsFor, validateSettings } from "./services/groups";

const BANNED = /toolkit|capabilit|module|plugin|enable|feature|\bpet\b|slang|how you (all )?talk|adapt/i;

test("intro: who Roomie is, 'tell me what this group is for and I'll learn the right Tricks', the Admin; no feature list", () => {
  const text = introMessage("Maya");
  const lines = text.split("\n");
  assert.equal(lines.length, 3, "three short lines");
  assert.equal(lines[0], "Hey all, I'm Roomie 🦖 a small dino who lives in your group chat and learns Tricks.");
  assert.match(lines[1], /^Tell me what this group is for \(roommates, a trip, friends, family, work…\) and I'll learn the right Tricks\./);
  assert.match(lines[1], /chill \/ hype \/ deadpan \/ mom \/ gremlin \/ butler/, "the vibe is still part of setup");
  assert.equal(lines[2], "Maya added me, so Maya's my admin.");
  assert.ok(!/Splitting|Groceries|Chores|Upkeep|split costs|Cart/.test(text), "no feature list");
  assert.ok(!BANNED.test(text), "Tricks vocabulary; the pet and the adaptation stay implicit");
  assert.match(introMessage("Maya", { petName: "Dino" }), /^Hey all, I'm Dino 🦖/);
  for (const unknown of ["+16235550123", "Someone"]) {
    const t = introMessage(unknown);
    assert.match(t, /Whoever added me is my admin\./, "no name yet (WhatsApp before anyone has spoken)");
    assert.ok(!t.includes(unknown), "never reads a phone number out in the group");
  }
  assert.ok(!/https?:\/\//.test(text), "no links at join time (ADR 0001)");
});

test("intro on Telegram: the press-Start nudge rides on the admin line, still three lines and no URL", () => {
  const text = introMessage("Maya", { dmHandle: "roomie_house_bot" });
  assert.match(text, /Maya's my admin\. Tap @roomie_house_bot and press Start/);
  assert.equal(text.split("\n").length, 3);
  assert.ok(!/https?:\/\//.test(text));
});

test("intro on Telegram: Start is for the setup DM and the dashboard link", () => {
  assert.match(introMessage("Maya", { dmHandle: "roomie_house_bot" }), /press Start, so I can DM you the setup and your dashboard link\.$/);
});

test("the Admin's setup DM (ADR 0014): who they are to the group, then the setup question, answerable right there", () => {
  const text = setupDmText("Maya Lee", "Apt 4B");
  const lines = text.split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "Hi Maya 👋 You added me to Apt 4B, so you're its admin. Your own dashboard link is below (just for you, it works once).");
  assert.equal(lines[1], "Answer the setup here or in the group: what's the group for, currency, city, vibe.");
  assert.ok(!/https?:\/\//.test(text), "the Claim link rides as a button, never in the text");
  assert.ok(!BANNED.test(text));
  assert.match(setupDmText("+15551110001", "Apt 4B"), /^Hi 👋 You added me/, "never reads a number out as a name");
});

test("the setup line names the Tricks Roomie learned and what to say next", () => {
  assert.equal(learnedLine(defaultToolkitsFor("trip")), `Learned Splitting and Groceries. Say "roomie, learn chores" any time.`);
  assert.equal(learnedLine(defaultToolkitsFor("friends")), `Learned Splitting. Say "roomie, learn groceries" any time.`);
  assert.equal(learnedLine(defaultToolkitsFor("roommates")), `Learned Splitting, Groceries, Chores and Upkeep. Say "roomie, what can you do?" any time.`);
  assert.equal(
    learnedLine(defaultToolkitsFor(null), { defaulted: true }),
    `You didn't say what this group is for, so I kept the roommates set: learned Splitting, Groceries, Chores and Upkeep. Say "roomie, what can you do?" any time.`,
  );
  assert.equal(learnedLine([]), `No Tricks yet. Say "roomie, learn splitting" any time.`);
  for (const p of ["roommates", "trip", "friends", "family", "work", "other"] as const) {
    const line = learnedLine(defaultToolkitsFor(p));
    assert.equal(line.split("\n").length, 1);
    assert.ok(!BANNED.test(line));
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
  assert.deepEqual(defaultToolkitsFor("roommates"), ["splitting", "groceries", "chores", "upkeep"]);
  assert.deepEqual(defaultToolkitsFor("trip"), ["splitting", "groceries"]);
  assert.deepEqual(defaultToolkitsFor("friends"), ["splitting"]);
  assert.deepEqual(defaultToolkitsFor("family"), ["splitting", "groceries", "chores", "upkeep"]);
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
