// The Lease Inbox Toolkit's pure lines: the Bundle (a visit tomorrow, the follow-up question), the weekly report
// part, the Member's "yes" before a complex send, and an attachment's Document kind. Apt 4B is in Chicago.
// Run: npx tsx --test src/services/lease-inbox-lines.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { sendRule } from "./send-rule";
import { asksFollowUp, attachmentKind, followUpAsk, followUpBody, followUpCandidates, leaseBundleText, leaseReportText, saysYes, type QuietOrder } from "./lease-inbox-rules";

const TZ = "America/Chicago";
// Monday Nov 2 2026, 9:00 in Chicago (after the DST change on Nov 1: UTC-6).
const MONDAY_9AM = new Date("2026-11-02T15:00:00Z");
const order = (over: Partial<QuietOrder>): QuietOrder => ({ title: "the leaking kitchen sink", status: "sent", scheduledFor: null, lastActivityAt: new Date("2026-11-01T15:00:00Z"), ...over });

describe("leaseBundleText", () => {
  const table: [string, QuietOrder[], string | null][] = [
    ["nothing", [], null],
    ["a visit tomorrow, with its time", [order({ status: "scheduled", scheduledFor: "2026-11-03T10:00" })], "The leasing office is coming tomorrow at 10 AM about the leaking kitchen sink. Someone be home?"],
    ["a visit tomorrow without a time", [order({ status: "scheduled", scheduledFor: "2026-11-03" })], "The leasing office is coming tomorrow about the leaking kitchen sink. Someone be home?"],
    ["a visit the day after: not yet", [order({ status: "scheduled", scheduledFor: "2026-11-04T10:00" })], null],
    ["a quiet one without the caller's ask says nothing", [order({ lastActivityAt: new Date("2026-10-28T20:00:00Z") })], null],
  ];
  for (const [name, orders, want] of table) test(name, () => assert.equal(leaseBundleText(orders, TZ, MONDAY_9AM), want));

  test("a visit and the follow-up question: both, the visit first, no emoji", () => {
    const quiet = order({ title: "the broken blinds", lastActivityAt: new Date("2026-10-28T20:00:00Z") });
    const line = leaseBundleText([quiet, order({ status: "scheduled", scheduledFor: "2026-11-03T14:30" })], TZ, MONDAY_9AM, quiet);
    assert.equal(line, "The leasing office is coming tomorrow at 2:30 PM about the leaking kitchen sink. Someone be home? No reply from the leasing office about the broken blinds yet. Want me to follow up?");
  });
});

describe("followUpCandidates: sent, no reply for 2 local days, oldest first", () => {
  const table: [string, Partial<QuietOrder>, boolean][] = [
    ["sent 2 local days ago (Sat evening -> Mon)", { lastActivityAt: new Date("2026-10-31T23:00:00Z") }, true],
    ["sent yesterday", { lastActivityAt: new Date("2026-11-01T15:00:00Z") }, false],
    ["sent late Saturday local (Sunday in UTC): still 2 local days", { lastActivityAt: new Date("2026-11-01T04:30:00Z") }, true],
    ["acknowledged: they replied", { status: "acknowledged", lastActivityAt: new Date("2026-10-20T15:00:00Z") }, false],
    ["scheduled", { status: "scheduled", scheduledFor: "2026-11-10", lastActivityAt: new Date("2026-10-20T15:00:00Z") }, false],
    ["done", { status: "done", lastActivityAt: new Date("2026-10-20T15:00:00Z") }, false],
  ];
  for (const [name, over, want] of table) test(name, () => assert.equal(followUpCandidates([order(over)], TZ, MONDAY_9AM).length === 1, want));

  test("the longest quiet first", () => {
    const a = order({ title: "a", lastActivityAt: new Date("2026-10-30T15:00:00Z") });
    const b = order({ title: "b", lastActivityAt: new Date("2026-10-25T15:00:00Z") });
    assert.deepEqual(followUpCandidates([a, b], TZ, MONDAY_9AM).map((o) => o.title), ["b", "a"]);
  });

  test("the question and the email", () => {
    assert.equal(followUpAsk("the sink"), "No reply from the leasing office about the sink yet. Want me to follow up?");
    const body = followUpBody("Apt 4B", "the leaking kitchen sink");
    assert.match(body, /following up on our work order for Apt 4B: the leaking kitchen sink\./);
    // A yes is the Member's whole instruction: no amount, date or lease term in the email, so the send rule finds it simple.
    const verdict = sendRule({ to: "leasing@brookfield.com", body }, { intent: "maintenance", knownSenders: ["brookfield.com"], memberText: "yes", memberId: "m1", others: [], now: MONDAY_9AM });
    assert.deepEqual(verdict, { ok: true });
  });
});

test("asksFollowUp: a yes or a follow-up ask; no yes, no email", () => {
  for (const yes of ["yes", "yeah go for it", "roomie follow up on the sink", "can you chase them about the sink", "ping the landlord again", "sure"]) assert.equal(asksFollowUp(yes), true, yes);
  for (const no of [undefined, "", "no", "nah", "don't follow up yet", "what's up with the sink?", "lol the sink"]) assert.equal(asksFollowUp(no), false, String(no));
});

test("leaseReportText", () => {
  assert.equal(leaseReportText(0, 0), null);
  assert.equal(leaseReportText(1, 2), "From the leasing office: 1 notice, 2 other emails");
  assert.equal(leaseReportText(2, 0), "From the leasing office: 2 notices");
  assert.equal(leaseReportText(0, 1), "From the leasing office: 1 other email");
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
