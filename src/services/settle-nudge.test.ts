// The Settle nudge (pure, #25): who gets a private "you owe X" DM, from pairwise debts and when each was run up.
// The DB side (once a week in the report hour, opted-out Members skipped) is in money-rent.dbtest.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { Transfer } from "./money";
import { contributionsOf, nudgeCandidates, nudgeText, readNudgeSettings, validateNudgeSettings, type LedgerDates } from "./settle-nudge";

const NOW = new Date("2026-11-01T23:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const names: Record<string, string> = { m: "Maya", d: "Dev", s: "Sam", a: "Alex" };
const debt = (from: string, to: string, cents: number): Transfer => ({ fromId: from, fromName: names[from], toId: to, toName: names[to], cents });
const owed = (from: string, to: string, cents: number, ago: number) => ({ fromId: from, toId: to, cents, at: daysAgo(ago) });
const ledger = (contributions: LedgerDates["contributions"], settlements: LedgerDates["settlements"] = []): LedgerDates => ({ contributions, settlements });

type Row = { name: string; debts: Transfer[]; ledger: LedgerDates; opts?: Parameters<typeof nudgeCandidates>[3]; want: string[] };
const table: Row[] = [
  { name: "$20.00 isn't over the line", debts: [debt("d", "m", 2000)], ledger: ledger([owed("d", "m", 2000, 10)]), want: [] },
  { name: "$20.01 is", debts: [debt("d", "m", 2001)], ledger: ledger([owed("d", "m", 2001, 10)]), want: ["d->m 2001"] },
  { name: "6 days is too fresh", debts: [debt("d", "m", 5000)], ledger: ledger([owed("d", "m", 5000, 6)]), want: [] },
  { name: "7 days is a week", debts: [debt("d", "m", 5000)], ledger: ledger([owed("d", "m", 5000, 7)]), want: ["d->m 5000"] },
  { name: "8 days", debts: [debt("d", "m", 5000)], ledger: ledger([owed("d", "m", 5000, 8)]), want: ["d->m 5000"] },
  {
    name: "the oldest unsettled contribution counts: old ones paid off first",
    debts: [debt("d", "m", 3000)],
    ledger: ledger([owed("d", "m", 4000, 20), owed("d", "m", 3000, 3)], [{ fromId: "d", toId: "m", at: daysAgo(15) }]),
    want: [],
  },
  {
    name: "a partial Settlement resets the age",
    debts: [debt("d", "m", 3000)],
    ledger: ledger([owed("d", "m", 5000, 14)], [{ fromId: "d", toId: "m", at: daysAgo(2) }]),
    want: [],
  },
  {
    name: "a Settlement the other way doesn't reset it",
    debts: [debt("d", "m", 5000)],
    ledger: ledger([owed("d", "m", 5000, 14)], [{ fromId: "m", toId: "d", at: daysAgo(2) }]),
    want: ["d->m 5000"],
  },
  {
    name: "two creditors: one DM per pair",
    debts: [debt("s", "m", 3400), debt("s", "d", 2500)],
    ledger: ledger([owed("s", "m", 3400, 14), owed("s", "d", 2500, 9)]),
    want: ["s->m 3400", "s->d 2500"],
  },
  {
    name: "an opted-out Member gets nothing; the others still do",
    debts: [debt("s", "m", 3400), debt("d", "m", 3000)],
    ledger: ledger([owed("s", "m", 3400, 14), owed("d", "m", 3000, 14)]),
    opts: { optedOut: new Set(["s"]) },
    want: ["d->m 3000"],
  },
  {
    name: "the Group's own threshold",
    debts: [debt("d", "m", 1500)],
    ledger: ledger([owed("d", "m", 1500, 4)]),
    opts: { thresholdCents: 1000, thresholdDays: 3 },
    want: ["d->m 1500"],
  },
];

for (const row of table) {
  test(`nudgeCandidates: ${row.name}`, () => {
    const got = nudgeCandidates(row.debts, row.ledger, NOW, row.opts).map((c) => `${c.fromId}->${c.toId} ${c.cents}`);
    assert.deepEqual(got, row.want);
  });
}

test("contributionsOf: each Expense's Shares owed to its Payers, dated by the day it happened", () => {
  const got = contributionsOf([
    { occurredOn: "2026-10-20", payers: [{ memberId: "m", cents: 9000 }], shares: [{ memberId: "m", cents: 3000 }, { memberId: "d", cents: 3000 }, { memberId: "s", cents: 3000 }] },
  ]);
  assert.deepEqual(
    got.map((c) => `${c.fromId}->${c.toId} ${c.cents} ${c.at.toISOString().slice(0, 10)}`).sort(),
    ["d->m 3000 2026-10-20", "s->m 3000 2026-10-20"],
  );
});

test("nudgeText: the amount and who, private; no handle means no link and how to add one", () => {
  const c = { fromId: "s", fromName: "Sam", toId: "m", toName: "Maya", cents: 3400, since: daysAgo(14) };
  assert.equal(nudgeText(c, true), `Quick one: you owe Maya $34.00. Tap to pay, then say "paid" here.`);
  assert.equal(nudgeText(c, false), `Quick one: you owe Maya $34.00. No pay link yet: Maya can tell me their Venmo, PayPal or Cash App. Say "paid" here once it's done.`);
});

test("nudge settings: defaults, validation", () => {
  assert.deepEqual(readNudgeSettings(undefined), { thresholdCents: 2000, thresholdDays: 7, enabled: true });
  assert.deepEqual(readNudgeSettings({ nudge: { thresholdCents: 500, enabled: false } }), { thresholdCents: 500, thresholdDays: 7, enabled: false });
  assert.deepEqual(readNudgeSettings({ nudge: { thresholdCents: -1, thresholdDays: "x" } }), { thresholdCents: 2000, thresholdDays: 7, enabled: true });
  assert.throws(() => validateNudgeSettings({ thresholdDays: 0 }), /1 to 60 days/);
  assert.throws(() => validateNudgeSettings({ thresholdCents: 12.5 }), /whole cents/);
  assert.deepEqual(validateNudgeSettings({ enabled: false }), { enabled: false });
});
