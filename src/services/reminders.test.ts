// Pure reminder logic: repeats in the Group's zone (DST), the line Roomie sends, who sees and cancels what. No DB.
// Run: npx tsx --test src/services/reminders.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedParts } from "@/lib/time";
import { canCancel, nextAfter, nextOccurrence, reminderLine, visibleTo, whenLabel } from "./reminders";

const CHI = "America/Chicago";
const BER = "Europe/Berlin";
const IND = "Asia/Kolkata";
const iso = (d: Date) => d.toISOString();

test("weekly keeps 8 PM Chicago across the Nov 1 switch", () => {
  const tueBefore = new Date("2026-10-28T01:00:00Z"); // Tue Oct 27, 20:00 CDT
  const next = nextAfter(tueBefore, "weekly", CHI);
  assert.equal(iso(next), "2026-11-04T02:00:00.000Z"); // Tue Nov 3, 20:00 CST
  assert.equal(zonedParts(CHI, next).hour, 20);
});

test("daily keeps 9 AM Berlin across Oct 25", () => {
  const sat = new Date("2026-10-24T07:00:00Z"); // 09:00 CEST
  assert.equal(iso(nextAfter(sat, "daily", BER)), "2026-10-25T08:00:00.000Z"); // 09:00 CET
});

test("monthly: same local time, day clamped to 28, rolls the year", () => {
  const first = new Date("2026-11-01T03:30:00Z"); // Nov 1, 09:00 IST
  assert.equal(iso(nextAfter(first, "monthly", IND)), "2026-12-01T03:30:00.000Z");
  const jan31 = new Date("2027-01-31T15:00:00Z"); // 09:00 CST
  const feb = nextAfter(jan31, "monthly", CHI);
  assert.deepEqual([zonedParts(CHI, feb).month, zonedParts(CHI, feb).day, zonedParts(CHI, feb).hour], [2, 28, 9]);
  assert.equal(iso(nextAfter(new Date("2026-12-05T15:00:00Z"), "monthly", CHI)), "2027-01-05T15:00:00.000Z");
  // 9 AM Chicago on Oct 1 (CDT) -> Nov 1 9 AM is after the switch: CST
  assert.equal(iso(nextAfter(new Date("2026-10-01T14:00:00Z"), "monthly", CHI)), "2026-11-01T15:00:00.000Z");
});

test("nextOccurrence skips what was missed while the scheduler was off", () => {
  const due = new Date("2026-10-01T14:00:00Z");
  const now = new Date("2026-10-10T12:00:00Z");
  assert.equal(iso(nextOccurrence(due, "daily", CHI, now)), "2026-10-10T14:00:00.000Z");
  assert.equal(iso(nextOccurrence(due, "weekly", CHI, now)), "2026-10-15T14:00:00.000Z");
});

test("reminderLine: whole group vs private, '(set by Maya)' only when set for someone else", () => {
  const base = { id: "r1", text: "Trash goes out", memberId: null, memberName: null, createdBy: "m", createdByName: "Maya" };
  const group = reminderLine(base);
  assert.match(group, /^⏰ /);
  assert.match(group, /trash goes out/i);
  assert.doesNotMatch(group, /set by/);
  const forDev = reminderLine({ ...base, id: "r2", text: "Pay Maya back for brunch.", memberId: "d", memberName: "Dev" });
  assert.match(forDev, /pay Maya back for brunch \(set by Maya\)$/);
  const own = reminderLine({ ...base, id: "r3", text: "Pay rent", memberId: "m", memberName: "Maya" });
  assert.doesNotMatch(own, /set by/);
  assert.equal(reminderLine(base), group, "deterministic");
  assert.ok(group.length < 80);
});

test("whenLabel in the Group's zone", () => {
  assert.equal(whenLabel({ dueAt: new Date("2026-11-04T02:00:00Z"), recurring: null }, CHI), "Tue Nov 3, 8:00 PM");
  assert.equal(whenLabel({ dueAt: new Date("2026-11-01T03:30:00Z"), recurring: "monthly" }, IND), "Sun Nov 1, 9:00 AM, then monthly");
});

test("visibleTo / canCancel", () => {
  const priv = { memberId: "d", createdBy: "m" };
  const grp = { memberId: null, createdBy: "s" };
  assert.equal(visibleTo("s", priv), false);
  assert.equal(visibleTo("d", priv), true);
  assert.equal(visibleTo("m", priv), true);
  assert.equal(visibleTo("s", grp), true);
  const member = (id: string, role = "member", status = "active") => ({ id, role, status });
  assert.equal(canCancel(member("s"), priv), false);
  assert.equal(canCancel(member("d"), priv), true);
  assert.equal(canCancel(member("m"), priv), true);
  assert.equal(canCancel(member("x", "admin"), priv), true);
  assert.equal(canCancel(member("x"), grp), true);
  assert.equal(canCancel(member("x", "member", "pending"), grp), false);
});
