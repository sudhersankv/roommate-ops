// Cart quantities: stored as said, asked about only when they can't be read one way.
// Run: npx tsx --test src/lib/units.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clarifyQuantities, parseAmount } from "./units";

test("clarifyQuantities: plain quantities go through as said", () => {
  const items = [{ name: "oat milk", qty: "2 cartons" }, { name: "eggs", qty: "12" }, { name: "chicken", qty: "1 lb" }, { name: "bread" }];
  assert.deepEqual(clarifyQuantities(items), { ok: items, questions: [] });
});

test("clarifyQuantities: several bare numbers for one thing ask one question", () => {
  const r = clarifyQuantities([{ name: "milk" }, { name: "eggs", qty: "12, 18" }]);
  assert.deepEqual(r.ok, [{ name: "milk" }]);
  assert.deepEqual(r.questions, ["eggs: 12 and 18 what? cartons or eggs?"]);
  assert.deepEqual(clarifyQuantities([{ name: "Eggs", qty: "12 or 18" }]).questions, ["eggs: 12 and 18 what? cartons or eggs?"]);
});

test("clarifyQuantities: the same thing twice with different counts is one question", () => {
  const r = clarifyQuantities([{ name: "eggs", qty: "12" }, { name: "eggs", qty: "18" }, { name: "salsa", qty: "2" }]);
  assert.deepEqual(r.ok, [{ name: "salsa", qty: "2" }]);
  assert.deepEqual(r.questions, ["eggs: 12 and 18 what? cartons or eggs?"]);
});

test("clarifyQuantities: units, sizes and the same count twice aren't ambiguous", () => {
  assert.deepEqual(clarifyQuantities([{ name: "chips", qty: "2 bags" }, { name: "chips", qty: "1 bag" }]).questions, []);
  assert.deepEqual(clarifyQuantities([{ name: "limes", qty: "4" }, { name: "limes", qty: "4" }]).questions, []);
  assert.deepEqual(clarifyQuantities([{ name: "flour", qty: "1/2 cup" }]).questions, []);
  assert.equal(clarifyQuantities([{ name: "tortillas", qty: "10, 20" }]).questions[0], "tortillas: 10 and 20 what? packs or tortillas?");
});

test("parseAmount: what the Cart stores next to the free text", () => {
  assert.deepEqual(parseAmount("2 cartons"), { quantity: 2, unit: "package" });
  assert.deepEqual(parseAmount("12"), { quantity: 12, unit: "each" });
  assert.deepEqual(parseAmount("1 lb"), { quantity: 1, unit: "pound" });
  assert.equal(parseAmount("a jar"), null);
});
