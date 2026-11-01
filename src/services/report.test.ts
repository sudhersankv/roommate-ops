// Pure report composition and formatting, the Toolkits' own report parts, the Bundle, and the schedule windows, no DB.
// Run: npx tsx --test src/services/report.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { composeBundle } from "./bundle";
import { cartReportParts } from "./cart";
import type { ChoreStatus } from "./chores";
import { choresNudgeText, choresReportParts, upkeepReportParts } from "./house";
import { settleReportParts } from "./money";
import { composeReport, coreReportParts, dueWord, formatGroupReport, type GroupReport, type ReportPart } from "./report";
import { bundleWindow, readSchedule, validateSchedule, weeklyReportWindow } from "./schedule";

const chore = (c: Partial<ChoreStatus> & Pick<ChoreStatus, "name">): ChoreStatus => ({
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
const CHI = "America/Chicago";

// Apt 4B: Maya, Dev and Sam, with every Trick on and something to say in each.
const settlePlan = [
  { fromId: "d", fromName: "Dev", toId: "m", toName: "Maya", cents: 3000 },
  { fromId: "s", fromName: "Sam", toId: "m", toName: "Maya", cents: 1250 },
];
const chores = [
  chore({ name: "Take out the trash", dueIn: -2, dueDay: "2026-10-30", state: "overdue", overdue: true, whoseTurn: "Maya" }),
  chore({ name: "Dishes", dueIn: 0, dueDay: "2026-11-01", state: "due", whoseTurn: "Dev" }),
  chore({ name: "Clean the bathroom", dueIn: 4, dueDay: "2026-11-05", whoseTurn: "Sam" }),
];
const shame = [
  { memberId: "s", name: "Sam", daysSinceLastChore: 9, choresThisWeek: 0 },
  { memberId: "d", name: "Dev", daysSinceLastChore: 1, choresThisWeek: 2 },
  { memberId: "m", name: "Maya", daysSinceLastChore: 0, choresThisWeek: 3 },
];
const streaks = [{ name: "Dev", streak: 4, chore: "Dishes" }];
const upkeep = [
  { item: "Replace HVAC / air filter", dueDay: "2026-11-05", dueIn: 4, whoseTurn: "Dev" },
  { item: "Test smoke alarms", dueDay: "2026-10-30", dueIn: -2, whoseTurn: "Sam" },
];
const upcoming = [{ text: "Rent is due", dueAt: new Date("2026-11-02T15:00:00Z") }];

/** What the services compose for Apt 4B: Money, House, Groceries in post order, then core. */
const fullParts = (): ReportPart[] =>
  composeReport([settleReportParts(settlePlan, { nudged: true }), [...choresReportParts(chores, shame, streaks), ...upkeepReportParts(upkeep)], cartReportParts(7)], coreReportParts(upcoming, CHI, NOW));

const report = (parts: ReportPart[], groupName: string | null = "Apt 4B"): GroupReport => ({ groupName, tz: CHI, now: NOW, parts });

test("formatGroupReport: an empty Group is short and friendly", () => {
  const parts = composeReport([settleReportParts([]), [...choresReportParts([], [], []), ...upkeepReportParts([])], cartReportParts(0)], coreReportParts([], CHI, NOW));
  assert.equal(formatGroupReport(report(parts, null)), ["📋 Group report", "💸 All square.", "🛒 The Cart's empty."].join("\n"));
});

test("formatGroupReport: every section in post order, deterministic, at most 12 lines", () => {
  const out = formatGroupReport(report(fullParts()));
  const lines = out.split("\n");
  assert.deepEqual(lines, [
    "📋 Group report · Apt 4B",
    "💸 2 open balances; I'm nudging people privately.",
    "🧹 Chores this week: Maya 3, Dev 2, Sam 0.",
    "🔥 Dev's on a 4-turn streak (dishes).",
    "⏳ Up now: Take out the trash (Maya, 2 days late), Dishes (Dev, today).",
    "📉 The chart says Sam has some catching up to do.",
    "🔧 Upkeep due soon: Air filter (Dev, Thu), Smoke alarm test (Sam, 2 days late).",
    "🛒 7 things in the Cart.",
    "⏰ Coming up: Rent is due (Mon 9 AM).",
  ]);
  assert.ok(lines.length <= 12, `too long: ${lines.length}`);
  assert.ok(!/^[-*•] /m.test(out), "no bullets");
  assert.equal(out, formatGroupReport(report(fullParts())));
});

test("formatGroupReport: casual Groups get sentences, no list look", () => {
  const out = formatGroupReport(report(fullParts()), { casual: true });
  const lines = out.split("\n");
  assert.equal(lines[0], "Group report · Apt 4B:");
  assert.ok(lines.length <= 3);
  assert.ok(!/^\p{Extended_Pictographic}/mu.test(out), "no emoji at line starts");
  assert.match(out, /2 open balances; I'm nudging people privately./);
  assert.match(out, /7 things in the Cart/);
});

test("composeReport: only the Toolkits that contributed appear; core's line comes last", () => {
  const houseOnly = composeReport([[...choresReportParts(chores, shame.map((s) => ({ ...s, choresThisWeek: 1 })), streaks)]], coreReportParts(upcoming, CHI, NOW));
  const out = formatGroupReport(report(houseOnly));
  assert.doesNotMatch(out, /pays|Cart|Upkeep/);
  assert.doesNotMatch(out, /catching up/, "nobody's slacking -> no chart line");
  assert.match(out, /Chores this week/);
  assert.equal(out.split("\n").at(-1), "⏰ Coming up: Rent is due (Mon 9 AM).");
  assert.deepEqual(composeReport([], []), []);
});

test("coreReportParts: only the next week's Reminders, at most three", () => {
  const far = { text: "Lease renewal", dueAt: new Date("2026-12-01T15:00:00Z") };
  assert.deepEqual(coreReportParts([far], CHI, NOW), []);
  const many = [1, 2, 3, 4].map((i) => ({ text: `R${i}`, dueAt: new Date(NOW.getTime() + i * 3_600_000) }));
  assert.match(coreReportParts([...many, far], CHI, NOW)[0].text, /^Coming up: R1 \(.*\), R2 \(.*\), R3 \(.*\)\.$/);
});

test("settleReportParts: a count, never a name or an amount (#25)", () => {
  const t = (i: number) => ({ fromId: `f${i}`, fromName: `P${i}`, toId: "m", toName: "Maya", cents: 100 * i });
  assert.equal(settleReportParts([t(1), t(2), t(3)], { nudged: true })[0].text, "3 open balances; I'm nudging people privately.");
  assert.equal(settleReportParts([t(1)], { nudged: true })[0].text, "1 open balance; I'm nudging people privately.");
  assert.equal(settleReportParts([t(1), t(2)])[0].text, "2 open balances.", "the nudge is off: no DM claim");
  assert.equal(settleReportParts([])[0].text, "All square.");
});

test("choresReportParts / upkeepReportParts: nothing on an empty chart or a fine house", () => {
  assert.deepEqual(choresReportParts([], shame, streaks), []);
  assert.deepEqual(upkeepReportParts([]), []);
  assert.equal(choresReportParts([chore({ name: "Dishes", dueIn: 3, dueDay: "2026-11-04" })], [], []).at(-1)?.text, "Nothing due on the chart.");
});

test("dueWord", () => {
  assert.equal(dueWord(-1, "2026-10-31"), "1 day late");
  assert.equal(dueWord(0, "2026-11-01"), "today");
  assert.equal(dueWord(1, "2026-11-02"), "tomorrow");
  assert.equal(dueWord(3, "2026-11-04"), "Wed");
});

test("choresNudgeText: null when nothing's due, else one line with whose turn", () => {
  assert.equal(choresNudgeText([]), null);
  assert.equal(choresNudgeText(chores.filter((c) => c.state !== "ok")), "🧹 On the chart today: take out the trash (Maya, 2 days late) and dishes (Dev). Tell me when it's done.");
});

test("composeBundle: the lines with something to say, in order; nothing to say -> no post", () => {
  assert.equal(composeBundle([]), null);
  assert.equal(composeBundle([null, undefined, "  "]), null);
  const house = choresNudgeText(chores.filter((c) => c.state !== "ok"));
  assert.equal(composeBundle([null, house]), house);
  assert.equal(composeBundle(["💸 Rent's due Friday.", null, house, "🛒 Probably low: milk."]), `💸 Rent's due Friday.\n${house}\n🛒 Probably low: milk.`);
});

test("schedule windows: the Bundle's hour and the report's day and hour, in the Group's zone", () => {
  assert.deepEqual(bundleWindow(new Date("2026-11-02T15:10:00Z"), CHI, 9), { open: true, period: "2026-11-02" }); // 9:10 CST
  assert.equal(bundleWindow(new Date("2026-11-02T14:10:00Z"), CHI, 9).open, false); // 8:10
  assert.equal(bundleWindow(new Date("2026-11-02T15:10:00Z"), CHI, null).open, false);
  assert.equal(bundleWindow(new Date("2026-11-02T03:40:00Z"), "Asia/Kolkata", 9).open, true); // 9:10 IST
  // Sunday 18:xx Chicago, on the fall-back Sunday (CST) and in summer (CDT)
  assert.deepEqual(weeklyReportWindow(NOW, CHI, 0, 18), { open: true, period: "2026-11-01" });
  assert.equal(weeklyReportWindow(new Date("2026-07-12T23:30:00Z"), CHI, 0, 18).open, true);
  assert.equal(weeklyReportWindow(new Date("2026-11-01T23:30:00Z"), CHI, 0, 18).open, false); // 17:30
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
