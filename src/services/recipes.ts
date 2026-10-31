// Recipes: Roomie writes one for the Group's servings (Sonnet on the gateway, strict JSON, units from Instacart's
// list), the Group saves it, and its ingredients go into the Cart only when someone asks (plan Q7). The Pantry
// decides what's "have" vs "need"; the Instacart recipe link is cached on the Recipe until its ingredients change.
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import type { RecipeIngredient } from "@/db/schema";
import { formatAmount, INSTACART_UNITS, measurementOrEach, roundQuantity, toInstacartMeasurement } from "@/lib/units";
import { dashboardUrl } from "@/lib/urls";
import { instacartClient } from "@/integrations/instacart";
import { record, sourceOf } from "./activity";
import { requireActive } from "./authz";
import { listMembers } from "./members";
import { getNotKept, getPantry } from "./pantry";
import { coveredBy, haveNeed, recipeBuyList, recipeKey, scaleIngredients } from "./recipe-math";
import { usualsOf } from "./cart";
import type { Ctx, GroupCtx } from "./types";

const { recipes, cartItems, members } = schema;

export type RecipeDraft = {
  title: string;
  servings: number;
  cookingTimeMinutes: number | null;
  ingredients: RecipeIngredient[];
  steps: string[];
};

export type Recipe = RecipeDraft & {
  id: string;
  source: "roomie" | "member";
  createdBy: string | null;
  createdByName: string | null;
  plannedFor: string | null;
  instacartUrl: string | null;
  createdAt: Date;
};

/* ---------- the model's answer, validated ---------- */

const amount = z.union([z.number(), z.string()]);
export const RawRecipeSchema = z.object({
  title: z.string().min(1).max(120),
  servings: z.coerce.number().int().positive().max(100),
  cooking_time: z.coerce.number().int().positive().max(24 * 60).nullable().optional(),
  ingredients: z
    .array(z.object({ name: z.string().min(1).max(80), quantity: amount, unit: z.string().min(1).max(30), display_text: z.string().max(160).optional() }))
    .min(1)
    .max(40),
  steps: z.array(z.string().min(1).max(600)).min(1).max(30),
});
export type RawRecipe = z.infer<typeof RawRecipeSchema>;

/** Thrown when the model's JSON doesn't hold up; the message goes back to the model on the retry. */
export class RecipeFormatError extends Error {
  constructor(
    message: string,
    readonly onlyUnits = false,
  ) {
    super(message);
    this.name = "RecipeFormatError";
  }
}

function toNumber(q: string | number): number | null {
  if (typeof q === "number") return Number.isFinite(q) && q > 0 ? q : null;
  const s = q.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Model text -> a validated draft. Units must map to Instacart's list (synonyms like tbsp and lb are fine); with
 * `coerceUnits` (the last try) an unknown unit is bought as `each` instead of failing.
 */
export function parseRecipeJson(text: string, opts: { coerceUnits?: boolean } = {}): RecipeDraft {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new RecipeFormatError("That wasn't valid JSON.");
  }
  const parsed = RawRecipeSchema.safeParse(data);
  if (!parsed.success) throw new RecipeFormatError(`The JSON didn't match the shape: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 400)}`);
  const raw = parsed.data;
  const badUnits: string[] = [];
  const ingredients: RecipeIngredient[] = raw.ingredients.map((i) => {
    const q = toNumber(i.quantity) ?? 1;
    const m = toInstacartMeasurement(q, i.unit);
    if (!m) badUnits.push(`${i.name}: "${i.unit}"`);
    const fixed = m ?? measurementOrEach(q, null);
    const name = i.name.trim().toLowerCase().replace(/\s+/g, " ");
    return { name, quantity: fixed.quantity, unit: fixed.unit, display_text: i.display_text?.trim() || `${formatAmount(fixed.quantity, fixed.unit)} ${name}` };
  });
  if (badUnits.length && !opts.coerceUnits) throw new RecipeFormatError(`These units aren't on the list: ${badUnits.join(", ")}.`, true);
  return {
    title: raw.title.trim(),
    servings: raw.servings,
    cookingTimeMinutes: raw.cooking_time ?? null,
    ingredients,
    steps: raw.steps.map((s) => s.trim().replace(/^\d+[.)]\s*/, "")).filter(Boolean),
  };
}

/* ---------- the model call ---------- */

export type RecipeRequest = { request: string; servings: number; constraints?: string; pantry: string[]; feedback?: string };

export interface RecipeWriter {
  /** The model's raw text answer. */
  write(req: RecipeRequest): Promise<string>;
}

export function recipePrompt(req: RecipeRequest): string {
  return [
    `You write recipes for a group of people who share a kitchen. Reply with JSON only, no prose:`,
    `{"title": string, "servings": number, "cooking_time": minutes or null, "ingredients": [{"name": string, "quantity": number, "unit": string, "display_text": string}], "steps": [string]}`,
    `Rules:`,
    `- servings is exactly ${req.servings}; scale every amount for ${req.servings} people. Title like "Tacos for ${req.servings}".`,
    `- name: what you'd search for in a grocery store, lower case, no amount or prep ("ground beef", "corn tortillas", "lime").`,
    `- quantity: a plain number (0.5, not "1/2"). unit: exactly one of ${INSTACART_UNITS.join(", ")}. Countable things (limes, tortillas, onions) use "each"; garlic is "head".`,
    `- display_text: how a person reads it, e.g. "1.5 lb ground beef", "2 limes, juiced".`,
    `- 5 to 15 ingredients, 4 to 10 short steps (no numbering).`,
    req.pantry.length ? `- They always have: ${req.pantry.join(", ")}. List them anyway if the dish needs them.` : "",
    req.constraints ? `- Constraints: ${req.constraints}` : "",
    `Request: ${req.request}`,
    req.feedback ? `Your last answer was rejected: ${req.feedback} Fix that and reply with the JSON again.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const gatewayRecipeWriter: RecipeWriter = {
  async write(req) {
    const base = (process.env.NEON_AI_GATEWAY_BASE_URL ?? "").replace(/\/+$/, "");
    if (!base || !process.env.NEON_AI_GATEWAY_TOKEN) throw new Error("The AI Gateway isn't configured, so I can't write recipes.");
    const res = await fetch(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.NEON_AI_GATEWAY_TOKEN}` },
      body: JSON.stringify({
        model: process.env.RECIPE_MODEL ?? process.env.LLM_MODEL ?? "claude-sonnet-5-5",
        // No temperature: claude-sonnet-5-5 on the gateway rejects the parameter.
        max_tokens: 2500,
        messages: [{ role: "user", content: recipePrompt(req) }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn(`[recipes] gateway ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
      throw new Error(`Couldn't write the recipe right now (gateway ${res.status}).`);
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return body.choices?.[0]?.message?.content ?? "";
  },
};

let writer: RecipeWriter | null = null;
/** Tests swap the writer (and RECIPE_FAKE=1 uses the sample below). */
export function setRecipeWriter(w: RecipeWriter | null) {
  writer = w;
}

export const SAMPLE_RECIPE_JSON = JSON.stringify({
  title: "Tacos for 5",
  servings: 5,
  cooking_time: 30,
  ingredients: [
    { name: "corn tortillas", quantity: 20, unit: "each", display_text: "20 corn tortillas" },
    { name: "ground turkey", quantity: 2, unit: "lb", display_text: "2 lb ground turkey" },
    { name: "taco seasoning", quantity: 2, unit: "packet", display_text: "2 packets taco seasoning" },
    { name: "avocados", quantity: 3, unit: "each", display_text: "3 avocados" },
    { name: "limes", quantity: 4, unit: "each", display_text: "4 limes" },
    { name: "cilantro", quantity: 1, unit: "bunch", display_text: "1 bunch cilantro" },
    { name: "red onion", quantity: 1, unit: "each", display_text: "1 red onion, diced" },
    { name: "cotija cheese", quantity: 8, unit: "oz", display_text: "8 oz cotija, crumbled" },
    { name: "salsa verde", quantity: 1, unit: "package", display_text: "1 jar salsa verde" },
    { name: "vegetable oil", quantity: 1, unit: "tbsp", display_text: "1 tbsp oil" },
    { name: "salt", quantity: 1, unit: "tsp", display_text: "1 tsp salt" },
  ],
  steps: ["Brown the turkey in the oil over medium-high heat.", "Stir in the seasoning and a splash of water; simmer 5 minutes.", "Warm the tortillas in a dry pan.", "Dice the onion, slice the avocados, chop the cilantro.", "Fill, top with cotija and salsa, squeeze lime over."],
});
const fakeWriter: RecipeWriter = { write: async () => SAMPLE_RECIPE_JSON };
const currentWriter = () => writer ?? (process.env.RECIPE_FAKE === "1" ? fakeWriter : gatewayRecipeWriter);

/* ---------- drafting ---------- */

export type DraftResult = { draft: RecipeDraft; have: RecipeIngredient[]; need: RecipeIngredient[]; pantry: string[] };

/**
 * Write a Recipe for `servings` (default: the Group's active Members). One retry when the JSON doesn't hold up;
 * on the last try unknown units are bought as `each`. If the model wrote it for a different number of people, the
 * amounts are scaled here. Nothing is saved; see saveRecipe.
 */
export async function draftRecipe(ctx: GroupCtx, input: { request: string; servings?: number; constraints?: string }): Promise<DraftResult> {
  const request = input.request.trim();
  if (!request) throw new Error("What should I cook? Tell me the dish.");
  const servings = input.servings && input.servings > 0 ? Math.min(100, Math.round(input.servings)) : Math.max(1, (await listMembers(ctx)).length);
  const pantry = await getPantry(ctx);
  const draft = await writeRecipe({ request, servings, constraints: input.constraints?.trim() || undefined, pantry });
  const { have, need } = haveNeed(draft.ingredients, pantry);
  return { draft, have, need, pantry };
}

/** The model call with one retry (the error goes back to it), then scaled to `req.servings`. No DB. */
export async function writeRecipe(req: RecipeRequest, w: RecipeWriter = currentWriter()): Promise<RecipeDraft> {
  let draft: RecipeDraft;
  try {
    draft = parseRecipeJson(await w.write(req));
  } catch (e) {
    if (!(e instanceof RecipeFormatError)) throw e;
    const text = await w.write({ ...req, feedback: e.message });
    try {
      draft = parseRecipeJson(text, { coerceUnits: true });
    } catch {
      throw new Error("I couldn't get that recipe into shape. Try asking again?");
    }
  }
  if (draft.servings !== req.servings) draft = { ...draft, ingredients: scaleIngredients(draft.ingredients, draft.servings, req.servings), servings: req.servings };
  return draft;
}

/* ---------- saved Recipes ---------- */

type Row = typeof recipes.$inferSelect;

const toRecipe = (r: Row, names: Map<string, string>): Recipe => ({
  id: r.id,
  title: r.title,
  servings: r.servings,
  cookingTimeMinutes: r.cookingTimeMinutes,
  ingredients: r.ingredients,
  steps: r.steps,
  source: r.source,
  createdBy: r.createdBy,
  createdByName: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
  plannedFor: r.plannedFor,
  instacartUrl: r.instacartUrl && r.instacartKey === recipeKey(r) ? r.instacartUrl : null,
  createdAt: r.createdAt,
});

async function namesFor(groupId: string) {
  const rows = await db.select({ id: members.id, name: members.displayName }).from(members).where(eq(members.groupId, groupId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function cleanDraft(d: RecipeDraft): RecipeDraft {
  const title = d.title?.trim();
  if (!title) throw new Error("The recipe needs a title.");
  if (!(d.servings > 0)) throw new Error("How many people is it for?");
  const ingredients = (d.ingredients ?? [])
    .map((i) => {
      const m = measurementOrEach(i.quantity, i.unit);
      const name = i.name.trim().toLowerCase();
      return { name, quantity: m.quantity, unit: m.unit, display_text: i.display_text?.trim() || `${formatAmount(m.quantity, m.unit)} ${name}`, ...(i.shared === false ? { shared: false } : {}) };
    })
    .filter((i) => i.name);
  if (ingredients.length === 0) throw new Error("The recipe needs at least one ingredient.");
  return { title: title.slice(0, 120), servings: Math.round(d.servings), cookingTimeMinutes: d.cookingTimeMinutes ?? null, ingredients, steps: (d.steps ?? []).map((s) => s.trim()).filter(Boolean) };
}

/** Save a Recipe for the Group. `plannedFor` is the day it's for ("YYYY-MM-DD" in the Group's time zone). */
export async function saveRecipe(ctx: Ctx, input: RecipeDraft & { plannedFor?: string | null; source?: "roomie" | "member" }): Promise<Recipe> {
  await requireActive(ctx);
  const d = cleanDraft(input);
  const plannedFor = input.plannedFor && DAY.test(input.plannedFor) ? input.plannedFor : null;
  const [row] = await db
    .insert(recipes)
    .values({ groupId: ctx.groupId, ...d, source: input.source ?? "roomie", createdBy: ctx.memberId, plannedFor })
    .returning();
  await record(ctx.groupId, ctx.memberId, "recipe.added", `saved the recipe ${d.title}`, { table: "recipes", id: row.id }, sourceOf(ctx));
  return toRecipe(row, await namesFor(ctx.groupId));
}

/** Newest first. */
export async function listRecipes(ctx: GroupCtx, limit = 20): Promise<Recipe[]> {
  const [rows, names] = await Promise.all([db.select().from(recipes).where(eq(recipes.groupId, ctx.groupId)).orderBy(desc(recipes.createdAt), desc(recipes.id)).limit(limit), namesFor(ctx.groupId)]);
  return rows.map((r) => toRecipe(r, names));
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * One Recipe by id, or by title ("the tacos" -> Tacos for 5), or the newest one when `query` is empty. Throws a
 * message Roomie can repeat when there's no match.
 */
export async function getRecipe(ctx: GroupCtx, query?: string | null): Promise<Recipe> {
  const list = await listRecipes(ctx, 50);
  if (list.length === 0) throw new Error("There aren't any saved recipes yet. Ask me for one ('roomie tacos for 5 friday').");
  const q = norm(query ?? "").replace(/^(the|our|that|this)\s+/, "").replace(/\s+recipe$/, "");
  if (!q) return list[0];
  const hit =
    list.find((r) => r.id === q) ??
    list.find((r) => norm(r.title) === q) ??
    list.find((r) => norm(r.title).includes(q)) ??
    list.find((r) => q.split(" ").filter((w) => w.length > 2).some((w) => norm(r.title).includes(w.replace(/s$/, ""))));
  if (!hit) throw new Error(`No recipe like "${query}". Saved: ${list.slice(0, 6).map((r) => r.title).join(", ")}.`);
  return hit;
}

/** Have / need for a saved Recipe against the Group's Pantry right now. */
export async function recipeShoppingList(ctx: GroupCtx, recipe: Recipe, skip: string[] = []) {
  const pantry = await getPantry(ctx);
  return { pantry, ...haveNeed(recipe.ingredients, pantry, skip) };
}

export type AddRecipeResult = {
  recipe: Recipe;
  added: { id: string; name: string; qty: string }[];
  /** In the Pantry or said to skip ("we have onions"). */
  have: string[];
  /** Already open in the Cart (from this Recipe, or a shared item with that name). */
  alreadyInCart: string[];
  /** Left out as almost always in the house (salt, oil, the common spices), named once (recipe-math assumedLine). */
  assumed: string[];
};

/**
 * Put a Recipe's missing ingredients in the Cart: not the Pantry's, not the ones in `skip`, not what's already
 * there, not what's assumed in the house (`assumed`: salt, the common spices). Each goes in as something you can buy
 * (recipe-math buyableAmount: "1 head" of garlic, "1 tub" of sour cream), or as the usual when there is one; the Recipe
 * keeps its cooking amounts. Items are shared (split evenly) unless `shared: false` and carry recipe_id; no prices.
 */
export async function addRecipeToCart(ctx: Ctx, recipeId: string, opts: { skip?: string[]; shared?: boolean; forMemberId?: string } = {}): Promise<AddRecipeResult> {
  await requireActive(ctx);
  const addedBy = opts.forMemberId ?? ctx.memberId;
  if (opts.forMemberId) {
    const [m] = await db.select({ id: members.id }).from(members).where(and(eq(members.id, opts.forMemberId), eq(members.groupId, ctx.groupId)));
    if (!m) throw new Error("That person isn't in this group.");
  }
  const recipe = await getRecipe(ctx, recipeId);
  const skip = (opts.skip ?? []).map((s) => s.trim()).filter(Boolean);
  const { have, need } = await recipeShoppingList(ctx, recipe, skip);
  const open = await db
    .select({ name: cartItems.name, shared: cartItems.shared, recipeId: cartItems.recipeId })
    .from(cartItems)
    .where(and(eq(cartItems.groupId, ctx.groupId), eq(cartItems.status, "open")));
  const inCart = (name: string) => open.some((o) => (o.recipeId === recipe.id || o.shared) && (coveredBy(name, [o.name]) || coveredBy(o.name, [name])));
  const alreadyInCart = need.filter((i) => inCart(i.name)).map((i) => i.name);
  const { buy, assumed } = recipeBuyList(need.filter((i) => !inCart(i.name)), await getNotKept(ctx));
  const shared = opts.forMemberId ? false : (opts.shared ?? true);
  // A usual wins over the default buyable size: the house's for shared items, the person's for theirs, looked up the
  // way every add looks it up (cart.usualsOf: the row someone said, else Cart history).
  const sharedOf = (i: (typeof buy)[number]["ingredient"]) => (i.shared === false ? false : shared);
  const [houseUsuals, ownUsuals] = await Promise.all([
    usualsOf(ctx.groupId, { shared: true }, buy.filter((b) => sharedOf(b.ingredient)).map((b) => b.line.name)),
    usualsOf(ctx.groupId, { memberId: addedBy }, buy.filter((b) => !sharedOf(b.ingredient)).map((b) => b.line.name)),
  ]);
  const rows = buy.length
    ? await db
        .insert(cartItems)
        .values(
          buy.map(({ ingredient: i, line }) => {
            const isShared = sharedOf(i);
            const usual = (isShared ? houseUsuals : ownUsuals).get(line.name);
            const amount = usual ? { quantity: usual.quantity, unit: usual.unit } : { quantity: line.quantity, unit: line.unit };
            const name = usual?.name ?? line.name;
            return {
              groupId: ctx.groupId,
              // Cart items read like the rest of the Cart ("Ground beef"); Recipes keep lower-case search names.
              name: name.charAt(0).toUpperCase() + name.slice(1),
              qty: usual?.qty ?? line.qty,
              quantity: amount.quantity === null ? null : String(roundQuantity(amount.quantity)),
              unit: amount.unit,
              addedBy,
              shared: isShared,
              estCents: null,
              recipeId: recipe.id,
            };
          }),
        )
        .returning()
    : [];
  if (rows.length) await record(ctx.groupId, ctx.memberId, "cart.recipe", `put ${rows.length} ingredient${rows.length === 1 ? "" : "s"} for ${recipe.title} on the Cart${addedBy !== ctx.memberId ? ` for ${(await namesFor(ctx.groupId)).get(addedBy) ?? "someone"}` : ""}`, { table: "recipes", id: recipe.id }, sourceOf(ctx));
  return { recipe, added: rows.map((r) => ({ id: r.id, name: r.name, qty: r.qty })), have: have.map((i) => i.name), alreadyInCart, assumed };
}

/**
 * The Instacart recipe page for a Recipe (every ingredient; Instacart lets the shopper untick what they have).
 * Cached on the Recipe and made again only when its title, servings or ingredients changed. Throws
 * InstacartUnavailableError when Instacart can't be reached.
 */
export async function recipeLink(ctx: GroupCtx, recipeId: string): Promise<{ recipe: Recipe; url: string; cached: boolean }> {
  const recipe = await getRecipe(ctx, recipeId);
  const [row] = await db.select().from(recipes).where(and(eq(recipes.id, recipe.id), eq(recipes.groupId, ctx.groupId)));
  const key = recipeKey(row);
  if (row.instacartUrl && row.instacartKey === key) return { recipe, url: row.instacartUrl, cached: true };
  const linkback = dashboardUrl(`/g/${ctx.groupId}/cart`);
  const { url } = await instacartClient().recipePage({
    title: row.title,
    servings: row.servings,
    cookingTimeMinutes: row.cookingTimeMinutes,
    instructions: row.steps,
    ingredients: row.ingredients.map((i) => ({ name: i.name, displayText: i.display_text, measurements: [measurementOrEach(i.quantity, i.unit)] })),
    linkbackUrl: linkback && /^https?:\/\//.test(linkback) ? linkback : null,
    enablePantryItems: true,
  });
  await db.update(recipes).set({ instacartUrl: url, instacartUrlAt: new Date(), instacartKey: key }).where(eq(recipes.id, row.id));
  return { recipe: { ...recipe, instacartUrl: url }, url, cached: false };
}

/** Recipes with a planned day from `fromDay` on (Home's "Tacos are Friday"), soonest first. */
export async function upcomingRecipes(ctx: GroupCtx, fromDay: string): Promise<Recipe[]> {
  const list = await listRecipes(ctx, 50);
  return list.filter((r) => r.plannedFor && r.plannedFor >= fromDay).sort((a, b) => a.plannedFor!.localeCompare(b.plannedFor!));
}
