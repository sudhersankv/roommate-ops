// Chore nudges (#60) and the learned rhythm (#61), pure: whose turn, the due day, the usual hour, follow-up spacing,
// the texts, and how often the group really does a chore. Run: npx tsx --test src/services/chore-nudge.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { winsFrom } from "@/lib/personality";
import { addDaysToDay, zonedTimeToUtc } from "@/lib/time";
import {
  choreLabel,
  choreNudgePlan,
  choreNudgeText,
  followUpEvery,
  observedEvery,
  rhythmDiffers,
  rhythmOfferText,
  usualHour,
  type NudgeChore,
  type TurnEntry,
} from "./chores";

const CHI = "America/Chicago";
const people = [
  { id: "sam", name: "Sam Lee" },
  { id: "dev", name: "Dev" },
  { id: "maya", name: "Maya" },
];
/** Local wall-clock in Chicago on a "YYYY-MM-DD" day. */
const at = (day: string, hour: number, minute = 0) =>
  zonedTimeToUtc(CHI, { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)), hour, minute });
const done = (memberId: string, day: string, hour = 19): TurnEntry => ({ memberId, at: at(day, hour), skipped: false });
const pass = (memberId: string, day: string, hour = 12): TurnEntry => ({ memberId, at: at(day, hour), skipped: true });
const newestFirst = (xs: TurnEntry[]) => [...xs].sort((a, b) => b.at.getTime() - a.at.getTime());

const trash: NudgeChore = { name: "Take out the trash", everyDays: 3, rotation: ["maya", "sam", "dev"] };
/** Trash every 3 days at 7 PM; Maya did it last on Nov 10, so Sam's up on Nov 13. */
const trashLogs = newestFirst([done("sam", "2026-11-01"), done("dev", "2026-11-04"), done("maya", "2026-11-07", 18), done("maya", "2026-11-10", 20)]);
const plan = (now: Date, entries = trashLogs, chore = trash, defaultHour = 9) => choreNudgePlan(chore, entries, now, CHI, { people, defaultHour });

test("choreNudgePlan: nothing before the due day; on it, whoever's turn it is at the usual hour", () => {
  assert.equal(plan(at("2026-11-12", 19)), null, "due tomorrow");
  const p = plan(at("2026-11-13", 9));
  assert.deepEqual(p && { memberId: p.memberId, step: p.step, hour: p.hour, dueDay: p.dueDay }, { memberId: "sam", step: 0, hour: 19, dueDay: "2026-11-13" });
  assert.equal(p?.text, "Hey Sam! Trash is yours today.", "the DM goes at 19:00, after noon");
});

test("choreNudgePlan: 'Morning' only before noon local", () => {
  const morning = newestFirst([done("sam", "2026-11-01", 8), done("dev", "2026-11-04", 9), done("maya", "2026-11-07", 9), done("maya", "2026-11-10", 10)]);
  assert.equal(plan(at("2026-11-13", 9, 5), morning)?.text, "Morning Sam! Trash is yours today.");
  assert.equal(plan(at("2026-11-13", 13), morning)?.text, "Hey Sam! Trash is yours today.", "sent late in the day");
});

test("usualHour: median of the last dones' local hours, clamped 08-21; under three dones the Bundle's hour", () => {
  assert.equal(usualHour(trashLogs, CHI, 9), 19);
  assert.equal(usualHour(newestFirst([done("sam", "2026-11-01", 19), done("dev", "2026-11-04", 20)]), CHI, 9), 9, "two dones: default");
  assert.equal(usualHour([], CHI, 6), 8, "a default inside quiet hours is clamped");
  const late = newestFirst([done("sam", "2026-11-01", 23), done("dev", "2026-11-02", 23), done("sam", "2026-11-03", 22)]);
  assert.equal(usualHour(late, CHI, 9), 21);
  const passes = newestFirst([...trashLogs, pass("sam", "2026-11-11", 7), pass("dev", "2026-11-11", 7), pass("maya", "2026-11-11", 7)]);
  assert.equal(usualHour(passes, CHI, 9), 19, "passes don't count");
});

test("usualHour: local hours across the DST change (Chicago, Nov 1 2026)", () => {
  // 19:00 CDT on Oct 30 and 19:00 CST on Nov 2 are different UTC hours, the same local hour.
  const dst = newestFirst([done("sam", "2026-10-30", 19), done("dev", "2026-10-31", 19), done("maya", "2026-11-02", 19)]);
  assert.equal(usualHour(dst, CHI, 9), 19);
});

test("choreNudgePlan: never done = no rhythm yet, no DM (the Bundle keeps it)", () => {
  assert.equal(plan(at("2026-11-13", 12), []), null);
  assert.equal(plan(at("2026-11-13", 12), [pass("maya", "2026-11-12")]), null);
});

test("followUpEvery: half the cycle, at least a day", () => {
  assert.deepEqual([1, 2, 3, 7, 14].map(followUpEvery), [1, 1, 2, 4, 7]);
});

const stepsOver = (chore: NudgeChore, entries: TurnEntry[], dueDay: string, days: number) =>
  Array.from({ length: days }, (_, i) => plan(at(addDaysToDay(dueDay, i), 20), entries, chore)?.step ?? null);

test("choreNudgePlan: every day: due day, then a follow-up each day, three at most", () => {
  const dishes: NudgeChore = { name: "Dishes", everyDays: 1, rotation: null };
  const logs = newestFirst([done("sam", "2026-11-08"), done("dev", "2026-11-09"), done("maya", "2026-11-10")]);
  assert.deepEqual(stepsOver(dishes, logs, "2026-11-11", 6), [0, 1, 2, 3, null, null]);
});

test("choreNudgePlan: every 2 days follows up daily; weekly every 4 days", () => {
  const every2: NudgeChore = { name: "Plants", everyDays: 2, rotation: null };
  assert.deepEqual(stepsOver(every2, [done("sam", "2026-11-08")], "2026-11-10", 5), [0, 1, 2, 3, null]);
  const bathroom: NudgeChore = { name: "Clean the bathroom", everyDays: 7, rotation: null };
  assert.deepEqual(stepsOver(bathroom, [done("sam", "2026-11-01")], "2026-11-08", 17), [0, null, null, null, 1, null, null, null, 2, null, null, null, 3, null, null, null, null]);
});

test("choreNudgePlan: a done stops it", () => {
  const after = newestFirst([...trashLogs, done("sam", "2026-11-14", 8)]);
  assert.equal(plan(at("2026-11-14", 20), after), null);
});

test("choreNudgePlan: a pass moves it to the next person, who starts at the first nudge that day", () => {
  const passed = newestFirst([...trashLogs, pass("sam", "2026-11-14", 10)]);
  const p = plan(at("2026-11-14", 20), passed);
  assert.deepEqual(p && [p.memberId, p.step, p.text], ["dev", 0, "Hey Dev! Trash is yours today."]);
  assert.deepEqual(plan(at("2026-11-16", 20), passed) && [plan(at("2026-11-16", 20), passed)!.memberId, plan(at("2026-11-16", 20), passed)!.step], ["dev", 1]);
  // A pass before the due day: the next person starts on the due day itself.
  const early = newestFirst([...trashLogs, pass("sam", "2026-11-12", 10)]);
  assert.deepEqual([plan(at("2026-11-13", 20), early)?.memberId, plan(at("2026-11-13", 20), early)?.step], ["dev", 0]);
});

test("choreNudgeText: shorter each time; the chore as people say it", () => {
  assert.equal(choreNudgeText(0, "Take out the trash", "Sam", 9), "Morning Sam! Trash is yours today.");
  assert.equal(choreNudgeText(1, "Take out the trash", "Sam", 9), "Trash, Sam.");
  assert.equal(choreNudgeText(2, "Take out the trash", "Sam", 9), "Sam. Trash.");
  assert.equal(choreNudgeText(3, "Take out the trash", "Sam", 9), "Sam. Trash.");
  assert.equal(choreLabel("Clean the bathroom"), "Bathroom");
  assert.equal(choreLabel("dishes"), "Dishes");
  assert.equal(choreLabel("Vacuum the stairs"), "Vacuum the stairs");
});

test("observedEvery: the median gap between done days; four needed; passes and same-day repeats left out", () => {
  assert.equal(observedEvery(trashLogs, CHI), 3);
  assert.equal(observedEvery(trashLogs.slice(0, 3), CHI), null, "three dones");
  const noisy = newestFirst([...trashLogs, done("dev", "2026-11-10", 21), pass("sam", "2026-11-05"), pass("sam", "2026-11-06")]);
  assert.equal(observedEvery(noisy, CHI), 3);
  const weekly = newestFirst(["2026-10-01", "2026-10-09", "2026-10-15", "2026-10-22", "2026-10-30"].map((d) => done("sam", d)));
  assert.equal(observedEvery(weekly, CHI), 8, "gaps 8, 6, 7, 8 -> median 7.5 -> 8");
});

test("rhythmDiffers: at least a day and at least 30% off", () => {
  assert.equal(rhythmDiffers(3, 7), true);
  assert.equal(rhythmDiffers(6, 7), false, "one day is 14% of a week");
  assert.equal(rhythmDiffers(2, 1), true);
  assert.equal(rhythmDiffers(3, 3), false);
  assert.equal(rhythmDiffers(10, 14), false, "4 days is 29%");
});

test("rhythmOfferText: the video's line for trash, plain words for the rest", () => {
  assert.equal(rhythmOfferText("Take out the trash", 3), "Trash actually goes out every 3 days. Want me to change it?");
  assert.equal(rhythmOfferText("Dishes", 2), "You actually do dishes every 2 days. Want me to change it?");
  assert.equal(rhythmOfferText("Clean the bathroom", 1), "You actually do bathroom every day. Want me to change it?");
});

test("winsFrom: a done after a nudge is 'on a roll'; a streak milestone comes first", () => {
  const day = "2026-11-13";
  const roll = winsFrom([{ tool: "log_chore", result: { chore: "Take out the trash", streak: 1, nudged: true } }], { day, senderName: "Sam Lee" });
  assert.deepEqual(roll.map((w) => [w.kind, w.who]), [["roll", "Sam"]]);
  const both = winsFrom([{ tool: "log_chore", result: { chore: "Dishes", streak: 3, nudged: true } }], { day, senderName: "Sam" });
  assert.deepEqual(both.map((w) => w.kind), ["streak", "roll"]);
  assert.deepEqual(winsFrom([{ tool: "log_chore", result: { chore: "Dishes", streak: 1, nudged: false } }], { day, senderName: "Sam" }), []);
});
