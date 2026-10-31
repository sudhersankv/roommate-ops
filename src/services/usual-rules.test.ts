// Grocery usuals' pure rules (#36). Run: npx tsx --test src/services/usual-rules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { addedLine, learnFromPurchase, matchUsual, planAdd, questionFor, usualOwner, type Usual } from "./usual-rules";

const usual = (over: Partial<Usual> = {}): Usual => ({
  id: "u1",
  item: "pepsi",
  memberId: "sudhersan",
  name: "Pepsi",
  qty: "12 × 12 oz cans",
  quantity: 12,
  unit: "can",
  brand: null,
  source: "asked",
  lastUsedAt: new Date("2026-10-31T12:00:00Z"),
  ...over,
});

test("questionFor: one short question for things that come in sizes or kinds; none for clear ones", () => {
  assert.equal(questionFor("Pepsi"), "Pepsi: cans or a bottle, and how many?");
  assert.equal(questionFor("eggs"), "eggs: a dozen or 18?");
  assert.equal(questionFor("oat milk"), "oat milk: what kind, and how much? (a gallon of whole, a half gallon of 2%…)");
  assert.equal(questionFor("sparkling water"), "sparkling water: cans or a bottle, and how many?");
  assert.equal(questionFor("dish soap"), null);
  assert.equal(questionFor("milk chocolate"), null, "the last word is the thing");
  assert.equal(questionFor("limes"), null);
});

test("planAdd: a bare unclear mention with no usual asks; the answer is remembered", () => {
  assert.deepEqual(planAdd({ name: "Pepsi" }, undefined), { kind: "ask", question: "Pepsi: cans or a bottle, and how many?" });
  assert.deepEqual(planAdd({ name: "Pepsi", qty: "12 × 12 oz cans" }, undefined), { kind: "add", name: "Pepsi", qty: "12 × 12 oz cans", brand: null, write: "asked", touch: null });
});

test("planAdd: clear things go straight in ('2 gallons of whole milk', 'dish soap')", () => {
  assert.deepEqual(planAdd({ name: "whole milk", qty: "2 gallons" }, undefined), { kind: "add", name: "whole milk", qty: "2 gallons", brand: null, write: "asked", touch: null });
  assert.deepEqual(planAdd({ name: "dish soap" }, undefined), { kind: "add", name: "dish soap", qty: "1", brand: null, write: null, touch: null });
});

test("planAdd: next time the bare mention is the usual", () => {
  const u = usual();
  assert.deepEqual(planAdd({ name: "pepsi" }, u), { kind: "usual", usual: u });
});

test("planAdd: 'just a 2-liter this time' is a one-off; 'make it 24 from now on' overwrites", () => {
  const u = usual();
  assert.deepEqual(planAdd({ name: "Pepsi", qty: "1 × 2-liter bottle" }, u), { kind: "add", name: "Pepsi", qty: "1 × 2-liter bottle", brand: null, write: null, touch: null });
  assert.deepEqual(planAdd({ name: "Pepsi", qty: "1 × 2-liter bottle", remember: false }, u).kind, "add");
  assert.equal((planAdd({ name: "Pepsi", qty: "24 × 12 oz cans", remember: true }, u) as { write: string }).write, "corrected");
  assert.equal((planAdd({ name: "Pepsi", qty: "12 × 12 oz cans" }, u) as { touch: Usual }).touch, u, "the same as the usual: just used");
  assert.equal((planAdd({ name: "Pepsi", qty: "6 cans", remember: false }, undefined) as { write: null }).write, null, "'just this time' with nothing remembered yet");
});

test("matchUsual: the same thing, plurals aside; not a different thing", () => {
  const eggs = usual({ id: "e", item: "eggs", name: "Eggs", qty: "18" });
  const oat = usual({ id: "o", item: "oat milk", name: "Oat milk", qty: "2 cartons" });
  assert.equal(matchUsual([eggs, oat], "egg")?.id, "e");
  assert.equal(matchUsual([eggs, oat], "Oat Milk")?.id, "o");
  assert.equal(matchUsual([eggs, oat], "milk"), undefined);
});

test("matchUsual loose (a bare mention): 'bread' is the house's sourdough; the more exact name doesn't match the plain one", () => {
  const sourdough = usual({ id: "s", item: "sourdough bread", memberId: null, name: "Sourdough bread", qty: "1 loaf" });
  assert.equal(matchUsual([sourdough], "bread", true)?.id, "s");
  assert.equal(matchUsual([sourdough], "bread"), undefined);
  const bread = usual({ id: "b", item: "bread", memberId: null, name: "Bread", qty: "1 loaf" });
  assert.equal(matchUsual([bread], "rye bread", true), undefined);
});

test("learnFromPurchase: creates or updates a purchase-learned usual; never an asked or corrected one; a bare 1 teaches nothing", () => {
  assert.equal(learnFromPurchase(undefined, { name: "Pepsi", qty: "24 cans" }), "create");
  assert.equal(learnFromPurchase(usual({ source: "purchase", qty: "12 cans" }), { name: "Pepsi", qty: "24 cans" }), "update");
  assert.equal(learnFromPurchase(usual({ source: "purchase", qty: "24 cans" }), { name: "Pepsi", qty: "24 cans" }), null);
  assert.equal(learnFromPurchase(usual({ source: "asked" }), { name: "Pepsi", qty: "24 cans" }), null);
  assert.equal(learnFromPurchase(usual({ source: "corrected" }), { name: "Pepsi", qty: "24 cans" }), null);
  assert.equal(learnFromPurchase(undefined, { name: "Dish soap", qty: "1" }), null);
});

test("addedLine: says which usual it used", () => {
  assert.equal(addedLine([{ name: "Pepsi", qty: "12 cans", usual: usualOwner(false, "Sudhersan", true) }]), "Added your usual: Pepsi, 12 cans.");
  assert.equal(addedLine([{ name: "Sourdough", qty: "1 loaf", usual: usualOwner(true, "Maya", false) }]), "Added the house's usual: Sourdough, 1 loaf.");
  assert.equal(addedLine([{ name: "Pepsi", qty: "12 cans", usual: usualOwner(false, "Dev", false) }, { name: "eggs", qty: "1" }]), "Added Dev's usual Pepsi (12 cans) and eggs.");
  assert.equal(addedLine([{ name: "chips", qty: "3 bags" }]), "Added chips (3 bags).");
  assert.equal(addedLine([]), null);
});
