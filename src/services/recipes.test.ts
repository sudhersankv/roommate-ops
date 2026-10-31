// Pure tests for Recipes: Instacart units, the model's JSON (with the retry), Pantry matching, scaling and the link
// fingerprint. No DB, no model call. Run: npx tsx --test src/services/recipes.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatAmount, INSTACART_UNITS, measurementOrEach, normalizeUnit, parseAmount, toInstacartMeasurement } from "../lib/units";
import { assumedInHouse, assumedLine, buyableAmount, covers, haveNeed, recipeAddedLine, recipeBuyList, recipeKey, scaleIngredients } from "./recipe-math";
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

/* ---------- buyable amounts (#37) ---------- */

test("buyableAmount: the taco night in buyable amounts: cloves -> a head, 4 tbsp sour cream -> a tub, weights to package sizes", () => {
  const line = (name: string, quantity: number, unit: string) => buyableAmount({ name, quantity, unit });
  assert.deepEqual(line("garlic", 1, "head"), { name: "garlic", qty: "1 head", quantity: 1, unit: "head" }, "2 cloves were already a head (lib/units)");
  assert.deepEqual(line("garlic cloves", 12, "each"), { name: "garlic", qty: "2 heads", quantity: 2, unit: "head" });
  assert.deepEqual(line("sour cream", 4, "tablespoon"), { name: "sour cream", qty: "1 tub", quantity: 1, unit: "package" });
  assert.deepEqual(line("chicken broth", 6, "cup"), { name: "chicken broth", qty: "2 cartons", quantity: 2, unit: "package" });
  assert.deepEqual(line("lime juice", 2, "tablespoon"), { name: "lime juice", qty: "1 bottle", quantity: 1, unit: "package" });
  assert.deepEqual(line("ground beef", 1, "pound"), { name: "ground beef", qty: "1 lb", quantity: 1, unit: "pound" });
  assert.deepEqual(line("ground beef", 1.5, "pound"), { name: "ground beef", qty: "2 lb", quantity: 2, unit: "pound" });
  assert.deepEqual(line("cotija cheese", 6, "ounce"), { name: "cotija cheese", qty: "8 oz", quantity: 8, unit: "ounce" });
  assert.deepEqual(line("cheddar", 12, "ounce"), { name: "cheddar", qty: "1 lb", quantity: 1, unit: "pound" });
  assert.deepEqual(line("rice", 400, "gram"), { name: "rice", qty: "500 g", quantity: 500, unit: "gram" });
  assert.deepEqual(line("chicken thighs", 1.2, "kilogram"), { name: "chicken thighs", qty: "2 kg", quantity: 2, unit: "kilogram" });
  assert.deepEqual(line("limes", 4, "each"), { name: "limes", qty: "4", quantity: 4, unit: "each" });
  assert.deepEqual(line("cilantro", 1, "bunch"), { name: "cilantro", qty: "1 bunch", quantity: 1, unit: "bunch" });
});

test("recipeBuyList: salt and spices are assumed in the house; the rest goes in buyable", () => {
  const need = [
    { name: "salt", quantity: 0.5, unit: "teaspoon" },
    { name: "garlic", quantity: 1, unit: "head" },
    { name: "chili powder", quantity: 1, unit: "tablespoon" },
    { name: "ground cumin", quantity: 2, unit: "teaspoon" },
    { name: "sour cream", quantity: 4, unit: "tablespoon" },
    { name: "olive oil", quantity: 1, unit: "tablespoon" },
    { name: "red bell pepper", quantity: 1, unit: "each" },
    { name: "black pepper", quantity: 0.25, unit: "teaspoon" },
  ];
  const { buy, assumed } = recipeBuyList(need);
  assert.deepEqual(assumed, ["salt", "chili powder", "ground cumin", "olive oil", "black pepper"]);
  assert.deepEqual(buy.map((b) => [b.line.name, b.line.qty]), [["garlic", "1 head"], ["sour cream", "1 tub"], ["red bell pepper", "1"]]);
  assert.equal(assumedLine(assumed), "I assumed you have salt, chili powder, ground cumin, olive oil and black pepper; say if you're out. Want me to keep them in the Pantry?");
  assert.equal(assumedLine(["salt"]), "I assumed you have salt; say if you're out. Want me to keep it in the Pantry?");
  assert.equal(assumedLine([]), null);
});

test("recipeBuyList: nothing is assumed that the Pantry says the house doesn't keep", () => {
  const need = [{ name: "ground cumin", quantity: 2, unit: "teaspoon" }, { name: "salt", quantity: 1, unit: "teaspoon" }];
  const { buy, assumed } = recipeBuyList(need, ["cumin", "salt"]);
  assert.deepEqual(assumed, []);
  assert.deepEqual(buy.map((b) => [b.line.name, b.line.qty]), [["ground cumin", "1 package"], ["salt", "1 package"]]);
  assert.equal(assumedInHouse("water"), true);
  assert.equal(assumedInHouse("pepper"), true);
  assert.equal(assumedInHouse("jalapeno pepper"), false);
});

test("recipeAddedLine: what went in, then the assumed ones once", () => {
  assert.equal(recipeAddedLine("Tacos for 5", 8, []), "Added 8 things for Tacos for 5 to the Cart.");
  assert.equal(recipeAddedLine("Tacos for 5", 1, ["salt"]), "Added 1 thing for Tacos for 5 to the Cart. I assumed you have salt; say if you're out. Want me to keep it in the Pantry?");
  assert.equal(recipeAddedLine("Tacos for 5", 0, []), "Nothing new to add for Tacos for 5: it's in the Cart or the Pantry.");
});
