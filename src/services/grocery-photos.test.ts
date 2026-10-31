// Groceries photos: the vision model's JSON, the one-line summary, recipe ingredients, and the reader seam with a fake.
// No DB, no gateway. Run: npx tsx --test src/services/grocery-photos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePhotoJson, photoIngredients, photoSummary, readGroceryPhoto, SAMPLE_LIST_JSON, setPhotoReader } from "./grocery-photos";

test("parsePhotoJson: a shopping list -> items as written (names lower case, qty kept)", () => {
  const p = parsePhotoJson(SAMPLE_LIST_JSON);
  assert.equal(p.kind, "list");
  assert.deepEqual(p.items.slice(0, 3), [{ name: "eggs", qty: "12" }, { name: "milk", qty: "1 gallon" }, { name: "bread", qty: null }]);
  const messy = parsePhotoJson('Sure! {"kind":"list","items":[{"name":"  Olive  Oil ","qty":2},{"name":"","qty":"1"},{"name":"Salt","qty":""}]}');
  assert.deepEqual(messy.items, [{ name: "olive oil", qty: "2" }, { name: "salt", qty: null }]);
});

test("parsePhotoJson: a recipe keeps its title, servings and steps; a pantry shelf is a list", () => {
  const r = parsePhotoJson(JSON.stringify({ kind: "recipe", title: "Shakshuka", servings: 4, items: [{ name: "eggs", qty: "6" }, { name: "canned tomatoes", qty: "28 oz" }], steps: ["Simmer the tomatoes.", "Crack in the eggs."] }));
  assert.deepEqual([r.kind, r.title, r.servings, r.items.length, r.steps.length], ["recipe", "Shakshuka", 4, 2, 2]);
  assert.equal(parsePhotoJson(JSON.stringify({ kind: "pantry", items: [{ name: "rice" }] })).kind, "list");
});

test("parsePhotoJson: a receipt or anything else has no items; an unknown kind is other; junk throws", () => {
  const rec = parsePhotoJson(JSON.stringify({ kind: "receipt", items: [{ name: "eggs", qty: "4.29" }] }));
  assert.deepEqual([rec.kind, rec.items], ["receipt", []]);
  assert.equal(parsePhotoJson(JSON.stringify({ kind: "meme", items: [] })).kind, "other");
  assert.throws(() => parsePhotoJson("no idea"), /Couldn't make sense of that photo/);
});

test("photoSummary: one line, at most 8 names, no prices", () => {
  const items = ["eggs", "milk", "bread", "bananas", "rice", "salt", "oil", "flour", "sugar"].map((name) => ({ name, qty: name === "eggs" ? "12" : null }));
  assert.equal(photoSummary(items), "9 items: eggs (12), milk, bread, bananas, rice, salt, oil, flour, …");
  assert.equal(photoSummary([{ name: "milk", qty: "1" }]), "1 item: milk");
});

test("photoIngredients: amounts read with lib/units ('a pinch' too), unreadable ones are 1 each", () => {
  assert.deepEqual(photoIngredients([{ name: "flour", qty: "2 cups" }, { name: "eggs", qty: "3" }, { name: "salt", qty: "a pinch" }, { name: "lime", qty: "juice of" }, { name: "basil", qty: null }]), [
    { name: "flour", quantity: 2, unit: "cup", display_text: "2 cups flour" },
    { name: "eggs", quantity: 3, unit: "each", display_text: "3 eggs" },
    { name: "salt", quantity: 0.13, unit: "teaspoon", display_text: "a pinch salt" },
    { name: "lime", quantity: 1, unit: "each", display_text: "juice of lime" },
    { name: "basil", quantity: 1, unit: "each", display_text: "basil" },
  ]);
});

const GROUP = "11111111-1111-4111-8111-111111111111";

// Another Group's Document and the per-url cache need the DB: src/services/core-slots.dbtest.ts.
test("readGroceryPhoto: never a URL someone typed (only this Group's own Documents)", async () => {
  setPhotoReader({ read: async () => SAMPLE_LIST_JSON });
  try {
    for (const url of ["https://169.254.169.254/latest/meta-data.jpg", "http://127.0.0.9:1/uploads/x/a.jpg", "file:///etc/passwd", "/uploads/../../.env", "/uploads/other/a.jpg", "/api/docs/not-an-id"]) {
      await assert.rejects(readGroceryPhoto(url, GROUP), /only read photos sent in this group's chat/, url);
    }
  } finally {
    setPhotoReader(null);
  }
});