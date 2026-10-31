// Recurring Expenses: when a copy is due (pure). The DB side (one copy per period) is in tools.dbtest.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { amountAskText, latestOccurrence, variableAsk } from "./recurring";

test("monthly: same day of the month, nothing before the first period", () => {
  assert.equal(latestOccurrence("2026-01-15", "monthly", "2026-01-15"), null);
  assert.equal(latestOccurrence("2026-01-15", "monthly", "2026-02-14"), null);
  assert.equal(latestOccurrence("2026-01-15", "monthly", "2026-02-15"), "2026-02-15");
  assert.equal(latestOccurrence("2026-01-15", "monthly", "2026-03-10"), "2026-02-15", "only the latest due copy, never the future one");
  assert.equal(latestOccurrence("2026-11-20", "monthly", "2027-01-25"), "2027-01-20", "across a year end");
});

test("monthly: days after the 28th clamp to the 28th so February has one too", () => {
  assert.equal(latestOccurrence("2026-01-31", "monthly", "2026-01-31"), null);
  assert.equal(latestOccurrence("2026-01-31", "monthly", "2026-02-27"), null);
  assert.equal(latestOccurrence("2026-01-31", "monthly", "2026-02-28"), "2026-02-28");
  assert.equal(latestOccurrence("2026-01-31", "monthly", "2026-03-31"), "2026-03-28");
});

test("weekly: same weekday", () => {
  assert.equal(latestOccurrence("2026-10-05", "weekly", "2026-10-11"), null);
  assert.equal(latestOccurrence("2026-10-05", "weekly", "2026-10-12"), "2026-10-12");
  assert.equal(latestOccurrence("2026-10-05", "weekly", "2026-10-28"), "2026-10-26");
  assert.equal(new Date("2026-10-26T12:00:00Z").getUTCDay(), new Date("2026-10-05T12:00:00Z").getUTCDay());
});

test("idempotent by period: every day of a period maps to the same copy date", () => {
  const seen = new Set<string>();
  for (let d = 15; d <= 28; d++) seen.add(latestOccurrence("2026-01-15", "monthly", `2026-02-${String(d).padStart(2, "0")}`)!);
  for (let d = 1; d <= 14; d++) seen.add(latestOccurrence("2026-01-15", "monthly", `2026-03-${String(d).padStart(2, "0")}`)!);
  assert.deepEqual([...seen], ["2026-02-15"]);
});

/* ---------- variable Expenses (#25): the amount is asked, not copied ---------- */


test("variableAsk: ask on the due day, the parent's own first month included", () => {
  assert.deepEqual(variableAsk("2026-11-20", "2026-11-19", null), null, "not due yet");
  assert.deepEqual(variableAsk("2026-11-20", "2026-11-20", null), { kind: "ask", dueOn: "2026-11-20" }, "the first month is asked too");
  assert.deepEqual(variableAsk("2026-11-20", "2026-12-20", null), { kind: "ask", dueOn: "2026-12-20" });
  assert.deepEqual(variableAsk("2026-11-20", "2026-12-20", { asks: 1, askedDay: "2026-12-20", resolved: false }), null, "asked once today already");
});

test("variableAsk: once more the next day, then nothing until next month", () => {
  const asked = { asks: 1, askedDay: "2026-12-20", resolved: false };
  assert.deepEqual(variableAsk("2026-11-20", "2026-12-21", asked), { kind: "reask", dueOn: "2026-12-20" });
  assert.deepEqual(variableAsk("2026-11-20", "2026-12-21", { ...asked, asks: 2, askedDay: "2026-12-21" }), null);
  assert.deepEqual(variableAsk("2026-11-20", "2026-12-22", asked), null, "two days late: dropped for the month");
  assert.deepEqual(variableAsk("2026-11-20", "2026-12-21", { ...asked, resolved: true }), null, "answered");
  assert.deepEqual(variableAsk("2026-11-20", "2026-12-21", null), { kind: "ask", dueOn: "2026-12-20" }, "missed the due day (job was off): ask the next day");
});

test("amountAskText: the bill's name, the prefill when the Lease Inbox read one", () => {
  assert.equal(amountAskText("Electric", null), "How much was the electric bill?");
  assert.equal(amountAskText("Water bill", null), "How much was the water bill?");
  assert.equal(amountAskText("Electric", 9200), "How much was the electric bill? Looks like $92 (from the bill). Right?");
});
