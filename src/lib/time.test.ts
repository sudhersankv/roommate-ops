// Time-zone helpers around DST and a half-hour zone. Run: npx tsx --test src/lib/time.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDaysInZone,
  dayInZone,
  describeNow,
  formatInZone,
  isSameDay,
  nextWeekday,
  offsetLabel,
  parseInZone,
  resolveTimeZone,
  startOfDay,
  zonedParts,
  zonedTimeToUtc,
  zonesByRegion,
} from "./time";

const CHI = "America/Chicago";
const BER = "Europe/Berlin";
const IND = "Asia/Kolkata";
const iso = (d: Date) => d.toISOString();

test("zonedTimeToUtc: plain offsets (CDT, CST, IST +5:30)", () => {
  assert.equal(iso(zonedTimeToUtc(CHI, { year: 2026, month: 10, day: 28, hour: 20, minute: 0 })), "2026-10-29T01:00:00.000Z");
  assert.equal(iso(zonedTimeToUtc(CHI, { year: 2026, month: 11, day: 3, hour: 20, minute: 0 })), "2026-11-04T02:00:00.000Z");
  assert.equal(iso(zonedTimeToUtc(IND, { year: 2026, month: 11, day: 1, hour: 9, minute: 0 })), "2026-11-01T03:30:00.000Z");
});

test("Chicago fall back (Nov 1 2026): 1:30 happens twice -> the first; the day has 25 hours", () => {
  assert.equal(iso(zonedTimeToUtc(CHI, { year: 2026, month: 11, day: 1, hour: 1, minute: 30 })), "2026-11-01T06:30:00.000Z");
  const start = startOfDay(CHI, new Date("2026-11-01T12:00:00Z"));
  const next = startOfDay(CHI, new Date("2026-11-02T12:00:00Z"));
  assert.equal(iso(start), "2026-11-01T05:00:00.000Z");
  assert.equal((next.getTime() - start.getTime()) / 3_600_000, 25);
  // 8 pm stays 8 pm across the switch
  const sat8 = zonedTimeToUtc(CHI, { year: 2026, month: 10, day: 31, hour: 20, minute: 0 });
  assert.equal(zonedParts(CHI, addDaysInZone(CHI, sat8, 1)).hour, 20);
  assert.equal(addDaysInZone(CHI, sat8, 1).getTime() - sat8.getTime(), 25 * 3_600_000);
});

test("Chicago spring forward (Mar 8 2026): 2:30 doesn't exist -> 3:30 CDT", () => {
  const t = zonedTimeToUtc(CHI, { year: 2026, month: 3, day: 8, hour: 2, minute: 30 });
  assert.equal(iso(t), "2026-03-08T08:30:00.000Z");
  assert.equal(zonedParts(CHI, t).hour, 3);
});

test("Berlin fall back (Oct 25 2026): 2:30 is ambiguous -> CEST; offsets on either side", () => {
  assert.equal(iso(zonedTimeToUtc(BER, { year: 2026, month: 10, day: 25, hour: 2, minute: 30 })), "2026-10-25T00:30:00.000Z");
  assert.equal(offsetLabel(BER, new Date("2026-10-24T12:00:00Z")), "UTC+02:00");
  assert.equal(offsetLabel(BER, new Date("2026-10-26T12:00:00Z")), "UTC+01:00");
  assert.equal(iso(zonedTimeToUtc(BER, { year: 2026, month: 10, day: 26, hour: 9, minute: 0 })), "2026-10-26T08:00:00.000Z");
});

test("UTC+5:30: day boundaries and labels", () => {
  assert.equal(offsetLabel(IND, new Date()), "UTC+05:30");
  // 19:00Z is 00:30 the next day in India
  assert.equal(dayInZone(IND, new Date("2026-10-28T19:00:00Z")), "2026-10-29");
  assert.equal(dayInZone(IND, new Date("2026-10-28T18:29:00Z")), "2026-10-28");
  assert.equal(iso(startOfDay(IND, new Date("2026-10-28T19:00:00Z"))), "2026-10-28T18:30:00.000Z");
  assert.equal(isSameDay(IND, new Date("2026-10-28T18:31:00Z"), new Date("2026-10-29T18:00:00Z")), true);
  assert.equal(isSameDay(CHI, new Date("2026-10-28T18:31:00Z"), new Date("2026-10-29T18:00:00Z")), false);
});

test("nextWeekday: next Tuesday 8pm from Wed Oct 28 2026 is Nov 3 in CST (after the switch)", () => {
  const wed = new Date("2026-10-28T16:00:00Z"); // 11:00 CDT
  assert.equal(iso(nextWeekday(CHI, 2, 20, wed)), "2026-11-04T02:00:00.000Z");
  // On a Tuesday before 8pm it's tonight; after 8pm it's next week
  const tueNoon = new Date("2026-11-03T18:00:00Z");
  assert.equal(iso(nextWeekday(CHI, 2, 20, tueNoon)), "2026-11-04T02:00:00.000Z");
  assert.equal(iso(nextWeekday(CHI, 2, 20, new Date("2026-11-04T02:30:00Z"))), "2026-11-11T02:00:00.000Z");
  // Sunday 18:00 Berlin from Saturday Oct 24 (CEST) lands after its switch, in CET
  assert.equal(iso(nextWeekday(BER, 0, 18, new Date("2026-10-24T10:00:00Z"))), "2026-10-25T17:00:00.000Z");
  assert.equal(iso(nextWeekday(IND, 1, 9, new Date("2026-10-28T00:00:00Z"))), "2026-11-02T03:30:00.000Z");
});

test("parseInZone: offsets are kept, bare wall-clock is read in the Group's zone, bad input is invalid", () => {
  assert.equal(iso(parseInZone("2026-11-03T20:00:00-06:00", CHI)), "2026-11-04T02:00:00.000Z");
  assert.equal(iso(parseInZone("2026-11-03T20:00", CHI)), "2026-11-04T02:00:00.000Z");
  assert.equal(iso(parseInZone("2026-11-03 20:00:00", BER)), "2026-11-03T19:00:00.000Z");
  assert.equal(iso(parseInZone("2026-12-01", IND)), "2026-12-01T03:30:00.000Z"); // a date alone is 9:00
  assert.equal(iso(parseInZone("2026-11-03T20:00:00Z", IND)), "2026-11-03T20:00:00.000Z");
  assert.ok(Number.isNaN(parseInZone("next tuesday-ish", CHI).getTime()));
  assert.ok(Number.isNaN(parseInZone("2026-13-01T10:00", CHI).getTime()));
});

test("formatInZone / describeNow", () => {
  const t = new Date("2026-11-04T02:00:00Z");
  assert.equal(formatInZone(t, CHI), "Tue Nov 3, 8:00 PM");
  assert.equal(formatInZone(t, IND), "Wed Nov 4, 7:30 AM");
  assert.equal(describeNow(CHI, new Date("2026-10-28T16:05:00Z")), "Wednesday 2026-10-28 11:05 in America/Chicago (UTC-05:00)");
});

test("resolveTimeZone: what people say -> IANA, unknown -> null", () => {
  assert.equal(resolveTimeZone("Chicago"), CHI);
  assert.equal(resolveTimeZone("CST"), CHI);
  assert.equal(resolveTimeZone("central time"), CHI);
  assert.equal(resolveTimeZone("India"), IND);
  assert.equal(resolveTimeZone("IST"), IND);
  assert.equal(resolveTimeZone("Bangalore"), IND);
  assert.equal(resolveTimeZone("europe/berlin"), BER);
  assert.equal(resolveTimeZone("America/Chicago"), CHI);
  assert.equal(resolveTimeZone("New York"), "America/New_York");
  assert.equal(resolveTimeZone("Lisbon"), "Europe/Lisbon"); // any IANA city
  assert.equal(resolveTimeZone("Pacific Time"), "America/Los_Angeles");
  assert.equal(resolveTimeZone("my place"), null);
  assert.equal(resolveTimeZone(""), null);
});

test("zonesByRegion: grouped, labelled by city", () => {
  const groups = zonesByRegion();
  const america = groups.find((g) => g.region === "America");
  assert.ok(america?.zones.some((z) => z.value === CHI && z.label === "Chicago"));
  assert.ok(groups.find((g) => g.region === "Asia")?.zones.some((z) => z.value === IND));
});
