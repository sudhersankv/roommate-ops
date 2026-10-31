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

test("a Recipe offers the cart once, and only when they're shopping for it (live test #5)", async () => {
  const { recipeAsk } = await import("./recipes");
  assert.equal(recipeAsk(3, true), "Want the 3 missing ingredients on the list?");
  assert.equal(recipeAsk(1, true), "Want the 1 missing ingredient on the list?");
  assert.equal(recipeAsk(3, false), null, "an idea or a recipe to read: no offer");
  assert.equal(recipeAsk(3, undefined), null);
  assert.equal(recipeAsk(0, true), null, "nothing missing: nothing to offer");
});
