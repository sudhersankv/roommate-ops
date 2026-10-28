// Pure report formatting + weekly-window logic, no DB. Run: npx tsx --test src/services/report.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatGroupReport,
  shouldPostWeeklyReport,
  shouldPostUpkeepNudge,
  localParts,
  shortDate,
  type GroupReport,
} from "./report";

const empty: GroupReport = { balances: [], settlePlan: [], chores: [], shame: [], upcoming: [], upkeep: [] };

type Chore = GroupReport["chores"][number];
const chore = (c: Omit<Chore, "lastDoneById" | "dueAt" | "whoseTurnId" | "streak">): Chore => ({ lastDoneById: null, dueAt: null, whoseTurnId: null, streak: 0, ...c });

const full: GroupReport = {
  balances: [
    { memberId: "a", name: "Sudhersan", cents: 1250 },
    { memberId: "b", name: "Ryan", cents: -1250 },
  ],
  settlePlan: [{ fromId: "b", fromName: "Ryan", toId: "a", toName: "Sudhersan", cents: 1250 }],
  chores: [
    chore({ choreId: "c1", name: "Dishes", everyDays: 2, lastDoneBy: "Sudhersan", lastDoneAt: new Date("2026-09-20T00:00:00Z"), overdue: true, whoseTurn: "Ryan" }),
    chore({ choreId: "c2", name: "Take out trash", everyDays: 7, lastDoneBy: null, lastDoneAt: null, overdue: true, whoseTurn: null }),
    chore({ choreId: "c3", name: "Vacuum", everyDays: 7, lastDoneBy: "Alex", lastDoneAt: new Date("2026-10-03T00:00:00Z"), overdue: false, whoseTurn: "Ryan" }),
  ],
  shame: [
    { memberId: "b", name: "Ryan", daysSinceLastChore: null, choresThisWeek: 0 },
    { memberId: "c", name: "Alex", daysSinceLastChore: 1, choresThisWeek: 1 },
    { memberId: "a", name: "Sudhersan", daysSinceLastChore: 0, choresThisWeek: 3 },
  ],
  upcoming: [
    { id: "r1", groupId: "h", text: "Pay internet", dueAt: new Date("2026-10-10T14:00:00Z"), memberId: null, memberName: null, recurring: "monthly" },
    { id: "r2", groupId: "h", text: "Buy filters", dueAt: new Date("2026-10-12T20:00:00Z"), memberId: "b", memberName: "Ryan", recurring: null },
    { id: "r3", groupId: "h", text: "Call landlord", dueAt: new Date("2026-10-14T20:00:00Z"), memberId: null, memberName: null, recurring: null },
    { id: "r4", groupId: "h", text: "Fourth thing", dueAt: new Date("2026-10-20T20:00:00Z"), memberId: null, memberName: null, recurring: null },
  ],
  upkeep: [
    { id: "m1", item: "Replace HVAC filter", everyDays: 90, lastDone: null, nextDue: null, status: "overdue" },
    { id: "m2", item: "Test smoke alarms", everyDays: 180, lastDone: new Date("2026-01-01"), nextDue: new Date("2026-06-30"), status: "overdue" },
    { id: "m3", item: "Clean dryer vent", everyDays: 365, lastDone: new Date("2025-10-08"), nextDue: new Date("2026-10-08"), status: "due-soon" },
  ],
};

test("formatGroupReport: empty house -> All square, quiet lines, no watchlist/upkeep", () => {
  const out = formatGroupReport(empty);
  assert.equal(
    out,
    [
      "📣 Group report",
      "💸 All square. Love that for us.",
      "🧹 No chores on the chart yet.",
      "⏰ Nothing scheduled. Enjoy the quiet.",
    ].join("\n"),
  );
  assert.ok(!out.includes("Behind on chores"));
  assert.ok(!out.includes("🔧"));
  assert.ok(!out.includes("🏠"));
});

test("formatGroupReport: full house renders every section, deterministically, within 12 lines", () => {
  const out = formatGroupReport(full, { groupName: "Apt 4B", tz: "America/Chicago" });
  const lines = out.split("\n");
  assert.equal(lines[0], "📣 Group report — Apt 4B");
  assert.ok(lines.includes("💸 Ryan pays Sudhersan $12.50"));
  assert.ok(lines.includes("🧹 Overdue: Dishes (Ryan's turn), Take out trash"));
  assert.ok(lines.includes("🚨 Behind on chores: Ryan hasn't logged a chore yet. Bold strategy 😅"));
  assert.ok(lines.includes("⏰ Sat Oct 10: Pay internet"));
  assert.ok(lines.includes("⏰ Mon Oct 12: Buy filters (Ryan)"));
  assert.ok(lines.includes("⏰ Wed Oct 14: Call landlord"));
  assert.ok(!out.includes("Fourth thing"), "only the next 3 reminders");
  assert.ok(lines.includes("🔧 Overdue upkeep: Replace HVAC filter, Test smoke alarms"));
  assert.ok(!out.includes("dryer vent"), "due-soon upkeep is not nagged about");
  assert.ok(lines.length <= 12, `too long: ${lines.length} lines`);
  assert.ok(!out.includes("🏠"), "no house emoji");
  assert.equal(out, formatGroupReport(full, { groupName: "Apt 4B", tz: "America/Chicago" }), "deterministic");
});

test("formatGroupReport: chores on track and everyone pulling weight -> no Hall of Shame", () => {
  const r: GroupReport = {
    ...empty,
    chores: [{ ...full.chores[2] }],
    shame: [{ memberId: "a", name: "Sudhersan", daysSinceLastChore: 2, choresThisWeek: 2 }],
  };
  const out = formatGroupReport(r);
  assert.ok(out.includes("🧹 Chores on track."));
  assert.ok(!out.includes("Behind on chores"));
});

test("formatGroupReport: settle plan is capped at 3 lines with a count", () => {
  const t = (i: number) => ({ fromId: `f${i}`, fromName: `P${i}`, toId: "a", toName: "Sudhersan", cents: 100 * i });
  const out = formatGroupReport({ ...empty, settlePlan: [t(1), t(2), t(3), t(4), t(5)] });
  assert.equal(out.split("\n").filter((l) => l.startsWith("💸")).length, 4);
  assert.ok(out.includes("…and 2 more"));
});

test("shortDate / localParts honour the timezone", () => {
  // 2026-01-12T00:30Z is still Sunday evening in Chicago (CST, UTC-6).
  const d = new Date("2026-01-12T00:30:00Z");
  assert.equal(shortDate(d, "America/Chicago"), "Sun Jan 11");
  assert.deepEqual(localParts(d, "America/Chicago"), { weekday: "Sun", hour: 18, day: "2026-01-11" });
  assert.equal(localParts(d, "UTC").weekday, "Mon");
});

test("shouldPostWeeklyReport: Sunday 18:xx Chicago, CDT (summer)", () => {
  const sun1830 = new Date("2026-07-12T23:30:00Z"); // 18:30 CDT
  assert.equal(shouldPostWeeklyReport(sun1830, null), true);
  assert.equal(shouldPostWeeklyReport(new Date("2026-07-12T22:59:00Z"), null), false); // 17:59
  assert.equal(shouldPostWeeklyReport(new Date("2026-07-13T00:00:00Z"), null), false); // 19:00 (still Sun locally)
  assert.equal(shouldPostWeeklyReport(new Date("2026-07-11T23:30:00Z"), null), false); // Saturday
});

test("shouldPostWeeklyReport: Sunday 18:xx Chicago, CST (winter) crosses UTC midnight", () => {
  const sun1830 = new Date("2026-01-12T00:30:00Z"); // Sun 18:30 CST, Monday in UTC
  assert.equal(shouldPostWeeklyReport(sun1830, null), true);
  assert.equal(shouldPostWeeklyReport(new Date("2026-01-11T23:30:00Z"), null), false); // 17:30 CST
  assert.equal(shouldPostWeeklyReport(sun1830, null, "UTC"), false);
});

test("shouldPostWeeklyReport: DST transition Sundays still hit the 18:00 window", () => {
  assert.equal(shouldPostWeeklyReport(new Date("2026-03-08T23:30:00Z"), null), true); // spring forward day, 18:30 CDT
  assert.equal(shouldPostWeeklyReport(new Date("2026-11-02T00:30:00Z"), null), true); // fall back day, 18:30 CST
  assert.equal(shouldPostWeeklyReport(new Date("2026-11-01T23:30:00Z"), null), false); // 17:30 CST that day
});

test("shouldPostWeeklyReport: 20-hour debounce", () => {
  const now = new Date("2026-07-12T23:30:00Z");
  const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
  assert.equal(shouldPostWeeklyReport(now, ago(0.2)), false);
  assert.equal(shouldPostWeeklyReport(now, ago(19)), false);
  assert.equal(shouldPostWeeklyReport(now, ago(21)), true);
  assert.equal(shouldPostWeeklyReport(now, ago(24 * 7)), true);
});

test("shouldPostUpkeepNudge: 09:xx local, once per local day", () => {
  const nine = new Date("2026-07-12T14:15:00Z"); // 09:15 CDT
  assert.equal(shouldPostUpkeepNudge(nine, null), true);
  assert.equal(shouldPostUpkeepNudge(nine, "2026-07-12"), false);
  assert.equal(shouldPostUpkeepNudge(nine, "2026-07-11"), true);
  assert.equal(shouldPostUpkeepNudge(new Date("2026-07-12T15:15:00Z"), null), false); // 10:15
});

test("formatGroupReport: two slackers are both named on the watchlist, jab aimed at the worst", () => {
  const r: GroupReport = {
    ...empty,
    chores: [full.chores[0]],
    shame: [
      { memberId: "b", name: "Ryan", daysSinceLastChore: 9, choresThisWeek: 0 },
      { memberId: "c", name: "Alex", daysSinceLastChore: 8, choresThisWeek: 0 },
      { memberId: "a", name: "Sudhersan", daysSinceLastChore: 0, choresThisWeek: 3 },
    ],
  };
  assert.ok(formatGroupReport(r).includes("🚨 Behind on chores: Ryan and Alex. Ryan 9 days since a chore 👀"));
});
