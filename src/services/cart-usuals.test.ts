// Usuals: the quantity a Member (or the house) usually adds of a thing, from the Cart's own history.
// Run: npx tsx --test src/services/cart-usuals.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { usualFor, type PastAdd } from "./cart-usuals";

let t = 0;
/** Oldest first, like they happened. */
const add = (name: string, qty: string, who = "dev", shared = false): PastAdd => ({ name, qty, addedBy: who, shared, createdAt: new Date(2026, 9, 1, 0, t++) });
const dev = { memberId: "dev" };
const house = { shared: true as const };

test("usualFor: one past add with a quantity is the usual", () => {
  assert.equal(usualFor("eggs", dev, [add("eggs", "18")]), "18");
});

test("usualFor: nothing said before, or only the default 1, is no usual", () => {
  assert.equal(usualFor("eggs", dev, []), null);
  assert.equal(usualFor("eggs", dev, [add("eggs", "1"), add("eggs", "")]), null);
});

test("usualFor: 2 of the last 3 adds with a quantity agree", () => {
  assert.equal(usualFor("eggs", dev, [add("eggs", "12"), add("eggs", "18"), add("eggs", "12")]), "12");
  // The latest 3 only: two old 12s don't outvote the newer 18s.
  assert.equal(usualFor("eggs", dev, [add("eggs", "12"), add("eggs", "12"), add("eggs", "18"), add("eggs", "6"), add("eggs", "18")]), "18");
});

test("usualFor: two different quantities, or three, is no usual", () => {
  assert.equal(usualFor("eggs", dev, [add("eggs", "12"), add("eggs", "18")]), null);
  assert.equal(usualFor("eggs", dev, [add("eggs", "6"), add("eggs", "12"), add("eggs", "18")]), null);
});

test("usualFor: the same thing under another name counts ('Eggs', '18 eggs'), a different thing doesn't", () => {
  assert.equal(usualFor("Eggs", dev, [add("large eggs", "18")]), "18");
  assert.equal(usualFor("milk", dev, [add("oat milk", "2 cartons")]), null);
  assert.equal(usualFor("milk", dev, [add("Milk", "1 gal")]), "1 gal");
});

test("usualFor: quantities compare as said, case and spaces aside; the newest wording is returned", () => {
  assert.equal(usualFor("milk", dev, [add("milk", "1 Gal"), add("milk", "1 gal")]), "1 gal");
});

test("usualFor: scope: my usual is mine, the house's is the house's", () => {
  const history = [add("milk", "1 gal", "maya", true), add("oat milk", "2 cartons", "dev"), add("milk", "2 gal", "dev")];
  assert.equal(usualFor("milk", house, history), "1 gal");
  assert.equal(usualFor("milk", dev, history), "2 gal");
  assert.equal(usualFor("milk", { memberId: "sam" }, history), null);
  // Dev's shared adds aren't Dev's personal usual.
  assert.equal(usualFor("soap", dev, [add("soap", "2", "dev", true)]), null);
});

test("usualFor: history order doesn't matter, dates do", () => {
  const h = [add("eggs", "12"), add("eggs", "18"), add("eggs", "18"), add("eggs", "12"), add("eggs", "12")];
  assert.equal(usualFor("eggs", dev, [...h].reverse()), "12");
});
