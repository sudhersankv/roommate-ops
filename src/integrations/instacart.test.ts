// The Instacart client without a network: the IDP wire format, finding the link in Composio's answer, the fake, and
// the real client failing soft without a key. Run: npx tsx --test src/integrations/instacart.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { ComposioInstacart, FakeInstacart, InstacartUnavailableError, instacartAvailability, instacartClient, linkFrom, recipeArgs, setInstacartClient, shoppingListArgs } from "./instacart";

const recipe = {
  title: "Tacos for 5",
  servings: 5,
  cookingTimeMinutes: 30,
  instructions: ["Brown the turkey.", "Warm the tortillas."],
  ingredients: [
    { name: "ground turkey", displayText: "2 lb ground turkey", measurements: [{ quantity: 2, unit: "pound" as const }] },
    { name: "limes", measurements: [{ quantity: 4, unit: "each" as const }] },
  ],
  linkbackUrl: "http://localhost:3000/g/x/cart",
};

test("recipeArgs: Instacart's POST /idp/v1/products/recipe body", () => {
  assert.deepEqual(recipeArgs(recipe), {
    title: "Tacos for 5",
    servings: 5,
    cooking_time: 30,
    instructions: ["Brown the turkey.", "Warm the tortillas."],
    ingredients: [
      { name: "ground turkey", display_text: "2 lb ground turkey", measurements: [{ quantity: 2, unit: "pound" }] },
      { name: "limes", display_text: "limes", measurements: [{ quantity: 4, unit: "each" }] },
    ],
    landing_page_configuration: { partner_linkback_url: "http://localhost:3000/g/x/cart", enable_pantry_items: true },
  });
});

test("shoppingListArgs: POST /idp/v1/products/products_link with link_type shopping_list", () => {
  assert.deepEqual(shoppingListArgs({ title: "Roomie Cart", lineItems: [{ name: "milk", displayText: "Milk (1 gallon)", measurements: [{ quantity: 1, unit: "gallon" }] }] }), {
    title: "Roomie Cart",
    link_type: "shopping_list",
    line_items: [{ name: "milk", display_text: "Milk (1 gallon)", line_item_measurements: [{ quantity: 1, unit: "gallon" }] }],
  });
});

test("linkFrom: products_link_url at any depth; nothing else counts", () => {
  assert.equal(linkFrom({ products_link_url: "https://www.instacart.com/store/recipes/1" }), "https://www.instacart.com/store/recipes/1");
  assert.equal(linkFrom({ data: { response_data: { products_link_url: "https://www.instacart.com/store/shopping_lists/2" } } }), "https://www.instacart.com/store/shopping_lists/2");
  assert.equal(linkFrom({ products_link_url: "javascript:alert(1)" }), null);
  assert.equal(linkFrom({ url: "https://example.com" }), null);
  assert.equal(linkFrom(null), null);
});

test("the fake: deterministic instacart.example links, and it records what was sent", async () => {
  const fake = new FakeInstacart();
  const a = await fake.recipePage(recipe);
  const b = await fake.recipePage(recipe);
  assert.equal(a.url, b.url);
  assert.match(a.url, /^https:\/\/instacart\.example\/recipes\/[0-9a-f]{8}$/);
  const list = await fake.shoppingListPage({ title: "Roomie Cart", lineItems: [{ name: "milk", measurements: [{ quantity: 1, unit: "each" }] }] });
  assert.match(list.url, /^https:\/\/instacart\.example\/lists\//);
  assert.notEqual((await fake.recipePage({ ...recipe, servings: 6 })).url, a.url);
  assert.deepEqual(fake.calls.map((c) => c.slug), ["INSTACART_CREATE_RECIPE_PAGE", "INSTACART_CREATE_RECIPE_PAGE", "INSTACART_CREATE_SHOPPING_LIST_PAGE", "INSTACART_CREATE_RECIPE_PAGE"]);
});

test("the real client without COMPOSIO_API_KEY fails soft with InstacartUnavailableError", async () => {
  const key = process.env.COMPOSIO_API_KEY;
  delete process.env.COMPOSIO_API_KEY;
  try {
    await assert.rejects(new ComposioInstacart().shoppingListPage({ title: "x", lineItems: [] }), (e: unknown) => e instanceof InstacartUnavailableError && /isn't available yet/.test(e.message));
    const prev = process.env.INSTACART_FAKE;
    delete process.env.INSTACART_FAKE;
    assert.equal(instacartClient().kind, "composio");
    const a = await instacartAvailability();
    assert.equal(a.ready, false);
    if (prev !== undefined) process.env.INSTACART_FAKE = prev;
  } finally {
    if (key !== undefined) process.env.COMPOSIO_API_KEY = key;
  }
});

test("INSTACART_FAKE=1 or an injected client wins; the fake is never 'ready' for the dashboard button", async () => {
  const prev = process.env.INSTACART_FAKE;
  process.env.INSTACART_FAKE = "1";
  try {
    assert.equal(instacartClient().kind, "fake");
    assert.deepEqual(await instacartAvailability(), { ready: false, kind: "fake", hint: (await instacartAvailability()).hint });
    const mine = new FakeInstacart();
    setInstacartClient(mine);
    assert.equal(instacartClient(), mine);
  } finally {
    setInstacartClient(null);
    if (prev === undefined) delete process.env.INSTACART_FAKE;
    else process.env.INSTACART_FAKE = prev;
  }
});
