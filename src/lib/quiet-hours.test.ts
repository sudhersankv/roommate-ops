// Quiet hours 22:00-08:00 local, across DST. Run: npx tsx --test src/lib/quiet-hours.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { daytimeHour, inQuietHours, nextAllowed } from "./quiet-hours";

const at = (iso: string) => new Date(iso);

test("Chicago, the night the clocks fall back (Nov 1 2026): 23:00 CDT and 01:30 (twice) wait for 08:00 CST", () => {
  const tz = "America/Chicago";
  assert.equal(inQuietHours(at("2026-11-01T02:59:00Z"), tz), false, "21:59 CDT");
  assert.equal(inQuietHours(at("2026-11-01T03:00:00Z"), tz), true, "22:00 CDT");
  for (const iso of ["2026-11-01T04:00:00Z", "2026-11-01T06:30:00Z", "2026-11-01T07:30:00Z", "2026-11-01T13:59:00Z"]) {
    assert.equal(nextAllowed(at(iso), tz).toISOString(), "2026-11-01T14:00:00.000Z", iso);
  }
  assert.equal(inQuietHours(at("2026-11-01T14:00:00Z"), tz), false, "08:00 CST is daytime");
  const day = at("2026-11-01T18:00:00Z");
  assert.equal(nextAllowed(day, tz), day, "daytime: now");
});

test("Berlin, Oct 25 2026 (03:00 CEST -> 02:00 CET): 22:30 Saturday waits for 08:00 CET Sunday", () => {
  const tz = "Europe/Berlin";
  assert.equal(inQuietHours(at("2026-10-24T19:59:00Z"), tz), false, "21:59 CEST");
  assert.equal(nextAllowed(at("2026-10-24T20:30:00Z"), tz).toISOString(), "2026-10-25T07:00:00.000Z");
  assert.equal(nextAllowed(at("2026-10-25T00:30:00Z"), tz).toISOString(), "2026-10-25T07:00:00.000Z", "02:30 CEST");
  assert.equal(nextAllowed(at("2026-10-25T01:30:00Z"), tz).toISOString(), "2026-10-25T07:00:00.000Z", "02:30 CET");
  assert.equal(inQuietHours(at("2026-10-25T07:00:00Z"), tz), false);
});

test("Kolkata (no DST, +05:30): the half-hour offset", () => {
  const tz = "Asia/Kolkata";
  assert.equal(inQuietHours(at("2026-11-03T16:29:00Z"), tz), false, "21:59 IST");
  assert.equal(inQuietHours(at("2026-11-03T16:30:00Z"), tz), true, "22:00 IST");
  assert.equal(nextAllowed(at("2026-11-03T16:30:00Z"), tz).toISOString(), "2026-11-04T02:30:00.000Z");
  assert.equal(nextAllowed(at("2026-11-04T02:29:00Z"), tz).toISOString(), "2026-11-04T02:30:00.000Z", "07:59 IST");
});

test("a nudge hour inside quiet hours goes out at 08:00", () => {
  assert.deepEqual([0, 6, 7, 8, 9, 21, 22, 23].map(daytimeHour), [8, 8, 8, 8, 9, 21, 8, 8]);
});
