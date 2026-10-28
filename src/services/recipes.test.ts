// Pure tests for Recipes: Instacart units, the model's JSON (with the retry), Pantry matching, scaling and the link
// fingerprint. No DB, no model call. Run: npx tsx --test src/services/recipes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount, INSTACART_UNITS, measurementOrEach, normalizeUnit, parseAmount, toInstacartMeasurement } from "../lib/units";
import { estimateMeasured, CATALOG, DEFAULT_UNIT_CENTS } from "../lib/prices";
import { covers, haveNeed, recipeKey, scaleIngredients } from "./recipe-math";
import { parseRecipeJson, RecipeFormatError, recipePrompt, SAMPLE_RECIPE_JSON, writeRecipe, type RecipeRequest, type RecipeWriter } from "./recipes";

/* ---------- units ---------- */

test("normalizeUnit: Instacart's own units and the usual synonyms; anything else is null", () => {
  for (const u of INSTACART_UNITS) assert.equal(normalizeUnit(u), u);
  const cases: [string, string][] = [
    ["tbsp", "tablespoon"], ["Tbsp.", "tablespoon"], ["tablespoons", "tablespoon"], ["tsp", "teaspoon"],
    ["lb", "pound"], ["lbs", "pound"], ["Pounds", "pound"], ["oz", "ounce"], ["g", "gram"], ["kg", "kilogram"],
    ["pcs", "each"], ["piece", "each"], ["cups", "cup"], ["c", "cup"], ["ml", "milliliter"], ["l", "liter"],
    ["bunches", "bunch"], ["cans", "can"], ["jar", "package"], ["bag", "package"], ["packets", "packet"], ["heads", "head"],
  ];
  for (const [raw, want] of cases) assert.equal(normalizeUnit(raw), want, raw);
  for (const raw of ["handful", "splash", "", "clove"]) assert.equal(normalizeUnit(raw), null, raw);
});

test("toInstacartMeasurement: cloves become heads of garlic, pinches teaspoons, slices a package; unknown is null", () => {
  assert.deepEqual(toInstacartMeasurement(3, "cloves"), { quantity: 1, unit: "head" });
  assert.deepEqual(toInstacartMeasurement(12, "clove"), { quantity: 2, unit: "head" });
  assert.deepEqual(toInstacartMeasurement(2, "pinch"), { quantity: 0.25, unit: "teaspoon" });
  assert.deepEqual(toInstacartMeasurement(4, "slices"), { quantity: 1, unit: "package" });
  assert.deepEqual(toInstacartMeasurement(1.333, "lb"), { quantity: 1.33, unit: "pound" });
  assert.equal(toInstacartMeasurement(1, "handful"), null);
  assert.deepEqual(measurementOrEach(2, "handful"), { quantity: 2, unit: "each" });
  assert.deepEqual(measurementOrEach(null, null), { quantity: 1, unit: "each" });
});

test("parseAmount: free-text Cart quantities -> number + unit; sizes like '12 pack' are one package", () => {
  assert.deepEqual(parseAmount("2 lb"), { quantity: 2, unit: "pound" });
  assert.deepEqual(parseAmount("3 bags of chips"), { quantity: 3, unit: "package" });
  assert.deepEqual(parseAmount("18"), { quantity: 18, unit: "each" });
  assert.deepEqual(parseAmount("1/2 cup"), { quantity: 0.5, unit: "cup" });
  assert.deepEqual(parseAmount("1 1/2 cups"), { quantity: 1.5, unit: "cup" });
  assert.deepEqual(parseAmount("½ cup"), { quantity: 0.5, unit: "cup" });
  assert.deepEqual(parseAmount("12 pack"), { quantity: 1, unit: "package" });
  assert.deepEqual(parseAmount("32 oz"), { quantity: 32, unit: "ounce" });
  assert.deepEqual(parseAmount("2 fl oz"), { quantity: 2, unit: "fl oz" });
  assert.deepEqual(parseAmount("2 cartons"), { quantity: 2, unit: "package" });
  assert.equal(parseAmount("some"), null);
  assert.equal(parseAmount(""), null);
});

test("formatAmount: what the Cart shows", () => {
  assert.equal(formatAmount(20, "each"), "20");
  assert.equal(formatAmount(2, "pound"), "2 lb");
  assert.equal(formatAmount(1, "pound"), "1 lb");
  assert.equal(formatAmount(0.5, "cup"), "1/2 cup");
  assert.equal(formatAmount(1.5, "tablespoon"), "1 1/2 tbsp");
  assert.equal(formatAmount(2, "packet"), "2 packets");
  assert.equal(formatAmount(1, "bunch"), "1 bunch");
});

test("estimateMeasured: countable recipe units count a few store items; weights and big counts are one item", () => {
  assert.equal(estimateMeasured("limes", 4, "each"), 4 * CATALOG.limes);
  assert.equal(estimateMeasured("taco seasoning", 2, "packet"), 2 * CATALOG["taco seasoning"]);
  assert.equal(estimateMeasured("corn tortillas", 20, "each"), CATALOG["corn tortillas"], "20 tortillas is one pack");
  assert.equal(estimateMeasured("ground turkey", 2, "pound"), CATALOG["ground turkey"]);
  assert.equal(estimateMeasured("saffron", 1, "teaspoon"), DEFAULT_UNIT_CENTS);
});

/* ---------- the model's JSON ---------- */

test("parseRecipeJson: the sample recipe -> a draft with Instacart units and display text", () => {
  const d = parseRecipeJson(`Here you go:\n${SAMPLE_RECIPE_JSON}\nEnjoy!`);
  assert.equal(d.title, "Tacos for 5");
  assert.equal(d.servings, 5);
  assert.equal(d.cookingTimeMinutes, 30);
  assert.equal(d.ingredients.length, 11);
  assert.deepEqual(d.ingredients.find((i) => i.name === "ground turkey"), { name: "ground turkey", quantity: 2, unit: "pound", display_text: "2 lb ground turkey" });
  assert.equal(d.ingredients.find((i) => i.name === "cotija cheese")?.unit, "ounce");
  assert.ok(d.ingredients.every((i) => (INSTACART_UNITS as readonly string[]).includes(i.unit)));
  assert.equal(d.steps.length, 5);
});

test("parseRecipeJson: fractions as strings, numbered steps, missing display_text", () => {
  const d = parseRecipeJson(JSON.stringify({ title: "Pancakes", servings: "2", ingredients: [{ name: "Flour", quantity: "1 1/2", unit: "cups" }], steps: ["1. Mix", "2) Cook"] }));
  assert.deepEqual(d.ingredients[0], { name: "flour", quantity: 1.5, unit: "cup", display_text: "1 1/2 cups flour" });
  assert.deepEqual(d.steps, ["Mix", "Cook"]);
  assert.equal(d.cookingTimeMinutes, null);
});

test("parseRecipeJson: bad JSON, bad shape and unknown units throw RecipeFormatError (units only when coerce is off)", () => {
  assert.throws(() => parseRecipeJson("no json here"), RecipeFormatError);
  assert.throws(() => parseRecipeJson(JSON.stringify({ title: "x", servings: 2, ingredients: [], steps: ["a"] })), RecipeFormatError);
  const handful = JSON.stringify({ title: "Salad", servings: 2, ingredients: [{ name: "spinach", quantity: 2, unit: "handful" }], steps: ["Toss"] });
  assert.throws(() => parseRecipeJson(handful), (e: unknown) => e instanceof RecipeFormatError && e.onlyUnits && /handful/.test(e.message));
  assert.equal(parseRecipeJson(handful, { coerceUnits: true }).ingredients[0].unit, "each");
});

const req: RecipeRequest = { request: "tacos for 5 on friday", servings: 5, pantry: ["salt", "oil"] };
const scripted = (answers: string[]): RecipeWriter & { seen: RecipeRequest[] } => {
  const seen: RecipeRequest[] = [];
  return { seen, write: async (r) => (seen.push(r), answers[Math.min(seen.length - 1, answers.length - 1)]) };
};

test("writeRecipe: retries once with the error as feedback, then succeeds", async () => {
  const w = scripted(["sorry, here's prose", SAMPLE_RECIPE_JSON]);
  const d = await writeRecipe(req, w);
  assert.equal(d.title, "Tacos for 5");
  assert.equal(w.seen.length, 2);
  assert.equal(w.seen[0].feedback, undefined);
  assert.match(w.seen[1].feedback ?? "", /JSON/);
});

test("writeRecipe: two bad answers give a friendly error; the second try coerces units", async () => {
  await assert.rejects(writeRecipe(req, scripted(["nope", "still nope"])), /couldn't get that recipe into shape/);
  const handful = JSON.stringify({ title: "Salad for 5", servings: 5, ingredients: [{ name: "spinach", quantity: 2, unit: "handful" }], steps: ["Toss"] });
  const d = await writeRecipe(req, scripted([handful, handful]));
  assert.equal(d.ingredients[0].unit, "each");
});

test("writeRecipe: a recipe written for 4 is scaled to the 5 asked for", async () => {
  const four = JSON.stringify({
    title: "Tacos",
    servings: 4,
    ingredients: [
      { name: "ground beef", quantity: 1.6, unit: "lb", display_text: "1.6 lb ground beef" },
      { name: "limes", quantity: 3, unit: "each", display_text: "3 limes" },
    ],
    steps: ["Cook"],
  });
  const d = await writeRecipe(req, scripted([four]));
  assert.equal(d.servings, 5);
  assert.deepEqual(d.ingredients.map((i) => [i.name, i.quantity, i.unit, i.display_text]), [
    ["ground beef", 2, "pound", "2 lb ground beef"],
    ["limes", 4, "each", "4 limes"],
  ]);
});

test("recipePrompt: servings, the unit list, the pantry and the retry feedback", () => {
  const p = recipePrompt({ ...req, feedback: "These units aren't on the list." });
  assert.match(p, /servings is exactly 5/);
  assert.match(p, /tablespoon/);
  assert.match(p, /always have: salt, oil/);
  assert.match(p, /rejected: These units/);
});

/* ---------- Pantry, scaling, the link key ---------- */

test("covers: Pantry words must be in the ingredient and name the thing itself", () => {
  assert.equal(covers("oil", "olive oil"), true);
  assert.equal(covers("oil", "vegetable oil"), true);
  assert.equal(covers("salt", "kosher salt"), true);
  assert.equal(covers("onions", "red onion"), true);
  assert.equal(covers("onion", "Onions"), true);
  assert.equal(covers("tomatoes", "tomato"), true);
  assert.equal(covers("rice", "rice vinegar"), false);
  assert.equal(covers("chicken", "chicken broth"), false);
  assert.equal(covers("olive oil", "oil"), false, "the Pantry's olive oil doesn't cover any oil");
  assert.equal(covers("", "salt"), false);
});

test("haveNeed: Pantry and skip go to have, the rest to need, in order", () => {
  const ing = [{ name: "corn tortillas" }, { name: "vegetable oil" }, { name: "salt" }, { name: "red onion" }, { name: "limes" }];
  const { have, need } = haveNeed(ing, ["salt", "oil", "rice"], ["onions"]);
  assert.deepEqual(have.map((i) => i.name), ["vegetable oil", "salt", "red onion"]);
  assert.deepEqual(need.map((i) => i.name), ["corn tortillas", "limes"]);
});

test("scaleIngredients: measured amounts keep two decimals, countable ones round up; same servings is a no-op", () => {
  const base = [
    { name: "rice", quantity: 1, unit: "cup", display_text: "1 cup rice" },
    { name: "eggs", quantity: 2, unit: "each", display_text: "2 eggs" },
  ];
  assert.equal(scaleIngredients(base, 4, 4), base);
  assert.deepEqual(scaleIngredients(base, 3, 5).map((i) => [i.quantity, i.display_text]), [[1.67, "1.67 cup rice"], [4, "4 eggs"]]);
});

test("recipeKey: changes with the ingredients, servings or title, not with anything else", () => {
  const r = { title: "Tacos for 5", servings: 5, ingredients: [{ name: "limes", quantity: 4, unit: "each", display_text: "4 limes" }] };
  assert.equal(recipeKey(r), recipeKey({ ...r }));
  assert.equal(recipeKey(r), recipeKey({ ...r, ingredients: [{ ...r.ingredients[0], display_text: "4 limes, juiced" }] }), "display text alone doesn't matter");
  assert.notEqual(recipeKey(r), recipeKey({ ...r, servings: 6 }));
  assert.notEqual(recipeKey(r), recipeKey({ ...r, ingredients: [{ ...r.ingredients[0], quantity: 5 }] }));
  assert.match(recipeKey(r), /^[0-9a-f]{8}$/);
});
