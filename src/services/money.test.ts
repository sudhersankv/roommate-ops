// Pure-function tests for money. No DB: the split methods, Payers, and both kinds of Settle plan.
// Run: npx tsx --test src/services/money.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { computePairwiseDebts, computeSettlePlan, splitEvenly, type Balance, type Transfer } from "./money";
import { apportion, checkPayers, splitExact, splitPercent, splitShares, SplitError } from "./split";

const b = (name: string, cents: number): Balance => ({ memberId: name.toLowerCase(), name, cents });

/** Apply a plan to balances and return the resulting net per member. */
function applyPlan(balances: Balance[], plan: Transfer[]) {
  const net = new Map(balances.map((x) => [x.memberId, x.cents]));
  for (const t of plan) {
    net.set(t.fromId, (net.get(t.fromId) ?? 0) + t.cents); // debtor pays -> balance rises toward 0
    net.set(t.toId, (net.get(t.toId) ?? 0) - t.cents); // creditor receives -> balance falls toward 0
  }
  return net;
}

test("settle plan: empty input -> empty plan", () => {
  assert.deepEqual(computeSettlePlan([]), []);
});

test("settle plan: everyone square -> empty plan", () => {
  assert.deepEqual(computeSettlePlan([b("Maya", 0), b("Dev", 0), b("Sam", 0)]), []);
});

test("settle plan: 3-person classic", () => {
  // Maya paid 90 for everyone (30 each): Maya +60, Dev -30, Sam -30.
  const plan = computeSettlePlan([b("Maya", 6000), b("Dev", -3000), b("Sam", -3000)]);
  assert.equal(plan.length, 2);
  for (const t of plan) {
    assert.equal(t.toName, "Maya");
    assert.equal(t.cents, 3000);
  }
  assert.deepEqual(plan.map((t) => t.fromName).sort(), ["Dev", "Sam"]);
});

test("settle plan: biggest debtor pays biggest creditor first", () => {
  const plan = computeSettlePlan([b("Priya", -7000), b("Leo", 5000), b("Noor", 2000), b("Sam", -1000), b("Maya", 1000)]);
  assert.deepEqual(plan[0], { fromId: "priya", fromName: "Priya", toId: "leo", toName: "Leo", cents: 5000 });
  const net = applyPlan([b("Priya", -7000), b("Leo", 5000), b("Noor", 2000), b("Sam", -1000), b("Maya", 1000)], plan);
  for (const v of net.values()) assert.equal(v, 0);
  // Never more transfers than people minus one for a connected set of balances.
  assert.ok(plan.length <= 4);
});

test("settle plan: zeroes every balance, transfers positive, never pays more than owed", () => {
  const balances = [b("A", 12345), b("B", -2345), b("C", -10000), b("D", 1), b("E", -1), b("F", 0)];
  const plan = computeSettlePlan(balances);
  for (const t of plan) {
    assert.ok(t.cents > 0, "transfers must be positive");
    assert.notEqual(t.fromId, t.toId);
  }
  // Total sent equals total owed by debtors (and total owed to creditors).
  const owed = balances.filter((x) => x.cents < 0).reduce((s, x) => s - x.cents, 0);
  assert.equal(plan.reduce((s, t) => s + t.cents, 0), owed);
  // Each debtor pays exactly their debt; each creditor receives exactly their credit.
  const net = applyPlan(balances, plan);
  for (const v of net.values()) assert.equal(v, 0);
  // Zero-balance members never appear.
  assert.ok(plan.every((t) => t.fromId !== "f" && t.toId !== "f"));
});

test("settle plan: ignores sub-cent (zero) balances and handles single debtor/creditor", () => {
  assert.deepEqual(computeSettlePlan([b("A", 0), b("B", 0), b("C", 250), b("D", -250)]), [
    { fromId: "d", fromName: "D", toId: "c", toName: "C", cents: 250 },
  ]);
});

test("splitEvenly: exact division", () => {
  assert.deepEqual(splitEvenly(900, ["a", "b", "c"], "a"), [
    { memberId: "a", cents: 300 },
    { memberId: "b", cents: 300 },
    { memberId: "c", cents: 300 },
  ]);
});

test("splitEvenly: remainder goes to the payer first, then the rest in order", () => {
  // 10.00 / 3 = 3.33 r 1 -> payer b gets the extra cent.
  assert.deepEqual(splitEvenly(1000, ["a", "b", "c"], "b"), [
    { memberId: "a", cents: 333 },
    { memberId: "b", cents: 334 },
    { memberId: "c", cents: 333 },
  ]);
  // 10.02 / 4 = 2.50 r 2 -> payer c, then a.
  assert.deepEqual(splitEvenly(1002, ["a", "b", "c", "d"], "c"), [
    { memberId: "a", cents: 251 },
    { memberId: "b", cents: 250 },
    { memberId: "c", cents: 251 },
    { memberId: "d", cents: 250 },
  ]);
});

test("splitEvenly: payer not a participant -> remainder in list order; sums always match", () => {
  const rows = splitEvenly(1001, ["a", "b", "c"], "zed");
  assert.deepEqual(rows, [
    { memberId: "a", cents: 334 },
    { memberId: "b", cents: 334 },
    { memberId: "c", cents: 333 },
  ]);
  for (const total of [1, 2, 7, 99, 100, 101, 12345]) {
    for (const n of [1, 2, 3, 4, 5, 7]) {
      const ids = Array.from({ length: n }, (_, i) => `m${i}`);
      const sum = splitEvenly(total, ids, "m0").reduce((s, r) => s + r.cents, 0);
      assert.equal(sum, total, `${total} across ${n}`);
    }
  }
});

test("splitEvenly: dedupes ids and handles empty", () => {
  assert.deepEqual(splitEvenly(300, ["a", "a", "b"]), [
    { memberId: "a", cents: 150 },
    { memberId: "b", cents: 150 },
  ]);
  assert.deepEqual(splitEvenly(300, []), []);
});

/* ---------- step 5: every split method (all pure, ADR 0007) ---------- */

const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);
const names: Record<string, string> = { m: "Maya", d: "Dev", s: "Sam", a: "Alex" };
const nameOf = (id: string) => names[id] ?? id;

test("splitPercent: $90 dinner 50/25/25 -> 4500/2250/2250", () => {
  assert.deepEqual(splitPercent(9000, [{ memberId: "m", percent: 50 }, { memberId: "d", percent: 25 }, { memberId: "s", percent: 25 }], { payerIds: ["m"], nameOf }), [
    { memberId: "m", cents: 4500 },
    { memberId: "d", cents: 2250 },
    { memberId: "s", cents: 2250 },
  ]);
});

test("splitPercent: 33.33 x 3 is within tolerance; the leftover cent goes to the payer", () => {
  const rows = splitPercent(10000, [{ memberId: "d", percent: 33.33 }, { memberId: "s", percent: 33.33 }, { memberId: "m", percent: 33.34 }], { payerIds: ["d"], nameOf });
  assert.equal(sum(rows), 10000);
  assert.deepEqual(rows, [
    { memberId: "d", cents: 3333 },
    { memberId: "s", cents: 3333 },
    { memberId: "m", cents: 3334 },
  ]);
  // Exactly a third each: remainders tie, so the payer gets the cent first.
  const thirds = splitPercent(100, [{ memberId: "s", percent: 100 / 3 }, { memberId: "m", percent: 100 / 3 }, { memberId: "d", percent: 100 / 3 }], { payerIds: ["d"], nameOf });
  assert.deepEqual(Object.fromEntries(thirds.map((r) => [r.memberId, r.cents])), { d: 34, m: 33, s: 33 });
});

test("splitPercent: remainder ties without a payer break by name", () => {
  const rows = splitPercent(101, [{ memberId: "s", percent: 50 }, { memberId: "d", percent: 50 }], { nameOf });
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.memberId, r.cents])), { d: 51, s: 50 }, "Dev before Sam");
});

test("splitPercent: percentages that don't make 100 are refused with what's left", () => {
  assert.throws(() => splitPercent(9000, [{ memberId: "m", percent: 50 }, { memberId: "d", percent: 25 }]), /75%.*25% left/);
  assert.throws(() => splitPercent(9000, [{ memberId: "m", percent: 60 }, { memberId: "d", percent: 50 }]), /110%.*10% over/);
  assert.throws(() => splitPercent(9000, [{ memberId: "m", percent: 50 }, { memberId: "m", percent: 50 }], { nameOf }), /Maya appears twice/);
});

test("splitShares: 2:2:1 on $41.25 -> 1650/1650/825; odd totals still sum exactly", () => {
  assert.deepEqual(splitShares(4125, [{ memberId: "m", shares: 2 }, { memberId: "d", shares: 2 }, { memberId: "s", shares: 1 }], { payerIds: ["m"], nameOf }), [
    { memberId: "m", cents: 1650 },
    { memberId: "d", cents: 1650 },
    { memberId: "s", cents: 825 },
  ]);
  for (const total of [1, 7, 99, 100, 101, 4126, 12345]) {
    const rows = splitShares(total, [{ memberId: "m", shares: 2 }, { memberId: "d", shares: 1.5 }, { memberId: "s", shares: 1 }], { payerIds: ["s"], nameOf });
    assert.equal(sum(rows), total, `${total}`);
  }
  // 1000 at 1:1:1 -> remainders tie -> payer Sam first.
  assert.deepEqual(Object.fromEntries(splitShares(1000, [{ memberId: "m", shares: 1 }, { memberId: "d", shares: 1 }, { memberId: "s", shares: 1 }], { payerIds: ["s"], nameOf }).map((r) => [r.memberId, r.cents])), { m: 333, d: 333, s: 334 });
  assert.throws(() => splitShares(1000, [{ memberId: "m", shares: 0 }]), /at least one share/);
});

test("splitExact: must add up; the error says how much is left or over", () => {
  assert.deepEqual(splitExact(5000, [{ memberId: "m", cents: 3000 }, { memberId: "d", cents: 2000 }, { memberId: "s", cents: 0 }]), [
    { memberId: "m", cents: 3000 },
    { memberId: "d", cents: 2000 },
  ]);
  assert.throws(() => splitExact(5000, [{ memberId: "m", cents: 3000 }, { memberId: "d", cents: 1500 }]), (e: SplitError) => e.remaining === 500 && /\$5\.00 left to assign/.test(e.message));
  assert.throws(() => splitExact(5000, [{ memberId: "m", cents: 3000 }, { memberId: "d", cents: 2500 }]), (e: SplitError) => e.remaining === -500 && /\$5\.00 more/.test(e.message));
});

test("checkPayers: several Payers must cover the total; biggest first is the primary", () => {
  assert.deepEqual(checkPayers(10000, [{ memberId: "m", cents: 4000 }, { memberId: "a", cents: 6000 }]), [
    { memberId: "a", cents: 6000 },
    { memberId: "m", cents: 4000 },
  ]);
  assert.throws(() => checkPayers(10000, [{ memberId: "m", cents: 4000 }, { memberId: "a", cents: 5000 }]), /\$10\.00 unaccounted/);
  assert.throws(() => checkPayers(10000, [{ memberId: "m", cents: 4000 }, { memberId: "a", cents: 7000 }]), /\$10\.00 more/);
});

test("apportion: always sums to the total, never negative, deterministic", () => {
  for (let total = 0; total < 400; total += 37) {
    const rows = apportion(total, [{ memberId: "a", weight: 3 }, { memberId: "b", weight: 7 }, { memberId: "c", weight: 11 }]);
    assert.equal(sum(rows), total);
    assert.ok(rows.every((r) => r.cents >= 0));
    assert.deepEqual(rows, apportion(total, [{ memberId: "a", weight: 3 }, { memberId: "b", weight: 7 }, { memberId: "c", weight: 11 }]));
  }
});

/* ---------- pairwise vs simplified ---------- */

test("pairwise debts: each pair nets what they shared; simplified needs fewer payments", () => {
  // Maya paid 90 for Maya+Dev+Sam (30 each). Dev paid 60 for Dev+Sam (30 each).
  const ledger = [
    { payers: [{ memberId: "m", cents: 9000 }], shares: [{ memberId: "m", cents: 3000 }, { memberId: "d", cents: 3000 }, { memberId: "s", cents: 3000 }] },
    { payers: [{ memberId: "d", cents: 6000 }], shares: [{ memberId: "d", cents: 3000 }, { memberId: "s", cents: 3000 }] },
  ];
  const pairwise = computePairwiseDebts(ledger, [], nameOf);
  const asText = (ts: Transfer[]) => ts.map((t) => `${t.fromName}->${t.toName} ${t.cents}`).sort();
  assert.deepEqual(asText(pairwise), ["Dev->Maya 3000", "Sam->Dev 3000", "Sam->Maya 3000"]);
  // Simplified from the same balances: Maya +6000, Dev 0, Sam -6000 -> one payment.
  assert.deepEqual(asText(computeSettlePlan([b("Maya", 6000), b("Dev", 0), b("Sam", -6000)])), ["Sam->Maya 6000"]);
});

test("pairwise debts: settlements reduce the pair; opposite debts net out; multi-payer owes each payer", () => {
  const ledger = [
    { payers: [{ memberId: "m", cents: 2000 }], shares: [{ memberId: "m", cents: 1000 }, { memberId: "d", cents: 1000 }] },
    { payers: [{ memberId: "d", cents: 600 }], shares: [{ memberId: "m", cents: 300 }, { memberId: "d", cents: 300 }] },
  ];
  assert.deepEqual(computePairwiseDebts(ledger, [{ fromId: "d", toId: "m", cents: 200 }], nameOf), [{ fromId: "d", fromName: "Dev", toId: "m", toName: "Maya", cents: 500 }]);
  assert.deepEqual(computePairwiseDebts(ledger, [{ fromId: "d", toId: "m", cents: 700 }], nameOf), []);
  // $100: Alex paid 60, Maya 40, split 4 ways (25 each): Dev and Sam owe; Alex +35, Maya +15.
  const multi = computePairwiseDebts(
    [{ payers: [{ memberId: "a", cents: 6000 }, { memberId: "m", cents: 4000 }], shares: ["a", "m", "d", "s"].map((memberId) => ({ memberId, cents: 2500 })) }],
    [],
    nameOf,
  );
  const net = new Map<string, number>();
  for (const t of multi) {
    net.set(t.fromId, (net.get(t.fromId) ?? 0) - t.cents);
    net.set(t.toId, (net.get(t.toId) ?? 0) + t.cents);
  }
  assert.deepEqual(Object.fromEntries([...net].sort()), { a: 3500, d: -2500, m: 1500, s: -2500 });
});

test("pairwise and simplified plans both zero every balance", () => {
  const ledger = [
    { payers: [{ memberId: "m", cents: 12345 }], shares: splitEvenly(12345, ["m", "d", "s", "a"], "m") },
    { payers: [{ memberId: "d", cents: 777 }, { memberId: "s", cents: 223 }], shares: splitEvenly(1000, ["m", "d", "s"], "d") },
    { payers: [{ memberId: "a", cents: 5000 }], shares: splitPercent(5000, [{ memberId: "a", percent: 10 }, { memberId: "s", percent: 90 }]) },
  ];
  const paid = [{ fromId: "s", toId: "m", cents: 1000 }];
  const bal = new Map<string, number>();
  const add = (id: string, c: number) => bal.set(id, (bal.get(id) ?? 0) + c);
  for (const e of ledger) {
    for (const p of e.payers) add(p.memberId, p.cents);
    for (const s of e.shares) add(s.memberId, -s.cents);
  }
  for (const s of paid) {
    add(s.fromId, s.cents);
    add(s.toId, -s.cents);
  }
  const balances = [...bal].map(([id, cents]) => ({ memberId: id, name: nameOf(id), cents }));
  for (const plan of [computePairwiseDebts(ledger, paid, nameOf), computeSettlePlan(balances)]) {
    const net = applyPlan(balances, plan);
    for (const v of net.values()) assert.equal(v, 0);
  }
});
