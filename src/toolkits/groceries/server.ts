import { seedPantry } from "@/services/pantry";
import { defineToolkit } from "../define";
import { cartTools } from "./cart";
import { groceries as manifest } from "./manifest";
import { recipeTools } from "./recipes";

export const groceries = defineToolkit(manifest, {
  tools: { ...cartTools, ...recipeTools },
  dashboard: {
    home: () => import("./dashboard").then((m) => m.GroceriesHome),
    settings: () => import("./dashboard").then((m) => m.GroceriesSettings),
  },
  // A Pantry to start from (salt, pepper, oil), only if the Group never had one.
  onEnable: (ctx) => seedPantry(ctx),
});
