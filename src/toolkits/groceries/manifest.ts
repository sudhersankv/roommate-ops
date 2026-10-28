import type { ToolkitManifest } from "../types";
import { cartTools } from "./cart";
import { recipeTools } from "./recipes";

export const groceries = {
  id: "groceries",
  name: "Groceries",
  description: "The shared grocery Cart, Recipes and the Pantry: adding and removing items, cooking plans, the Instacart checkout, logging what the shop cost.",
  tools: { ...cartTools, ...recipeTools },
} satisfies ToolkitManifest;
