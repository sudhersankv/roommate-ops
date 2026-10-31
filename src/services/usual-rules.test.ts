// The usuals someone said: pure rules (#36 + #62). Run: npx tsx --test src/services/usual-rules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchUsual, shouldRemember, type Usual } from "./usual-rules";

const usual = (over: Partial<Usual> = {}): Usual => ({
  id: "u1",
  item: "pepsi",
  memberId: "dev",
  name: "Pepsi",
  qty: "12 × 12 oz cans",
  quantity: 12,
  unit: "can",
  createdAt: new Date("2026-10-31T12:00:00Z"),
  ...over,
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

test("shouldRemember: an answer to Roomie's question writes the row; a plain clear add doesn't (it's history)", () => {
  assert.equal(shouldRemember({ name: "Pepsi", qty: "12 × 12 oz cans" }, undefined, true), true);
  assert.equal(shouldRemember({ name: "whole milk", qty: "2 gallons" }, undefined, false), false);
  assert.equal(shouldRemember({ name: "Pepsi" }, undefined, true), false, "no quantity, nothing to remember");
});

test("shouldRemember: 'from now on' overwrites; 'just this time' never writes; the same row isn't written again", () => {
  const u = usual();
  assert.equal(shouldRemember({ name: "Pepsi", qty: "24 × 12 oz cans", remember: true }, u, false), true);
  assert.equal(shouldRemember({ name: "Pepsi", qty: "1 × 2-liter bottle" }, u, false), false);
  assert.equal(shouldRemember({ name: "Pepsi", qty: "1 × 2-liter bottle", remember: false }, u, true), false);
  assert.equal(shouldRemember({ name: "pepsi", qty: "12 × 12 OZ cans", remember: true }, u, false), false);
});
