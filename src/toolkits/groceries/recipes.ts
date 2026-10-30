// Recipe and Pantry tools: thin wrappers over services/recipes and services/pantry. A Recipe never touches the Cart
// unless someone asks (recipe_add_to_cart). No prices; the only link is the Instacart one, when someone asks for it.
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { pantry, recipes } from "@/services";
import type { Recipe } from "@/services/recipes";
import { InstacartUnavailableError } from "@/integrations/instacart";
import { ctxOf } from "../util";

/** The recipe as chat text: title, servings, need / have and how many steps (the steps are on the dashboard). */
export function recipeText(r: Pick<Recipe, "title" | "servings" | "cookingTimeMinutes" | "steps">, have: { display_text: string }[], need: { display_text: string }[]): string {
  const time = r.cookingTimeMinutes ? `, ${r.cookingTimeMinutes} min` : "";
  return [
    `${r.title} (serves ${r.servings}${time})`,
    need.length ? `Need: ${need.map((i) => i.display_text).join(", ")}` : "Need: nothing, you have it all",
    have.length ? `Have: ${have.map((i) => i.display_text).join(", ")}` : "",
    r.steps.length ? `${r.steps.length} steps, on the Cart page.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export const recipeTools = {
  recipe_draft: createTool({
    id: "recipe_draft",
    description:
      "Write and save a Recipe for the group ('tacos for 5 friday', 'something vegetarian for dinner'). Servings default to the group's size. Returns `text` (title, servings, need / have, how many steps), ready to post as is (no lists, don't write out the steps unless asked), and `askToAdd`. It does NOT touch the cart: post the text, then ask `askToAdd` unless they explicitly asked to add the ingredients in the same message (then call recipe_add_to_cart).",
    inputSchema: z.object({
      request: z.string().min(1).describe("The dish and anything that matters, in their words"),
      servings: z.number().int().positive().max(100).optional().describe("How many people; omit for everyone in the group"),
      constraints: z.string().optional().describe("Diet, budget, time ('vegetarian', 'under 30 minutes')"),
      plannedFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("The day it's for in the group's time zone, YYYY-MM-DD ('friday' -> the coming Friday)"),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const { draft, have, need } = await recipes.draftRecipe(ctx, input);
      const saved = await recipes.saveRecipe(ctx, { ...draft, plannedFor: input.plannedFor, source: "roomie" });
      return {
        recipeId: saved.id,
        title: saved.title,
        servings: saved.servings,
        plannedFor: saved.plannedFor,
        text: recipeText(saved, have, need),
        haveCount: have.length,
        missingCount: need.length,
        askToAdd: need.length ? `Add the ${need.length} missing ingredient${need.length === 1 ? "" : "s"} to the cart?` : null,
        steps: saved.steps,
      };
    },
  }),
  recipe_add_to_cart: createTool({
    id: "recipe_add_to_cart",
    description:
      "Put a saved Recipe's missing ingredients in the cart, when someone asks ('yes add them', 'add the taco stuff'). Pantry items are left out automatically; put anything they say they already have in `skip` ('we have onions' -> ['onions']). Items are shared unless they say it's just for them.",
    inputSchema: z.object({
      recipe: z.string().optional().describe("Recipe id or title; omit for the newest recipe"),
      skip: z.array(z.string()).optional().describe("Ingredients they already have, e.g. ['onions']"),
      shared: z.boolean().optional().describe("false when it's just for the sender; default true"),
    }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      const r = await recipes.addRecipeToCart(ctx, input.recipe ?? "", { skip: input.skip, shared: input.shared });
      return {
        recipe: r.recipe.title,
        added: r.added.map((i) => `${i.name}${i.qty && i.qty !== "1" ? ` (${i.qty})` : ""}`),
        addedCount: r.added.length,
        skippedHave: r.have,
        alreadyInCart: r.alreadyInCart,
      };
    },
  }),
  recipe_link: createTool({
    id: "recipe_link",
    description: "The Instacart page for a saved Recipe ('send me the instacart link for the tacos'). The button is attached for you. If `available` is false, relay `message`.",
    inputSchema: z.object({ recipe: z.string().optional().describe("Recipe id or title; omit for the newest recipe") }),
    execute: async (input, context) => {
      const ctx = ctxOf(context);
      try {
        const { recipe, url } = await recipes.recipeLink(ctx, input.recipe ?? "");
        return { available: true, recipe: recipe.title, links: [{ text: `🥘 ${recipe.title} on Instacart`, url }] };
      } catch (e) {
        if (e instanceof InstacartUnavailableError) return { available: false, message: e.message };
        throw e;
      }
    },
  }),
  pantry_set: createTool({
    id: "pantry_set",
    description: "Change the Pantry: things the group always has, left out when a recipe goes into the cart ('we always have salt and oil' -> add ['salt', 'oil']; 'we're out of rice for good' -> remove ['rice']).",
    inputSchema: z.object({
      add: z.array(z.string().min(1)).optional(),
      remove: z.array(z.string().min(1)).optional(),
    }),
    execute: async (input, context) => ({ pantry: await pantry.updatePantry(ctxOf(context), input) }),
  }),
  pantry_list: createTool({
    id: "pantry_list",
    description: "What's in the Pantry (what the group always has).",
    inputSchema: z.object({}),
    execute: async (_input, context) => ({ pantry: await pantry.getPantry(ctxOf(context)) }),
  }),
};
