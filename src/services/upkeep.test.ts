// Pure upkeep helpers: schedule in the Group's zone + fuzzy name picker. No DB. Run: npx tsx --test src/services/upkeep.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareByDue, DEFAULT_ITEMS, isQuickUpkeep, pickByName, upkeepLabel, upkeepSchedule, upkeepTurn } from "./upkeep";

const DAY = 24 * 60 * 60 * 1000;
const CHI = "America/Chicago";
const now = new Date("2026-10-04T17:00:00Z"); // noon in Chicago
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

test("never done -> due today (due soon, not overdue)", () => {
  assert.deepEqual(upkeepSchedule(null, 90, CHI, now), { dueDay: "2026-10-04", dueIn: 0, status: "due-soon" });
});

test("due in 3 days -> due-soon; in 30 -> ok; past -> overdue", () => {
  assert.equal(upkeepSchedule(daysAgo(87), 90, CHI, now).status, "due-soon");
  assert.equal(upkeepSchedule(daysAgo(87), 90, CHI, now).dueIn, 3);
  assert.equal(upkeepSchedule(daysAgo(60), 90, CHI, now).status, "ok");
  assert.equal(upkeepSchedule(daysAgo(100), 90, CHI, now).status, "overdue");
});

test("the 7-day edge and the Group's day boundary", () => {
  assert.equal(upkeepSchedule(daysAgo(83), 90, CHI, now).dueIn, 7);
  assert.equal(upkeepSchedule(daysAgo(83), 90, CHI, now).status, "due-soon");
  assert.equal(upkeepSchedule(daysAgo(82), 90, CHI, now).status, "ok");
  // Done at 01:00 UTC Oct 1 = Sep 30 evening in Chicago, so a 4-day item is due Oct 4 in Chicago but Oct 5 in UTC.
  const done = new Date("2026-10-01T01:00:00Z");
  assert.equal(upkeepSchedule(done, 4, CHI, now).dueDay, "2026-10-04");
  assert.equal(upkeepSchedule(done, 4, "UTC", now).dueDay, "2026-10-05");
});

test("sort: soonest first, then name", () => {
  const list = [
    { item: "B", dueIn: 5 },
    { item: "A", dueIn: 0 },
    { item: "C", dueIn: -1 },
    { item: "D", dueIn: 0 },
  ].sort(compareByDue);
  assert.deepEqual(list.map((m) => m.item), ["C", "A", "D", "B"]);
});

test("pickByName: exact > startsWith > includes (either direction) > a shared word", () => {
  const items = DEFAULT_ITEMS.map((d) => ({ item: d.item }));
  assert.equal(pickByName(items, "  test SMOKE alarms ")?.item, "Test smoke alarms");
  assert.equal(pickByName(items, "clean")?.item, "Clean dryer vent");
  assert.equal(pickByName(items, "hvac")?.item, "Replace HVAC / air filter");
  assert.equal(pickByName(items, "coffee")?.item, "Descale coffee maker");
  assert.equal(pickByName(items, "the clean dryer vent thing")?.item, "Clean dryer vent");
  assert.equal(pickByName(items, "changed the air filter")?.item, "Replace HVAC / air filter");
  assert.equal(pickByName(items, "new batteries in the smoke alarm")?.item, "Test smoke alarms");
  assert.equal(pickByName(items, "gutters"), undefined);
  assert.equal(pickByName(items, "   "), undefined);
});

test("pickByName prefers exact over a startsWith on an earlier item; ambiguous words pick nothing", () => {
  assert.equal(pickByName([{ item: "Filter check" }, { item: "Filter" }], "filter")?.item, "Filter");
  assert.equal(pickByName([{ item: "Water filter" }, { item: "Air filter" }], "changed the filter"), undefined);
});

// ---------- whose turn (#73): the chores' turnFor over the whole group ----------

const people = [
  { id: "m", name: "Maya" },
  { id: "d", name: "Dev" },
  { id: "s", name: "Sam" },
];
const entry = (memberId: string, ago: number, skipped = false) => ({ memberId, at: daysAgo(ago), skipped });

test("upkeepTurn: never done -> the first by name; then whoever did it least recently", () => {
  assert.equal(upkeepTurn(people, [])?.name, "Dev");
  // Maya did it 90 days ago: Dev and Sam never have, Dev first by name.
  assert.equal(upkeepTurn(people, [entry("m", 90)])?.name, "Dev");
  // Dev did it today, Maya 90 days ago: Sam (never) is up.
  assert.equal(upkeepTurn(people, [entry("d", 0), entry("m", 90)])?.name, "Sam");
  // Everyone has: the least recent (Maya) is up again.
  assert.equal(upkeepTurn(people, [entry("s", 0), entry("d", 90), entry("m", 180)])?.name, "Maya");
});

test("upkeepTurn: marking it done moves the turn on", () => {
  const history = [entry("m", 90)];
  const up = upkeepTurn(people, history)!;
  assert.equal(up.name, "Dev");
  assert.equal(upkeepTurn(people, [{ memberId: up.id, at: now, skipped: false }, ...history])?.name, "Sam");
});

test("upkeepTurn: a pass moves the turn on like a done", () => {
  assert.equal(upkeepTurn(people, [{ memberId: "d", at: now, skipped: true }, entry("m", 90)])?.name, "Sam");
});

test("upkeepTurn: people who left drop out; nobody active -> null", () => {
  assert.equal(upkeepTurn(people.slice(0, 2), [entry("s", 400), entry("d", 0), entry("m", 90)])?.name, "Maya");
  assert.equal(upkeepTurn([], [entry("m", 1)]), null);
});

test("upkeepLabel: the item as people say it", () => {
  assert.equal(upkeepLabel("Replace HVAC / air filter"), "Air filter");
  assert.equal(upkeepLabel("Test smoke alarms"), "Smoke alarm test");
  assert.equal(upkeepLabel("Clean dryer vent"), "Dryer vent");
  assert.equal(upkeepLabel("Descale coffee maker"), "Coffee maker");
  assert.equal(upkeepLabel("Check fire extinguisher"), "Fire extinguisher check");
  assert.equal(upkeepLabel("Clean the gutters"), "Gutters");
  assert.equal(upkeepLabel("Water filter"), "Water filter");
  assert.equal(isQuickUpkeep("Test smoke alarms"), true);
  assert.equal(isQuickUpkeep("Replace HVAC / air filter"), false);
});
