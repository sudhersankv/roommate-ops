import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { clockText, dayWord, eveningBefore, noticeLineText, noticeReminderText, noticeStatus, noticeTip, windowText, type Notice } from "./notice-window";

const CHI = "America/Chicago";
// Tue Nov 3 2026 in Chicago is CST (UTC-6), two days after fall back.
const chi = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 10, day, hour + 6, minute));

const water: Notice = {
  summary: "water's off Tue, 9 to 11 AM",
  what: "water",
  off: true,
  start: "2026-11-03T09:00",
  end: "2026-11-03T11:00",
  receivedAt: chi(1, 10),
};

describe("windowText: the window as people say it", () => {
  test("both in the morning: 9 to 11", () => assert.equal(windowText(water, CHI), "9 to 11"));
  test("minutes, noon, the afternoon, across noon", () => {
    assert.equal(windowText({ start: "2026-11-03T09:30", end: "2026-11-03T11:15" }, CHI), "9:30 to 11:15");
    assert.equal(windowText({ start: "2026-11-03T09:00", end: "2026-11-03T12:00" }, CHI), "9 to noon");
    assert.equal(windowText({ start: "2026-11-03T13:00", end: "2026-11-03T15:00" }, CHI), "1 to 3 PM");
    assert.equal(windowText({ start: "2026-11-03T11:00", end: "2026-11-03T13:00" }, CHI), "11 AM to 1 PM");
    assert.equal(windowText({ start: "2026-11-03T12:00", end: "2026-11-03T14:00" }, CHI), "noon to 2 PM");
  });
  test("no end, overnight, no time", () => {
    assert.equal(windowText({ start: "2026-11-03T09:00" }, CHI), "from 9");
    assert.equal(windowText({ start: "2026-11-03T14:00" }, CHI), "from 2 PM");
    assert.equal(windowText({ start: "2026-11-03T22:00", end: "2026-11-04T06:00" }, CHI), "10 PM to Wed 6 AM");
    assert.equal(windowText({ start: "2026-11-03" }, CHI), null);
    assert.equal(windowText({}, CHI), null);
  });
});

describe("clockText and dayWord", () => {
  test("morning without AM, afternoon with PM, noon", () => {
    assert.equal(clockText(chi(3, 11), CHI), "11:00");
    assert.equal(clockText(chi(3, 11, 2), CHI), "11:02");
    assert.equal(clockText(chi(3, 19), CHI), "7:00 PM");
    assert.equal(clockText(chi(3, 12), CHI), "noon");
  });
  test("today, tomorrow, the weekday within the week, else the date", () => {
    const now = chi(1, 10); // Sun Nov 1
    assert.equal(dayWord(chi(1, 20), now, CHI), "today");
    assert.equal(dayWord(chi(2, 9), now, CHI), "tomorrow");
    assert.equal(dayWord(chi(3, 9), now, CHI), "Tue");
    assert.equal(dayWord(chi(12, 9), now, CHI), "Nov 12");
  });
});

describe("the night-before Reminder", () => {
  test("20:00 local the evening before: Monday 8 PM CST for Tuesday's shut-off", () => {
    assert.equal(eveningBefore(water.start!, CHI)?.toISOString(), chi(2, 20).toISOString());
    // Across fall back: Sun Nov 1 20:00 CST for a Monday notice.
    assert.equal(eveningBefore("2026-11-02", CHI)?.toISOString(), "2026-11-02T02:00:00.000Z");
    assert.equal(eveningBefore("soon", CHI), null);
  });

  test("water: the video's line", () => {
    assert.equal(noticeReminderText(water, water.summary, CHI), "Reminder: water's off tomorrow, 9 to 11. Shower tonight.");
  });

  test("power and the elevators get their tip; something else gets none", () => {
    assert.equal(noticeReminderText({ what: "power", off: true, start: "2026-11-03T13:00", end: "2026-11-03T15:00" }, "x", CHI), "Reminder: power's off tomorrow, 1 to 3 PM. Charge your phone tonight.");
    assert.equal(noticeReminderText({ what: "elevators", off: true, start: "2026-11-03T09:00", end: "2026-11-03T17:00" }, "x", CHI), "Reminder: elevators are off tomorrow, 9 AM to 5 PM. Plan on the stairs.");
    assert.equal(noticeReminderText({ what: "gas", off: true, start: "2026-11-03T09:00" }, "x", CHI), "Reminder: gas's off tomorrow from 9.");
  });

  test("a visit, not a shut-off: the generic line, no tip", () => {
    const f = { what: "smoke detector inspection", start: "2026-11-12T09:00", end: "2026-11-12T12:00" };
    assert.equal(noticeReminderText(f, "smoke detector inspection Thursday Nov 12, 9am-noon", CHI), "Reminder: smoke detector inspection tomorrow, 9 to noon.");
    assert.equal(noticeTip({ what: "water heater inspection", off: false }), null);
  });

  test("no window: just tomorrow; no `what`: the summary as before", () => {
    assert.equal(noticeReminderText({ what: "water", off: true, start: "2026-11-03" }, "x", CHI), "Reminder: water's off tomorrow. Shower tonight.");
    assert.equal(noticeReminderText({}, "Hallway painting Wednesday Nov 18", CHI), "Tomorrow: hallway painting Wednesday Nov 18");
  });
});

describe('noticeStatus: "is the water back on?"', () => {
  test("after the end: Yep, since 11:00", () => {
    const r = noticeStatus([water], chi(3, 14), CHI, "water");
    assert.deepEqual([r?.state, r?.line], ["after", "Yep, since 11:00."]);
  });

  test("inside the window: Not yet, back at 11:00", () => {
    const r = noticeStatus([water], chi(3, 10, 15), CHI, "is the water back on?");
    assert.deepEqual([r?.state, r?.line], ["during", "Not yet, back at 11:00."]);
  });

  test("before it starts: still on, and when it goes off", () => {
    assert.equal(noticeStatus([water], chi(1, 18), CHI, "water")?.line, "It's still on. Off Tue 9 to 11.");
    assert.equal(noticeStatus([water], chi(2, 21), CHI, "water")?.line, "It's still on. Off tomorrow 9 to 11.");
    assert.equal(noticeStatus([water], chi(3, 8), CHI, "water")?.line, "It's still on. Off today 9 to 11.");
  });

  test("ended on an earlier day: the day too", () => {
    assert.equal(noticeStatus([water], chi(4, 9), CHI, "water")?.line, "Yep, since Tue 11:00.");
  });

  test("about narrows to the notice that says it; aliases (lights -> power)", () => {
    const power: Notice = { summary: "power off Thu 1-3pm", what: "power", off: true, start: "2026-11-05T13:00", end: "2026-11-05T15:00", receivedAt: chi(2, 9) };
    assert.equal(noticeStatus([water, power], chi(3, 14), CHI, "water")?.notice, water);
    assert.equal(noticeStatus([water, power], chi(5, 14), CHI, "are the lights back?")?.line, "Not yet, back at 3:00 PM.");
    assert.equal(noticeStatus([water, power], chi(3, 14), CHI, "the pool"), null);
  });

  test("which one: going on now, else ended within a day, else the next one, else the last ended", () => {
    const next: Notice = { ...water, start: "2026-11-10T09:00", end: "2026-11-10T11:00", receivedAt: chi(3, 12) };
    assert.equal(noticeStatus([water, next], chi(3, 15), CHI, "water")?.line, "Yep, since 11:00.", "ended today beats next week");
    assert.equal(noticeStatus([water, next], chi(6, 9), CHI, "water")?.line, "It's still on. Off Tue 9 to 11.", "days later: the next one");
    assert.equal(noticeStatus([water], chi(20, 9), CHI, "water")?.line, "Yep, since Nov 3 11:00.");
  });

  test("notices without a start time don't count; none at all is null", () => {
    assert.equal(noticeStatus([{ ...water, start: "2026-11-03", end: undefined }], chi(3, 14), CHI, "water"), null);
    assert.equal(noticeStatus([], chi(3, 14), CHI), null);
  });

  test("a visit: its own words", () => {
    const insp: Notice = { summary: "inspection", what: "smoke detector inspection", start: "2026-11-03T09:00", end: "2026-11-03T12:00", receivedAt: chi(1, 9) };
    assert.equal(noticeStatus([insp], chi(1, 18), CHI, "inspection")?.line, "Smoke detector inspection: Tue 9 to noon.");
    assert.equal(noticeStatus([insp], chi(3, 10), CHI, "inspection")?.line, "Going on now, until noon.");
    assert.equal(noticeStatus([insp], chi(3, 13), CHI, "inspection")?.line, "Done since noon.");
  });

  test("no end given: during says so", () => {
    const open: Notice = { ...water, end: undefined };
    assert.equal(noticeStatus([open], chi(3, 10), CHI, "water")?.line, "Not yet. It went off at 9:00 and the notice didn't say until when.");
  });
});

describe("noticeLineText: the chat line after the sender (#74)", () => {
  const SUN = chi(1, 10); // Sun Nov 1, 10:00
  test("a shut-off with its window, the morning saying AM", () => {
    assert.equal(noticeLineText({ facts: water, summary: water.summary }, SUN, CHI), "water's off Tue, 9 to 11 AM.");
    assert.equal(windowText(water, CHI, { am: true }), "9 to 11 AM");
    assert.equal(windowText({ start: "2026-11-03T09:00" }, CHI, { am: true }), "from 9 AM");
    assert.equal(windowText({ start: "2026-11-03T13:00", end: "2026-11-03T15:00" }, CHI, { am: true }), "1 to 3 PM");
  });
  test("tomorrow, a visit, a bare day", () => {
    assert.equal(noticeLineText({ facts: water, summary: "x" }, chi(2, 12), CHI), "water's off tomorrow, 9 to 11 AM.");
    assert.equal(noticeLineText({ facts: { what: "smoke detector inspection", start: "2026-11-03T09:00", end: "2026-11-03T12:00" }, summary: "x" }, SUN, CHI), "smoke detector inspection Tue, 9 to noon.");
    assert.equal(noticeLineText({ facts: { what: "pest control" }, date: "2026-11-12", summary: "x" }, SUN, CHI), "pest control Nov 12.");
  });
  test("without a thing or a day: the summary as it is", () => {
    assert.equal(noticeLineText({ facts: null, summary: "community mixer Friday" }, SUN, CHI), "community mixer Friday");
    assert.equal(noticeLineText({ facts: { start: "2026-11-03T09:00" }, summary: "hallway painting" }, SUN, CHI), "hallway painting");
    assert.equal(noticeLineText({ facts: { what: "water", off: true }, summary: "water off soon" }, SUN, CHI), "water off soon");
  });
});
