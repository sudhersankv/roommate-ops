// Groceries photos: the vision model's JSON, the one-line summary, recipe ingredients, and the reader seam with a fake.
// No DB, no gateway. Run: npx tsx --test src/services/grocery-photos.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { clearPhotoCache, parsePhotoJson, photoIngredients, photoSummary, readGroceryPhoto, SAMPLE_LIST_JSON, setPhotoReader } from "./grocery-photos";
import { saveUpload } from "./receipts";

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

test("photoIngredients: amounts read with lib/units, unreadable ones are 1 each", () => {
  assert.deepEqual(photoIngredients([{ name: "flour", qty: "2 cups" }, { name: "eggs", qty: "3" }, { name: "salt", qty: "a pinch" }, { name: "basil", qty: null }]), [
    { name: "flour", quantity: 2, unit: "cup", display_text: "2 cups flour" },
    { name: "eggs", quantity: 3, unit: "each", display_text: "3 eggs" },
    { name: "salt", quantity: 1, unit: "each", display_text: "a pinch salt" },
    { name: "basil", quantity: 1, unit: "each", display_text: "basil" },
  ]);
});

test("readGroceryPhoto: the reader seam, cached per url so 'yes, add them' doesn't read again", async () => {
  const photo = await saveUpload("test", Buffer.from("a shopping list"), "image/jpeg");
  let reads = 0;
  setPhotoReader({
    read: async ({ dataUrl }) => {
      reads++;
      assert.match(dataUrl, /^data:image\/jpeg;base64,/);
      return SAMPLE_LIST_JSON;
    },
  });
  try {
    clearPhotoCache();
    const a = await readGroceryPhoto(photo.path);
    const b = await readGroceryPhoto(photo.path);
    assert.equal(a.items.length, 5);
    assert.equal(b, a);
    assert.equal(reads, 1);
  } finally {
    setPhotoReader(null);
    clearPhotoCache();
    await rm(photo.file, { force: true });
  }
});
