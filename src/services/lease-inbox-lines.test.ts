// The Lease Inbox Toolkit's pure lines: the Bundle (a visit tomorrow, a work order quiet 5 days), the weekly report
// part, the Member's "yes" before a complex send, and an attachment's Document kind. Apt 4B is in Chicago.
// Run: npx tsx --test src/services/lease-inbox-lines.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { attachmentKind, leaseBundleText, leaseReportText, saysYes, type QuietOrder } from "./lease-inbox-rules";

const TZ = "America/Chicago";
// Monday Nov 2 2026, 9:00 in Chicago (after the DST change on Nov 1: UTC-6).
const MONDAY_9AM = new Date("2026-11-02T15:00:00Z");
const order = (over: Partial<QuietOrder>): QuietOrder => ({ title: "the leaking kitchen sink", status: "sent", scheduledFor: null, lastActivityAt: new Date("2026-11-01T15:00:00Z"), ...over });

describe("leaseBundleText", () => {
  const table: [string, QuietOrder[], string | null][] = [
    ["nothing", [], null],
    ["a visit tomorrow, with its time", [order({ status: "scheduled", scheduledFor: "2026-11-03T10:00" })], "🔧 The landlord's coming tomorrow (10am) about the leaking kitchen sink. Someone be home?"],
    ["a visit tomorrow without a time", [order({ status: "scheduled", scheduledFor: "2026-11-03" })], "🔧 The landlord's coming tomorrow about the leaking kitchen sink. Someone be home?"],
    ["a visit the day after: not yet", [order({ status: "scheduled", scheduledFor: "2026-11-04T10:00" })], null],
    ["quiet 5 local days", [order({ lastActivityAt: new Date("2026-10-28T20:00:00Z") })], "📭 Nothing from the landlord about the leaking kitchen sink in 5 days. Want me to follow up?"],
    ["quiet 4 days: not yet", [order({ lastActivityAt: new Date("2026-10-29T20:00:00Z") })], null],
    ["quiet 6 days: offered yesterday, not again", [order({ lastActivityAt: new Date("2026-10-27T20:00:00Z") })], null],
    ["quiet 10 days: offered again", [order({ lastActivityAt: new Date("2026-10-23T20:00:00Z") })], "📭 Nothing from the landlord about the leaking kitchen sink in 10 days. Want me to follow up?"],
    ["done orders say nothing", [order({ status: "done", lastActivityAt: new Date("2026-10-28T20:00:00Z") })], null],
  ];
  for (const [name, orders, want] of table) test(name, () => assert.equal(leaseBundleText(orders, TZ, MONDAY_9AM), want));

  test("a visit and a quiet one: both, the visit first", () => {
    const line = leaseBundleText([order({ title: "the broken blinds", lastActivityAt: new Date("2026-10-28T20:00:00Z") }), order({ status: "scheduled", scheduledFor: "2026-11-03T14:30" })], TZ, MONDAY_9AM);
    assert.equal(line, "🔧 The landlord's coming tomorrow (2:30pm) about the leaking kitchen sink. Someone be home? 📭 Nothing from the landlord about the broken blinds in 5 days. Want me to follow up?");
  });
});

test("leaseReportText", () => {
  assert.equal(leaseReportText(0, 0), null);
  assert.equal(leaseReportText(1, 2), "Lease inbox: 1 notice, 2 other emails");
  assert.equal(leaseReportText(2, 0), "Lease inbox: 2 notices");
  assert.equal(leaseReportText(0, 1), "Lease inbox: 1 other email");
});

test("saysYes: the Member's own words confirm, never the model's", () => {
  for (const yes of ["yes", "roomie yes send it", "yep go ahead", "ok", "that's right, send it"]) assert.equal(saysYes(yes), true, yes);
  for (const no of [undefined, "", "no", "wait, don't send it", "hold on", "tell them we're not renewing", "yes but don't send it yet"]) assert.equal(saysYes(no), false, String(no));
});

test("attachmentKind", () => {
  assert.equal(attachmentKind("other", null, "Lease_Agreement_Apt4B_2026.pdf"), "lease");
  assert.equal(attachmentKind("notice", null, "inspection-notice.pdf"), "notice");
  assert.equal(attachmentKind("rent-lease", null, "letter.pdf"), "lease");
  assert.equal(attachmentKind("other", "electric", "statement.pdf"), "bill");
  assert.equal(attachmentKind("other", null, "October_Statement.pdf"), "bill");
  assert.equal(attachmentKind("work-order", null, "photo.jpg"), "email");
});
