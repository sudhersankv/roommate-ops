// "What can you do?" in one line, like the launch video. Run: npx tsx --test src/toolkits/core/what-i-can-do.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MANIFESTS } from "../manifests";
import { whatICanDo } from "./settings";

test("the learned Tricks by their spoken names, in order, then 'Just talk to me.'", () => {
  assert.equal(whatICanDo(MANIFESTS), "Money, groceries, chores, the leasing office. Just talk to me.");
  assert.equal(whatICanDo(MANIFESTS.filter((m) => m.id !== "lease-inbox")), "Money, groceries, chores. Just talk to me.");
  assert.equal(whatICanDo([{ name: "Trips" }]), "Trips. Just talk to me.", "no spoken name: the name, lowercased");
});

test("nothing learned yet: reminders, and an admin can teach more", () => {
  assert.match(whatICanDo([]), /^Reminders for now\. An admin can teach me more\./);
});
