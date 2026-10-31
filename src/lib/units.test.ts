// Cart quantities: stored as said, asked about only when they can't be read one way.
// Run: npx tsx --test src/lib/units.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clarifyQuantities, countQuestion, kindQuestion, parseAmount } from "./units";

test("clarifyQuantities: plain quantities go through as said", () => {
  const items = [{ name: "oat milk", qty: "2 cartons" }, { name: "eggs", qty: "12" }, { name: "chicken", qty: "1 lb" }, { name: "limes" }];
  assert.deepEqual(clarifyQuantities(items), { ok: items, questions: [] });
});

test("clarifyQuantities: several bare numbers for one thing ask one question", () => {
  const r = clarifyQuantities([{ name: "dish soap" }, { name: "eggs", qty: "12, 18" }]);
  assert.deepEqual(r.ok, [{ name: "dish soap" }]);
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

test("countQuestion: eggs with no count ask 12 or 18; other things don't", () => {
  assert.equal(countQuestion("eggs"), "eggs: 12 or 18?");
  assert.equal(countQuestion("Large Eggs"), "eggs: 12 or 18?");
  assert.equal(countQuestion("egg"), "eggs: 12 or 18?");
  assert.equal(countQuestion("milk"), null);
  assert.equal(countQuestion("eggplant"), null);
});

test("clarifyQuantities: eggs with no quantity ask once; with one they go in", () => {
  const r = clarifyQuantities([{ name: "eggs" }, { name: "dish soap" }]);
  assert.deepEqual(r.ok, [{ name: "dish soap" }]);
  assert.deepEqual(r.questions, ["eggs: 12 or 18?"]);
  assert.deepEqual(clarifyQuantities([{ name: "eggs", qty: "18" }]).questions, []);
  assert.deepEqual(clarifyQuantities([{ name: "eggs", qty: "a dozen" }]).questions, []);
  // Twice in one message is still one question.
  assert.deepEqual(clarifyQuantities([{ name: "eggs" }, { name: "Eggs" }]).questions, ["eggs: 12 or 18?"]);
});

test("kindQuestion: drinks and coffee get one question with two picks; staples go straight in", () => {
  assert.equal(kindQuestion("Pepsi"), "Pepsi: 12-pack of cans or a 2-liter?");
  assert.equal(kindQuestion("Diet Pepsi"), "Diet Pepsi: 12-pack of cans or a 2-liter?");
  assert.equal(kindQuestion("sparkling water"), "sparkling water: a 12-pack or just a few?");
  assert.equal(kindQuestion("water"), "water: a case of bottles or a gallon jug?");
  assert.equal(kindQuestion("coffee"), "coffee: beans or ground?");
  // Staples: what main's examples add as is ("Added milk, 1 gal.", "Added paper towels.").
  for (const staple of ["milk", "oat milk", "bread", "paper towels", "toilet paper", "dish soap"]) assert.equal(kindQuestion(staple), null, staple);
  assert.equal(kindQuestion("coffee filters"), null, "the last words are the thing");
});

test("clarifyQuantities: kinds are asked about with no quantity, once; not with one; not when kinds is off (a written list)", () => {
  const r = clarifyQuantities([{ name: "Pepsi" }, { name: "dish soap" }, { name: "whole milk", qty: "2 gallons" }]);
  assert.deepEqual(r.questions, ["Pepsi: 12-pack of cans or a 2-liter?"]);
  assert.deepEqual(r.ok.map((i) => i.name), ["dish soap", "whole milk"]);
  assert.deepEqual(clarifyQuantities([{ name: "bread" }, { name: "eggs" }], { kinds: false }).questions, ["eggs: 12 or 18?"]);
});
