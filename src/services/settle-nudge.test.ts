// The Settle nudge (pure, ADR 0021): per pairwise debt, when a private "you owe X" DM is due and what it says. The DB
// side (the Bundle's hour, claims per day and pair, opted-out Members skipped) is in money-rent.dbtest.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Transfer } from "./money";
import {
  contributionsOf,
  episodeOf,
  nudgeDue,
  nudgeText,
  nudgeWindow,
  readNudgeSettings,
  validateNudgeSettings,
  type NudgeHistory,
  type PairLedger,
} from "./settle-nudge";

const NOW = new Date("2026-11-10T15:00:00Z"); // 9 AM in Chicago
const TODAY = "2026-11-10";
const HOUR = 3_600_000;
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * HOUR);
const daysAgo = (n: number) => hoursAgo(24 * n);
const dayAgo = (n: number) => new Date(Date.UTC(2026, 10, 10 - n)).toISOString().slice(0, 10);
const names: Record<string, string> = { m: "Maya", d: "Dev", s: "Sam" };
const debt = (from: string, to: string, cents: number): Transfer => ({ fromId: from, fromName: names[from], toId: to, toName: names[to], cents });
const owed = (from: string, to: string, cents: number, at: Date, description?: string) => ({ fromId: from, toId: to, cents, at, description });
const paid = (from: string, to: string, cents: number, at: Date) => ({ fromId: from, toId: to, cents, at });
const ledger = (contributions: PairLedger["contributions"], settlements: PairLedger["settlements"] = []): PairLedger => ({ contributions, settlements });
const sentOn = (...ago: number[]): NudgeHistory => ago.map((n) => ({ day: dayAgo(n), at: new Date(daysAgo(n).getTime()) }));
const S = { thresholdCents: 500, everyDays: 2, enabled: true };

/* ---------- the episode ---------- */

test("episodeOf: the debt's newest contribution, when it went over the line, the newest descriptions", () => {
  const ep = episodeOf(debt("d", "m", 4073), ledger([owed("d", "m", 2000, daysAgo(3), "Groceries"), owed("d", "m", 2073, hoursAgo(5), "Wifi")]), 500);
  assert.ok(ep);
  assert.equal(ep.start.getTime(), daysAgo(3).getTime(), "over $5 since the first one");
  assert.equal(ep.newestAt.getTime(), hoursAgo(5).getTime());
  assert.deepEqual(ep.descriptions, ["wifi", "groceries"]);
});

test("episodeOf: under the line is no episode; rising over it again starts a new one", () => {
  assert.equal(episodeOf(debt("d", "m", 500), ledger([owed("d", "m", 500, daysAgo(3))]), 500), null, "$5.00 isn't over $5");
  const ep = episodeOf(
    debt("d", "m", 3000),
    ledger([owed("d", "m", 4000, daysAgo(10)), owed("d", "m", 2900, daysAgo(1))], [paid("d", "m", 3900, daysAgo(6))]),
    500,
  );
  assert.equal(ep?.start.getTime(), daysAgo(1).getTime(), "paid down to $1, then over again yesterday");
});

test("episodeOf: a Settlement from the debtor starts the episode again; one the other way doesn't", () => {
  const partial = episodeOf(debt("d", "m", 3000), ledger([owed("d", "m", 5000, daysAgo(10))], [paid("d", "m", 2000, daysAgo(2))]), 500);
  assert.equal(partial?.start.getTime(), daysAgo(2).getTime());
  const other = episodeOf(debt("d", "m", 7000), ledger([owed("d", "m", 5000, daysAgo(10))], [paid("m", "d", 2000, daysAgo(2))]), 500);
  assert.equal(other?.start.getTime(), daysAgo(10).getTime());
});

test("episodeOf: only the contributions that make up what's owed name it, the same thing once", () => {
  const ep = episodeOf(
    debt("d", "m", 3000),
    ledger([owed("d", "m", 4000, daysAgo(20), "Rent"), owed("d", "m", 1500, daysAgo(3), "pizza"), owed("d", "m", 1500, daysAgo(2), "Pizza")], [paid("d", "m", 4000, daysAgo(15))]),
    500,
  );
  assert.deepEqual(ep?.descriptions, ["pizza"]);
});

/* ---------- when a DM is due ---------- */

const ep = (startDays: number, newestHours = startDays * 24) => ({ cents: 4073, start: daysAgo(startDays), newestAt: hoursAgo(newestHours) });
type Row = { name: string; debt: ReturnType<typeof ep>; history?: NudgeHistory; opts?: Partial<Parameters<typeof nudgeDue>[4]>; want: string };
const table: Row[] = [
  { name: "the first: not before the newest contribution is 4 hours old", debt: ep(0, 3), want: "too-soon" },
  { name: "the first: 4 hours is enough", debt: ep(0, 4), want: "step 1" },
  { name: "the first: an old debt", debt: ep(9), want: "step 1" },
  { name: "the second: not the day after", debt: ep(9), history: sentOn(1), want: "waiting" },
  { name: "the second: 2 days after the first", debt: ep(9), history: sentOn(2), want: "step 2" },
  { name: "the third: every 2 days", debt: ep(9), history: sentOn(4, 2), want: "step 3" },
  { name: "the Admin's spacing: every 3 days", debt: ep(9), history: sentOn(2), opts: { everyDays: 3 }, want: "waiting" },
  { name: "every day", debt: ep(9), history: sentOn(1), opts: { everyDays: 1 }, want: "step 2" },
  { name: "already today", debt: ep(9), history: sentOn(0), opts: { everyDays: 1 }, want: "sent-today" },
  { name: "5 at most", debt: ep(20), history: sentOn(10, 8, 6, 4, 2), want: "max" },
  { name: "the fifth still goes", debt: ep(20), history: sentOn(8, 6, 4, 2), want: "step 5" },
  { name: "nudges before the episode started don't count", debt: ep(1), history: sentOn(10, 8, 6, 4, 2), want: "step 1" },
  { name: "under the line", debt: { ...ep(9), cents: 500 }, want: "under" },
  { name: "the Group's own line", debt: { ...ep(9), cents: 1500 }, opts: { thresholdCents: 2000 }, want: "under" },
  { name: "opted out", debt: ep(9), opts: { optedOut: true }, want: "opted-out" },
  { name: "off for the Group", debt: ep(9), opts: { enabled: false }, want: "off" },
];

for (const row of table) {
  test(`nudgeDue: ${row.name}`, () => {
    const got = nudgeDue(row.debt, row.history ?? [], NOW, TODAY, { ...S, ...row.opts });
    assert.equal(got.due ? `step ${got.step}` : got.reason, row.want);
  });
}

test("nudgeWindow: the Bundle's hour, never at night: a nudge hour of 7 or 23 goes at 08:00, none when the morning post is off", () => {
  const chi = (hour: number) => new Date(Date.UTC(2026, 10, 10, hour + 6)); // Chicago is UTC-6 in November
  assert.equal(nudgeWindow(chi(9), "America/Chicago", 9), true);
  assert.equal(nudgeWindow(chi(10), "America/Chicago", 9), false);
  assert.equal(nudgeWindow(chi(7), "America/Chicago", 7), false, "07:00 is quiet hours");
  assert.equal(nudgeWindow(chi(8), "America/Chicago", 7), true);
  assert.equal(nudgeWindow(chi(23), "America/Chicago", 23), false, "23:00 is quiet hours");
  assert.equal(nudgeWindow(chi(8), "America/Chicago", 23), true);
  assert.equal(nudgeWindow(chi(9), "America/Chicago", null), false);
});

/* ---------- what it says ---------- */

test("nudgeText: shorter each time, in the Group's currency", () => {
  const c = { fromName: "Dev Patel", toName: "Maya", cents: 4073, descriptions: ["wifi", "groceries"] };
  assert.equal(nudgeText(1, c, false), "Hey Dev, quick one: $40.73 to Maya for wifi + groceries. Whenever you can.");
  assert.equal(nudgeText(1, { ...c, descriptions: [] }, true), "Hey Dev, quick one: $40.73 to Maya. Whenever you can.");
  assert.equal(nudgeText(2, c, true), "Still $40.73 to Maya.");
  assert.equal(nudgeText(2, c, false), `Still $40.73 to Maya. Say "paid" here once it's done.`);
  assert.equal(nudgeText(3, c, true), "Friendly nudge: $40.73 to Maya.");
  assert.equal(nudgeText(5, c, false), "Friendly nudge: $40.73 to Maya.");
  assert.equal(nudgeText(3, c, false, "INR"), "Friendly nudge: ₹40.73 to Maya.");
});

test("contributionsOf: each Expense's Shares owed to its Payers, dated when it was logged, with its description", () => {
  const at = new Date("2026-11-01T18:00:00Z");
  const got = contributionsOf([
    { at, description: "Costco", payers: [{ memberId: "m", cents: 9000 }], shares: [{ memberId: "m", cents: 3000 }, { memberId: "d", cents: 3000 }, { memberId: "s", cents: 3000 }] },
  ]);
  assert.deepEqual(got.map((c) => `${c.fromId}->${c.toId} ${c.cents} ${c.description}`).sort(), ["d->m 3000 Costco", "s->m 3000 Costco"]);
  assert.ok(got.every((c) => c.at === at));
});

/* ---------- settings ---------- */

test("nudge settings: defaults, an old thresholdDays read as the spacing when it fits, validation", () => {
  assert.deepEqual(readNudgeSettings(undefined), { thresholdCents: 500, everyDays: 2, enabled: true });
  assert.deepEqual(readNudgeSettings({ nudge: { thresholdCents: 2000, thresholdDays: 7, enabled: false } }), { thresholdCents: 2000, everyDays: 7, enabled: false });
  assert.deepEqual(readNudgeSettings({ nudge: { thresholdDays: 30 } }), { thresholdCents: 500, everyDays: 2, enabled: true }, "30 days isn't a spacing");
  assert.deepEqual(readNudgeSettings({ nudge: { everyDays: 3, thresholdDays: 7 } }), { thresholdCents: 500, everyDays: 3, enabled: true }, "everyDays wins");
  assert.deepEqual(readNudgeSettings({ nudge: { thresholdCents: -1, everyDays: "x" } }), { thresholdCents: 500, everyDays: 2, enabled: true });
  assert.throws(() => validateNudgeSettings({ everyDays: 0 }), /1 to 14 days/);
  assert.throws(() => validateNudgeSettings({ everyDays: 15 }), /1 to 14 days/);
  assert.throws(() => validateNudgeSettings({ thresholdCents: 12.5 }), /whole cents/);
  assert.deepEqual(validateNudgeSettings({ enabled: false, everyDays: 4 }), { enabled: false, everyDays: 4 });
});
