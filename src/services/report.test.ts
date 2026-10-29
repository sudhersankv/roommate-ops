// Pure report formatting, the chores nudge line and the schedule windows, no DB.
// Run: npx tsx --test src/services/report.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { choresNudgeText, dueWord, formatGroupReport, type GroupReport } from "./report";
import { choresNudgeWindow, readSchedule, validateSchedule, weeklyReportWindow } from "./schedule";

type Chore = GroupReport["chores"][number];
const chore = (c: Partial<Chore> & Pick<Chore, "name">): Chore => ({
  choreId: c.name,
  everyDays: 7,
  rotation: null,
  order: [],
  lastDoneBy: null,
  lastDoneById: null,
  lastDoneAt: null,
  lastDoneDay: null,
  dueDay: "2026-11-01",
  dueIn: 1,
  state: "ok",
  overdue: false,
  whoseTurn: null,
  whoseTurnId: null,
  streak: 0,
  streaks: {},
  ...c,
});

const NOW = new Date("2026-11-02T00:30:00Z"); // Sun Nov 1, 18:30 CST
const empty: GroupReport = {
  groupName: null,
  tz: "America/Chicago",
  now: NOW,
  toolkits: ["splitting", "groceries", "chores", "upkeep"],
  settlePlan: [],
  chores: [],
  shame: [],
  streaks: [],
  upcoming: [],
  upkeep: [],
  cartCount: 0,
};

const full: GroupReport = {
  ...empty,
  groupName: "Apt 4B",
  settlePlan: [
    { fromId: "d", fromName: "Dev", toId: "m", toName: "Maya", cents: 3000 },
    { fromId: "s", fromName: "Sam", toId: "m", toName: "Maya", cents: 1250 },
  ],
  chores: [
    chore({ name: "Take out the trash", dueIn: -2, dueDay: "2026-10-30", state: "overdue", overdue: true, whoseTurn: "Maya" }),
    chore({ name: "Dishes", dueIn: 0, dueDay: "2026-11-01", state: "due", whoseTurn: "Dev" }),
    chore({ name: "Clean the bathroom", dueIn: 4, dueDay: "2026-11-05", whoseTurn: "Sam" }),
  ],
  shame: [
    { memberId: "s", name: "Sam", daysSinceLastChore: 9, choresThisWeek: 0 },
    { memberId: "d", name: "Dev", daysSinceLastChore: 1, choresThisWeek: 2 },
    { memberId: "m", name: "Maya", daysSinceLastChore: 0, choresThisWeek: 3 },
  ],
  streaks: [{ name: "Dev", streak: 4, chore: "Dishes" }],
  upcoming: [
    { id: "r1", groupId: "g", text: "Rent is due", dueAt: new Date("2026-11-02T15:00:00Z"), memberId: null, memberName: null, recurring: "monthly", createdBy: null, createdByName: null },
  ],
  upkeep: [
    { id: "u1", item: "Replace HVAC / air filter", everyDays: 90, lastDone: null, dueDay: "2026-11-05", dueIn: 4, status: "due-soon" },
    { id: "u2", item: "Test smoke alarms", everyDays: 180, lastDone: null, dueDay: "2026-10-30", dueIn: -2, status: "overdue" },
  ],
  cartCount: 7,
};

test("formatGroupReport: an empty Group is short and friendly", () => {
  assert.equal(formatGroupReport(empty), ["📋 Group report", "💸 All square. Love that for us.", "🛒 The Cart's empty."].join("\n"));
});

test("formatGroupReport: every section, deterministic, at most 12 lines", () => {
  const out = formatGroupReport(full);
  const lines = out.split("\n");
  assert.equal(lines[0], "📋 Group report · Apt 4B");
  assert.ok(lines.includes("💸 Dev pays Maya $30.00 and Sam pays Maya $12.50."));
  assert.ok(lines.includes("🧹 Chores this week: Maya 3, Dev 2, Sam 0."));
  assert.ok(lines.includes("🔥 Dev's on a 4-turn streak (dishes)."));
  assert.ok(lines.includes("⏳ Up now: Take out the trash (Maya, 2 days late), Dishes (Dev, today)."));
  assert.ok(lines.includes("📉 The chart says Sam has some catching up to do."));
  assert.ok(lines.includes("🔧 Upkeep due soon: Replace HVAC / air filter (Thu), Test smoke alarms (2 days late)."));
  assert.ok(lines.includes("🛒 7 things in the Cart."));
  assert.ok(lines.includes("⏰ Coming up: Rent is due (Mon 9 AM)."));
  assert.ok(lines.length <= 12, `too long: ${lines.length}`);
  assert.ok(!/^[-*•] /m.test(out), "no bullets");
  assert.equal(out, formatGroupReport(full));
});

test("formatGroupReport: casual Groups get sentences, no list look", () => {
  const out = formatGroupReport(full, { casual: true });
  const lines = out.split("\n");
  assert.equal(lines[0], "Group report · Apt 4B:");
  assert.ok(lines.length <= 3);
  assert.ok(!/^\p{Extended_Pictographic}/mu.test(out), "no emoji at line starts");
  assert.match(out, /Dev pays Maya \$30\.00/);
  assert.match(out, /7 things in the Cart/);
});

test("formatGroupReport: switched-off Toolkits are left out; nobody's slacking -> no chart line", () => {
  const out = formatGroupReport({ ...full, toolkits: ["chores"], shame: full.shame.map((s) => ({ ...s, choresThisWeek: 1 })) });
  assert.doesNotMatch(out, /pays|Cart|Upkeep/);
  assert.doesNotMatch(out, /catching up/);
  assert.match(out, /Chores this week/);
});

test("formatGroupReport: settle plan capped at 3 with a count", () => {
  const t = (i: number) => ({ fromId: `f${i}`, fromName: `P${i}`, toId: "m", toName: "Maya", cents: 100 * i });
  const out = formatGroupReport({ ...empty, settlePlan: [t(1), t(2), t(3), t(4), t(5)] });
  assert.match(out, /P1 pays Maya \$1\.00, P2 pays Maya \$2\.00 and P3 pays Maya \$3\.00, \+2 more\./);
});

test("dueWord", () => {
  assert.equal(dueWord(-1, "2026-10-31"), "1 day late");
  assert.equal(dueWord(0, "2026-11-01"), "today");
  assert.equal(dueWord(1, "2026-11-02"), "tomorrow");
  assert.equal(dueWord(3, "2026-11-04"), "Wed");
});

test("choresNudgeText: null when nothing's due, else one line with whose turn", () => {
  assert.equal(choresNudgeText([]), null);
  assert.equal(choresNudgeText(full.chores.filter((c) => c.state !== "ok")), "🧹 On the chart today: take out the trash (Maya, 2 days late) and dishes (Dev). Tell me when it's done.");
});

test("schedule windows: the nudge hour and the report's day and hour, in the Group's zone", () => {
  const chi = "America/Chicago";
  assert.deepEqual(choresNudgeWindow(new Date("2026-11-02T15:10:00Z"), chi, 9), { open: true, period: "2026-11-02" }); // 9:10 CST
  assert.equal(choresNudgeWindow(new Date("2026-11-02T14:10:00Z"), chi, 9).open, false); // 8:10
  assert.equal(choresNudgeWindow(new Date("2026-11-02T15:10:00Z"), chi, null).open, false);
  assert.equal(choresNudgeWindow(new Date("2026-11-02T03:40:00Z"), "Asia/Kolkata", 9).open, true); // 9:10 IST
  // Sunday 18:xx Chicago, on the fall-back Sunday (CST) and in summer (CDT)
  assert.deepEqual(weeklyReportWindow(NOW, chi, 0, 18), { open: true, period: "2026-11-01" });
  assert.equal(weeklyReportWindow(new Date("2026-07-12T23:30:00Z"), chi, 0, 18).open, true);
  assert.equal(weeklyReportWindow(new Date("2026-11-01T23:30:00Z"), chi, 0, 18).open, false); // 17:30
  assert.equal(weeklyReportWindow(NOW, "UTC", 0, 18).open, false); // Monday in UTC
  // Berlin, Sunday Oct 25 (its switch day) at 18:xx CET
  assert.equal(weeklyReportWindow(new Date("2026-10-25T17:15:00Z"), "Europe/Berlin", 0, 18).open, true);
});

test("readSchedule / validateSchedule", () => {
  assert.deepEqual(readSchedule(undefined, undefined), { nudgeHour: 9, reportWeekday: 0, reportHour: 18 });
  assert.deepEqual(readSchedule({ nudgeHour: null }, { report: { weekday: 5, hour: 20 } }), { nudgeHour: null, reportWeekday: 5, reportHour: 20 });
  assert.deepEqual(readSchedule({ nudgeHour: "x" }, { report: { weekday: 9 } }), { nudgeHour: 9, reportWeekday: 0, reportHour: 18 });
  assert.throws(() => validateSchedule({ nudgeHour: 24 }), /0 to 23/);
  assert.throws(() => validateSchedule({ reportWeekday: 7 }), /Sunday/);
  assert.deepEqual(validateSchedule({ nudgeHour: null, reportHour: 0 }), { nudgeHour: null, reportHour: 0 });
});
