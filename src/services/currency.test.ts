// Amounts are said in the Group's currency (live test #8: an INR Group heard "$190.00"). Pure formatters only; the
// services read the Group's currency and pass it down. Run: npx tsx --test src/services/currency.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterPrivateRun } from "./dm-rules";
import { expenseSummary, type Expense } from "./money";
import { shortMoney } from "./rent";
import { nudgeText } from "./settle-nudge";
import { SplitError, checkPayers, splitExact } from "./split";

const pizza = {
  id: "e1",
  description: "Thali",
  cents: 19000,
  variable: false,
  occurredOn: "2026-10-31",
  category: "food",
  method: "equal",
  payers: [{ memberId: "a", name: "Sudhersan", cents: 19000 }],
  splits: [
    { memberId: "a", name: "Sudhersan", cents: 9500, weight: null },
    { memberId: "b", name: "Sreyas", cents: 9500, weight: null },
  ],
} as unknown as Expense;

test("an Expense reads back in the Group's currency; USD stays the default", () => {
  const inr = expenseSummary(pizza, "INR");
  assert.equal(inr.total, "₹190.00");
  assert.deepEqual(inr.paidBy, [{ name: "Sudhersan", paid: "₹190.00" }]);
  assert.equal(inr.shares[1].owes, "₹95.00");
  assert.equal(expenseSummary(pizza).total, "$190.00");
  assert.equal(expenseSummary(pizza, "EUR").total, "€190.00");
});

test("the DM echo and the private 'paid you' line use the Group's currency", () => {
  const out = afterPrivateRun(
    [
      { kind: "expense.added", actorId: "a", actorName: "Sudhersan", summary: "", expense: { cents: 19000, description: "thali", shareCount: 2 } },
      { kind: "settlement.added", actorId: "a", actorName: "Sudhersan", summary: "", settlement: { fromId: "a", fromName: "Sudhersan", toId: "b", cents: 9500 } },
    ] as never,
    "INR",
  );
  assert.equal(out.echo, "Sudhersan logged ₹190.00 thali, split 2 ways.");
  assert.equal(out.privately[0].text, "Sudhersan paid you ₹95.00.");
});

test("the settle nudge, the rent line and split errors say rupees in an INR Group", () => {
  assert.match(nudgeText({ toName: "Sreyas", cents: 9500 }, true, "INR"), /you owe Sreyas ₹95\.00\./);
  assert.equal(shortMoney(2400000, "INR"), "₹24,000");
  assert.equal(shortMoney(240000), "$2,400");
  assert.throws(() => splitExact(19000, [{ memberId: "a", cents: 9000 }], { currency: "INR" }), (e: unknown) => e instanceof SplitError && /₹90\.00 but the total is ₹190\.00: ₹100\.00 left/.test(e.message));
  assert.throws(() => checkPayers(19000, [{ memberId: "a", cents: 20000 }], undefined, "INR"), /₹200\.00, ₹10\.00 more than the ₹190\.00 total/);
});

test("the instructions tell Roomie the Group's currency, and no line says amounts are dollars", async () => {
  const { roomieInstructions } = await import("@/mastra/agents/instructions");
  const text = roomieInstructions({ memberName: "Sudhersan" }, "Sudhersan, Sreyas", new Date(0), "Asia/Kolkata", { currency: "INR" });
  assert.match(text, /Money in this group is INR \(₹\)/);
  assert.doesNotMatch(text, /\bin dollars\b/i);
});
