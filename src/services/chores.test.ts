// Pure chore logic, no DB: fuzzy picking, Rotation turns, passes, due days in the Group's zone, streaks, the chart.
// Run: npx tsx --test src/services/chores.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { chartLine, choreSchedule, daysSince, effectiveOrder, pickChore, rankShame, sortStatus, streaksFor, turnFor, whoseTurn, type TurnEntry } from "./chores";

const chart = [{ name: "Clean bathroom" }, { name: "Take out trash" }, { name: "Dishes" }, { name: "Dish rack" }];
const CHI = "America/Chicago";

test("pickChore: exact match wins, case/whitespace-insensitive", () => {
  assert.equal(pickChore("  dishes ", chart)?.name, "Dishes");
  assert.equal(pickChore("TAKE OUT TRASH", chart)?.name, "Take out trash");
});

test("pickChore: startsWith beats includes; shortest name wins within a tier", () => {
  assert.equal(pickChore("dish", chart)?.name, "Dishes");
  assert.equal(pickChore("clean", chart)?.name, "Clean bathroom");
});

test("pickChore: includes works in either direction, then a shared word", () => {
  assert.equal(pickChore("trash", chart)?.name, "Take out trash");
  assert.equal(pickChore("I did the dishes tonight", chart)?.name, "Dishes");
  assert.equal(pickChore("bathroom", chart)?.name, "Clean bathroom");
  assert.equal(pickChore("took out the trash", chart)?.name, "Take out trash");
  assert.equal(pickChore("cleaned the bathroom", chart)?.name, "Clean bathroom");
});

test("pickChore: no match and empty query return undefined", () => {
  assert.equal(pickChore("vacuum", chart), undefined);
  assert.equal(pickChore("   ", chart), undefined);
});

const people = [
  { id: "m", name: "Maya" },
  { id: "d", name: "Dev" },
  { id: "s", name: "Sam" },
];
const at = (daysAgo: number) => new Date(Date.UTC(2026, 9, 28, 17) - daysAgo * 86_400_000);
const done = (memberId: string, daysAgo: number): TurnEntry => ({ memberId, at: at(daysAgo), skipped: false });
const skip = (memberId: string, daysAgo: number): TurnEntry => ({ memberId, at: at(daysAgo), skipped: true });

test("whoseTurn (no Rotation): never-done members first, then oldest, ties by name", () => {
  const p = [
    { id: "a", name: "Sudhersan" },
    { id: "b", name: "Ryan" },
    { id: "c", name: "Alex" },
  ];
  assert.equal(whoseTurn(p, new Map([["a", at(1)], ["c", at(5)]])), "Ryan");
  assert.equal(whoseTurn(p, new Map([["a", at(1)], ["b", at(3)], ["c", at(5)]])), "Alex");
  assert.equal(whoseTurn(p, new Map()), "Alex");
  assert.equal(whoseTurn([], new Map()), null);
});

test("turnFor with a Rotation: the one after whoever went last; first in line when nobody has", () => {
  const rotation = ["s", "d", "m"];
  assert.equal(turnFor(rotation, people, [])?.name, "Sam");
  assert.equal(turnFor(rotation, people, [done("s", 2)])?.name, "Dev");
  assert.equal(turnFor(rotation, people, [done("d", 1), done("s", 2)])?.name, "Maya");
  assert.equal(turnFor(rotation, people, [done("m", 0), done("d", 1)])?.name, "Sam", "wraps around");
  // Out of turn: Maya did it while Dev was up -> next after Maya
  assert.equal(turnFor(rotation, people, [done("m", 0), done("s", 2)])?.name, "Sam");
});

test("turnFor: a pass moves the Rotation on; without a Rotation it sends the passer to the back", () => {
  assert.equal(turnFor(["s", "d", "m"], people, [skip("d", 0), done("s", 2)])?.name, "Maya");
  assert.equal(turnFor(null, people, [skip("d", 0), done("m", 2), done("s", 3)])?.name, "Sam");
});

test("effectiveOrder: inactive ids drop out; an empty Rotation means everyone", () => {
  assert.deepEqual(effectiveOrder(["x", "d", "d", "m"], people).order.map((p) => p.name), ["Dev", "Maya"]);
  assert.equal(effectiveOrder(["gone"], people).rotating, false);
  assert.equal(effectiveOrder(null, people).order.length, 3);
});

test("choreSchedule: local days in the Group's zone; never done = due today", () => {
  const now = new Date("2026-10-28T16:00:00Z"); // Wed 11:00 Chicago
  assert.deepEqual(choreSchedule(null, 7, CHI, now), { dueDay: "2026-10-28", dueIn: 0, state: "due" });
  // Dishes every day, done yesterday evening Chicago (which is already "today" in UTC)
  assert.deepEqual(choreSchedule(new Date("2026-10-28T02:00:00Z"), 1, CHI, now), { dueDay: "2026-10-28", dueIn: 0, state: "due" });
  assert.equal(choreSchedule(new Date("2026-10-28T02:00:00Z"), 1, "UTC", now).state, "ok");
  assert.equal(choreSchedule(new Date("2026-10-20T16:00:00Z"), 7, CHI, now).state, "overdue");
  assert.equal(choreSchedule(new Date("2026-10-26T16:00:00Z"), 3, CHI, now).dueIn, 1);
});

test("streaksFor: on-time turns in a row per Member; a pass or a late done ends it", () => {
  // Dishes every 2 days: Dev on time, Maya on time, Dev on time -> Dev 2, Maya 1
  const e = [done("d", 0), done("m", 2), done("d", 4)];
  assert.deepEqual(Object.fromEntries(streaksFor(e, 2, CHI)), { d: 2, m: 1 });
  // Dev passed last time -> 0 until the next done
  assert.equal(streaksFor([skip("d", 0), done("d", 2), done("d", 4)], 2, CHI).get("d"), 0);
  // Done 5 days after the last one with a 2-day cadence: late, so it doesn't count and ends the run
  assert.equal(streaksFor([done("s", 0), done("s", 5)], 2, CHI).get("s"), 0);
  assert.equal(streaksFor([done("s", 0), done("s", 2), done("s", 7)], 2, CHI).get("s"), 1);
  assert.equal(streaksFor([done("m", 0), done("m", 0)], 1, CHI).get("m"), 2, "two in a row on the same day");
});

test("rankShame: fewest this week first, then longest since (never = worst), then name", () => {
  const rows = [
    { memberId: "1", name: "Alex", daysSinceLastChore: 2, choresThisWeek: 3 },
    { memberId: "2", name: "Ryan", daysSinceLastChore: null, choresThisWeek: 0 },
    { memberId: "3", name: "Sudhersan", daysSinceLastChore: 10, choresThisWeek: 0 },
    { memberId: "4", name: "Dev", daysSinceLastChore: 10, choresThisWeek: 0 },
    { memberId: "5", name: "Kate", daysSinceLastChore: 1, choresThisWeek: 1 },
  ];
  assert.deepEqual(rankShame(rows).map((r) => r.name), ["Ryan", "Dev", "Sudhersan", "Kate", "Alex"]);
  assert.equal(chartLine(rankShame(rows).slice(0, 2)), "The chart this week: Ryan 0 (none yet), Dev 0 (last one 10d ago).");
});

test("sortStatus: latest first, then name", () => {
  const out = sortStatus([
    { name: "Dishes", dueIn: 1 },
    { name: "Trash", dueIn: -2 },
    { name: "Bathroom", dueIn: -2 },
    { name: "Aquarium", dueIn: 0 },
  ]);
  assert.deepEqual(out.map((r) => r.name), ["Bathroom", "Trash", "Aquarium", "Dishes"]);
});

test("daysSince", () => {
  const now = new Date("2026-10-04T12:00:00Z");
  assert.equal(daysSince(new Date("2026-10-01T06:00:00Z"), now), 3);
  assert.equal(daysSince(new Date("2026-10-04T11:00:00Z"), now), 0);
});
