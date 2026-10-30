// Activity lines Roomie reads ("since you last spoke"). Pure, no DB. Run: npx tsx --test src/services/activity.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { agoLabel, changeLine, sourceOf } from "./activity";

const now = new Date("2026-10-29T18:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);

test("sourceOf: the dashboard is 'ui' in a Ctx", () => {
  assert.equal(sourceOf({ source: "ui" }), "dashboard");
  assert.equal(sourceOf({ source: "chat" }), "chat");
  assert.equal(sourceOf({}), null);
});

test("agoLabel: minutes, hours, days", () => {
  assert.equal(agoLabel(ago(0), now), "just now");
  assert.equal(agoLabel(ago(2), now), "2 min ago");
  assert.equal(agoLabel(ago(90), now), "2 h ago");
  assert.equal(agoLabel(ago(60 * 24), now), "1 day ago");
  assert.equal(agoLabel(ago(60 * 24 * 3), now), "3 days ago");
});

test("changeLine: who, what, where and when", () => {
  assert.equal(changeLine({ actorName: "Ryan", summary: "took eggs off the Cart", source: "dashboard", createdAt: ago(2) }, now), "Ryan took eggs off the Cart (dashboard, 2 min ago)");
  assert.equal(changeLine({ actorName: "Maya", summary: "put milk on the Cart", source: "chat", createdAt: ago(10) }, now), "Maya put milk on the Cart (in the chat, 10 min ago)");
  assert.equal(changeLine({ actorName: "Roomie", summary: "added internet, $60.00 (repeats monthly)", source: null, createdAt: ago(0) }, now), "Roomie added internet, $60.00 (repeats monthly) (just now)");
});
