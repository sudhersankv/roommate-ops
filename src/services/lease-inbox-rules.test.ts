import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { isUrgent, nextStatus, type WorkOrderState } from "./lease-inbox-rules";

const at = (status: WorkOrderState["status"], scheduledFor: string | null = null): WorkOrderState => ({ status, scheduledFor });

describe("nextStatus: sent -> acknowledged -> scheduled(date) -> done", () => {
  test("each step forward", () => {
    assert.deepEqual(nextStatus(at("sent"), { kind: "acknowledged" }), { status: "acknowledged", scheduledFor: null, changed: true });
    assert.deepEqual(nextStatus(at("acknowledged"), { kind: "scheduled", date: "2026-11-03T10:00" }), {
      status: "scheduled",
      scheduledFor: "2026-11-03T10:00",
      changed: true,
    });
    assert.deepEqual(nextStatus(at("scheduled", "2026-11-03T10:00"), { kind: "done" }), { status: "done", scheduledFor: "2026-11-03T10:00", changed: true });
  });

  test("skipping ahead is fine: the landlord's first reply already books the plumber", () => {
    assert.deepEqual(nextStatus(at("sent"), { kind: "scheduled", date: "2026-11-03" }), { status: "scheduled", scheduledFor: "2026-11-03", changed: true });
    assert.equal(nextStatus(at("sent"), { kind: "done" }).status, "done");
    assert.equal(nextStatus(at("acknowledged"), { kind: "done" }).status, "done");
  });

  test("a new date moves a scheduled visit", () => {
    assert.deepEqual(nextStatus(at("scheduled", "2026-11-03"), { kind: "scheduled", date: "2026-11-05" }), {
      status: "scheduled",
      scheduledFor: "2026-11-05",
      changed: true,
    });
  });

  test("going backwards is a no-op", () => {
    assert.deepEqual(nextStatus(at("scheduled", "2026-11-03"), { kind: "acknowledged" }), { status: "scheduled", scheduledFor: "2026-11-03", changed: false });
    assert.deepEqual(nextStatus(at("acknowledged"), { kind: "acknowledged" }), { status: "acknowledged", scheduledFor: null, changed: false });
  });

  test("done is final", () => {
    for (const reply of [{ kind: "acknowledged" }, { kind: "scheduled", date: "2026-11-09" }, { kind: "done" }] as const) {
      assert.deepEqual(nextStatus(at("done", "2026-11-03"), reply), { status: "done", scheduledFor: "2026-11-03", changed: false });
    }
  });

  test("scheduled with no date, the same date, or a reply that says nothing: no-op", () => {
    assert.equal(nextStatus(at("acknowledged"), { kind: "scheduled", date: "" }).changed, false);
    assert.equal(nextStatus(at("scheduled", "2026-11-03"), { kind: "scheduled", date: "2026-11-03" }).changed, false);
    assert.deepEqual(nextStatus(at("sent"), { kind: "other" }), { status: "sent", scheduledFor: null, changed: false });
  });
});

describe("isUrgent: a notice dated within 72 hours", () => {
  const CHI = "America/Chicago";
  const BER = "Europe/Berlin";
  const KOL = "Asia/Kolkata";

  test("Chicago across fall back (Nov 1 2026): 72 real hours, not 72 wall-clock hours", () => {
    const now = new Date("2026-10-30T15:00:00Z"); // Fri 10:00 CDT
    assert.equal(isUrgent("2026-11-02T09:00", now, CHI), true); // Mon 09:00 CST = exactly 72 h later
    assert.equal(isUrgent("2026-11-02T09:30", now, CHI), false); // 71.5 wall-clock hours, 72.5 real ones
  });

  test("Berlin across fall back (Oct 25 2026)", () => {
    const now = new Date("2026-10-22T10:00:00Z"); // Thu 12:00 CEST
    assert.equal(isUrgent("2026-10-25T11:00", now, BER), true); // Sun 11:00 CET = 10:00Z, 72 h
    assert.equal(isUrgent("2026-10-25T11:30", now, BER), false);
  });

  test("a bare date counts from the start of that local day (Kolkata, no DST)", () => {
    const now = new Date("2026-10-30T14:30:00Z"); // Fri 20:00 IST
    assert.equal(isUrgent("2026-11-02", now, KOL), true); // Mon 00:00 IST, 52 h away
    assert.equal(isUrgent("2026-11-03", now, KOL), false); // 76 h away
  });

  test("a time that has already passed is not urgent: it's news for the next Bundle", () => {
    const shutOff = "2026-10-30T09:00"; // Fri 09:00 CDT
    assert.equal(isUrgent(shutOff, new Date("2026-10-30T16:00:00Z"), CHI), false); // received Fri 11:00
    assert.equal(isUrgent(shutOff, new Date("2026-10-30T01:00:00Z"), CHI), true); // received Thu 20:00
    assert.equal(isUrgent(shutOff, new Date("2026-10-30T14:00:00Z"), CHI), false); // received at 09:00 sharp
  });

  test("a bare date is urgent until its local day is over; an earlier day is not", () => {
    const now = new Date("2026-10-30T23:00:00Z"); // Fri 18:00 CDT, already Saturday in UTC
    assert.equal(isUrgent("2026-10-30", now, CHI), true);
    assert.equal(isUrgent("2026-10-29", now, CHI), false);
  });

  test("an offset in the date is honoured; nonsense is not urgent", () => {
    const now = new Date("2026-10-30T15:00:00Z");
    assert.equal(isUrgent("2026-11-01T12:00:00Z", now, CHI), true);
    assert.equal(isUrgent("next week sometime", now, CHI), false);
  });
});
