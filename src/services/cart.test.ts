// Pure-function tests for the cart. No DB: the split by who added what, Instacart lines, Activity wording.
// Run: npx tsx --test src/services/cart.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { cartListText, computeCartSplits, itemList, lineItemFor, type SplitItem } from "./cart";

const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);
const by = (rows: { memberId: string; cents: number }[]) => Object.fromEntries(rows.map((r) => [r.memberId, r.cents]));

/* ---------- computeCartSplits ---------- */

const item = (addedBy: string, shared = false, estCents: number | null = null): SplitItem => ({ addedBy, shared, estCents });
const ACTIVE = ["a", "b", "c"];

test("splits: one share per item, each person pays for their own, scaled to the real total", () => {
  const rows = computeCartSplits([item("a"), item("b"), item("b"), item("b")], ACTIVE, 8000, "a");
  assert.deepEqual(by(rows), { a: 2000, b: 6000 });
  assert.equal(sum(rows), 8000);
});

test("splits: old estimates are ignored (no prices in the Cart)", () => {
  const rows = computeCartSplits([item("a", false, 1000), item("b", false, 3000)], ACTIVE, 8000, "a");
  assert.deepEqual(by(rows), { a: 4000, b: 4000 });
});

test("splits: shared items split evenly across active members", () => {
  assert.deepEqual(by(computeCartSplits([item("a", true)], ACTIVE, 900, "a")), { a: 300, b: 300, c: 300 });
  // a's own item + one shared: a 1 + 1/3, b 1/3, c 1/3 of 2 items.
  assert.deepEqual(by(computeCartSplits([item("a"), item("b", true)], ACTIVE, 900, "b")), { a: 600, b: 150, c: 150 });
});

test("splits: sums exactly to total; remainder cents go to the payer first", () => {
  const rows = computeCartSplits([item("a", true)], ACTIVE, 1000, "c");
  assert.equal(sum(rows), 1000);
  assert.deepEqual(by(rows), { a: 333, b: 333, c: 334 });
  const rows2 = computeCartSplits([item("a"), item("b")], ACTIVE, 1001, "c");
  assert.equal(sum(rows2), 1001);
  assert.deepEqual(Object.keys(by(rows2)).sort(), ["a", "b"]);
});

test("splits: always exact for awkward totals", () => {
  const items = [item("a"), item("b"), item("c"), item("a", true), item("b", true)];
  for (const total of [1, 2, 3, 7, 99, 101, 1337, 12345, 99999]) {
    for (const payer of ACTIVE) {
      const rows = computeCartSplits(items, ACTIVE, total, payer);
      assert.equal(sum(rows), total, `total ${total} payer ${payer}`);
      assert.ok(rows.every((r) => Number.isInteger(r.cents) && r.cents >= 0));
      assert.equal(new Set(rows.map((r) => r.memberId)).size, rows.length, "no duplicate members");
    }
  }
});

test("splits: zero-weight members are omitted; items from inactive adders count as shared", () => {
  const rows = computeCartSplits([item("a"), item("gone")], ACTIVE, 600, "a");
  // 'gone' isn't active: their item is shared (100 each). a: 300 + 100.
  assert.deepEqual(by(rows), { a: 400, b: 100, c: 100 });
  assert.ok(!("gone" in by(rows)));
});

test("splits: a Recipe's shared ingredients next to personal items", () => {
  const recipe = [item("a", true), item("a", true), item("a", true)];
  const rows = computeCartSplits([...recipe, item("a"), item("b")], ACTIVE, 5000, "a");
  // 5 items, 1000 each: the 3 shared are 1000 a head; a +1000, b +1000.
  assert.deepEqual(by(rows), { a: 2000, b: 2000, c: 1000 });
});

test("splits: empty cart or no active members -> no rows", () => {
  assert.deepEqual(computeCartSplits([], ACTIVE, 100, "a"), []);
  assert.deepEqual(computeCartSplits([item("a")], [], 100, "a"), []);
});

/* ---------- Instacart lines and Activity wording ---------- */

test("lineItemFor: a Cart item -> an Instacart line (structured amount, else parsed qty, else 1 each)", () => {
  assert.deepEqual(lineItemFor({ name: "Ground turkey", qty: "2 lb", quantity: 2, unit: "pound" }), { name: "ground turkey", displayText: "Ground turkey (2 lb)", measurements: [{ quantity: 2, unit: "pound" }] });
  assert.deepEqual(lineItemFor({ name: "Oat milk", qty: "2 cartons", quantity: null, unit: null }).measurements, [{ quantity: 2, unit: "package" }]);
  assert.deepEqual(lineItemFor({ name: "Dish soap", qty: "1", quantity: null, unit: null }), { name: "dish soap", displayText: "Dish soap", measurements: [{ quantity: 1, unit: "each" }] });
  assert.deepEqual(lineItemFor({ name: "Salsa", qty: "a jar", quantity: null, unit: null }).measurements, [{ quantity: 1, unit: "each" }]);
});

/* ---------- the Cart as a list (#38) ---------- */

const it = (name: string, qty: string, shared: boolean, addedByName: string) => ({ name, qty, shared, addedByName });

test("cartListText: the Group's name, shared things first in the order they went in, then each person's labelled", () => {
  const items = [
    it("Pepsi", "12 × 12 oz cans", false, "Sam"),
    it("Whole milk", "1 gallon", true, "Maya"),
    it("Oat milk", "2 cartons", false, "Dev"),
    it("Dish soap", "1", true, "Dev"),
    it("Protein bars", "1 box", false, "Dev"),
    it("Sourdough bread", "1 loaf", true, "Sam"),
  ];
  assert.equal(
    cartListText("Apt 4B", items),
    ["Apt 4B shopping list", "☐ Whole milk, 1 gallon", "☐ Dish soap", "☐ Sourdough bread, 1 loaf", "☐ Oat milk, 2 cartons (Dev)", "☐ Protein bars, 1 box (Dev)", "☐ Pepsi, 12 × 12 oz cans (Sam)"].join("\n"),
  );
});

test("cartListText: quantities as stored; an empty Cart says so plainly", () => {
  assert.equal(cartListText("Apt 4B", [it("Ground beef", "1 lb", true, "Maya"), it("Limes", "4", true, "Maya")]), "Apt 4B shopping list\n☐ Ground beef, 1 lb\n☐ Limes, 4");
  assert.equal(cartListText("Apt 4B", []), "Apt 4B's Cart is empty: nothing to buy.");
});

test("itemList: short lists for Activity lines", () => {
  assert.equal(itemList(["Eggs"]), "eggs");
  assert.equal(itemList(["Eggs", "milk"]), "eggs and milk");
  assert.equal(itemList(["eggs", "milk", "bread"]), "eggs, milk and bread");
  assert.equal(itemList(["eggs", "milk", "bread", "salsa", "chips"]), "eggs, milk, bread and 2 more");
});
