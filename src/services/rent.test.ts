// Rent (pure): the due day and the day three before it in the Group's zone, and each person's DM (#25, ADR 0019).
// The DB side (one recurring parent, the Bundle's line and DMs) is in money-rent.dbtest.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedTimeToUtc } from "@/lib/time";
import { owingRent, rentDmsFor, rentGroupLine, rentWindows, shortMoney } from "./rent";

const TZ = "America/Chicago";
const at = (month: number, day: number, hour: number, minute = 0) => zonedTimeToUtc(TZ, { year: 2026, month, day, hour, minute });

test("rentWindows: due the 1st, from the end of October into November (DST ends Nov 1 in Chicago)", () => {
  assert.deepEqual(rentWindows(1, TZ, at(10, 29, 9)), { aheadDay: "2026-10-29", dueDay: "2026-11-01" });
  assert.deepEqual(rentWindows(1, TZ, at(10, 30, 9)), { aheadDay: "2026-10-29", dueDay: "2026-11-01" });
  assert.deepEqual(rentWindows(1, TZ, at(10, 31, 23, 30)), { aheadDay: "2026-10-29", dueDay: "2026-11-01" }, "Oct 31 late at night is still October locally (Nov 1 in UTC)");
  assert.deepEqual(rentWindows(1, TZ, at(11, 1, 0, 30)), { aheadDay: "2026-10-29", dueDay: "2026-11-01" }, "just after midnight on the due day");
  assert.deepEqual(rentWindows(1, TZ, at(11, 1, 23)), { aheadDay: "2026-10-29", dueDay: "2026-11-01" }, "after the fall-back hour, still the due day");
  assert.deepEqual(rentWindows(1, TZ, at(11, 2, 9)), { aheadDay: "2026-11-28", dueDay: "2026-12-01" }, "the day after: next month");
});

test("rentWindows: the 31st clamps to the 28th, and the ahead day can fall in the month before", () => {
  assert.deepEqual(rentWindows(31, TZ, at(2, 10, 9)), { aheadDay: "2026-02-25", dueDay: "2026-02-28" });
  assert.deepEqual(rentWindows(2, TZ, at(10, 30, 9)), { aheadDay: "2026-10-30", dueDay: "2026-11-02" });
  assert.deepEqual(rentWindows(15, TZ, at(10, 15, 9)), { aheadDay: "2026-10-12", dueDay: "2026-10-15" }, "today is the due day");
  assert.deepEqual(rentWindows(1, "Asia/Kolkata", new Date("2026-10-31T20:00:00Z")), { aheadDay: "2026-10-29", dueDay: "2026-11-01" }, "already Nov 1 in Kolkata: due today");
});

test("shortMoney drops .00 only", () => {
  assert.equal(shortMoney(240000), "$2,400");
  assert.equal(shortMoney(80050), "$800.50");
});

test("the group line names the day and who pays the landlord, never a share", () => {
  assert.equal(rentGroupLine({ cents: 240000, payerName: "Maya" }, "2026-11-07"), "🏠 Rent $2,400 is due Saturday. Maya pays the landlord.");
});

const rent = {
  cents: 240000,
  payerId: "maya",
  payerName: "Maya",
  shares: [
    { memberId: "maya", name: "Maya", cents: 100000 },
    { memberId: "dev", name: "Dev", cents: 80000 },
    { memberId: "sam", name: "Sam", cents: 60000 },
  ],
};

test("rentDmsFor: one DM per share except the Payer's, own amount only, pay links to the Payer", () => {
  const dms = rentDmsFor(rent, { venmo: "maya-k" }, "2026-11-01");
  assert.deepEqual(dms.map((d) => d.memberId), ["dev", "sam"], "never Maya");
  assert.equal(dms.reduce((s, d) => s + d.cents, 0) + 100000, rent.cents, "the shares sum to the rent to the cent");
  assert.equal(dms[0].text, "Rent's due Sunday: your share is $800. Maya pays the landlord, so pay Maya.");
  assert.equal(dms[1].text, "Rent's due Sunday: your share is $600. Maya pays the landlord, so pay Maya.");
  assert.ok(!dms[0].text.includes("$600") && !dms[1].text.includes("$800"), "nobody sees anyone else's number");
  assert.deepEqual(dms[0].buttons, [{ text: "Pay Maya on Venmo", url: "https://venmo.com/u/maya-k?txn=pay&amount=800.00&note=Rent" }]);
});

test("rentDmsFor: no handle, no button, and the text says how to add one", () => {
  const [dev] = rentDmsFor(rent, {}, "2026-11-01");
  assert.deepEqual(dev.buttons, []);
  assert.match(dev.text, /\$800/);
  assert.match(dev.text, /no pay link yet: Maya can tell me their Venmo, PayPal or Cash App/);
});

test("owingRent: only this month's Shares against what was paid the Payer since the DMs went out", () => {
  const since = "2026-10-29";
  // Dev paid his $800 on the ahead day; Sam paid $200 of $600, and earlier $600 last month (before `since`).
  const paid = [
    { fromId: "dev", toId: "maya", cents: 80000, day: "2026-10-29" },
    { fromId: "sam", toId: "maya", cents: 20000, day: "2026-10-31" },
    { fromId: "sam", toId: "maya", cents: 60000, day: "2026-10-01" },
  ];
  assert.deepEqual(owingRent("maya", rent.shares, paid, since), ["Sam"]);
  // Sam pays the rest on the due day: nobody's named.
  assert.deepEqual(owingRent("maya", rent.shares, [...paid, { fromId: "sam", toId: "maya", cents: 40000, day: "2026-11-01" }], since), []);
  // Sam paying Dev (the Settle plan routing a debt elsewhere) doesn't pay Maya's rent.
  assert.deepEqual(owingRent("maya", rent.shares, [{ fromId: "sam", toId: "dev", cents: 60000, day: "2026-11-01" }], since), ["Dev", "Sam"]);
  assert.deepEqual(owingRent("maya", rent.shares, [], since), ["Dev", "Sam"], "never the Payer");
});