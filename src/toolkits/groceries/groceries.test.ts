// Groceries' contract with the model, no DB: no prices in what Roomie is told, photos and quantities covered.
// Run: npx tsx --test src/toolkits/groceries/groceries.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { groceries } from "./manifest";
import { skill } from "./skill";
import { cartTools } from "./cart";
import { recipeTools } from "./recipes";

const PRICE = /\$\d|estimat|price/i;

test("the Groceries skill and abilities never talk prices (beyond 'no prices')", () => {
  const persona = skill.replace(/Groceries has no prices\. Never say a price, an estimate or a cart total/, "");
  assert.ok(!PRICE.test(persona), persona);
  for (const [id, a] of Object.entries(groceries.abilities ?? {})) assert.ok(!PRICE.test(a), `${id}: ${a}`);
  assert.match(skill, /cart_from_photo/);
  assert.match(skill, /Don't offer the Cart page unless they ask/);
  assert.match(groceries.gate.criterion, /photo of a recipe or a shopping list/);
});

test("the Groceries tools: a photo tool, quantities as said, no estimates promised", () => {
  const tools = { ...cartTools, ...recipeTools } as Record<string, { description?: string }>;
  assert.ok(tools.cart_from_photo, "cart_from_photo exists");
  assert.match(tools.cart_add.description!, /needsClarification/);
  for (const [id, t] of Object.entries(tools)) {
    const d = (t.description ?? "").replace(/No prices: never say a price or total\.|\(no prices: the receipt has those\)|No prices\./g, "");
    assert.ok(!/estimat/i.test(d), `${id} still mentions estimates`);
  }
});
