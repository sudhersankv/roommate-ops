import { cartReportParts, listOpenItems } from "@/services/cart";
import { seedPantry } from "@/services/pantry";
import { restockBundleLine } from "@/services/restock";
import { defineToolkit } from "../define";
import { cartTools } from "./cart";
import { groceries as manifest } from "./manifest";
import { recipeTools } from "./recipes";
import { restockTools } from "./restock";

export const groceries = defineToolkit(manifest, {
  tools: { ...cartTools, ...recipeTools, ...restockTools },
  dashboard: {
    home: () => import("./dashboard").then((m) => m.GroceriesHome),
    settings: () => import("./dashboard").then((m) => m.GroceriesSettings),
  },
  // A Pantry to start from (salt, pepper, oil), only if the Group never had one.
  onEnable: (ctx) => seedPantry(ctx),
  // The morning Bundle says what's probably low (shared items only; a Member's own go to their DM).
  bundle: (ctx, now) => restockBundleLine(ctx, now),
  // The weekly report says how full the Cart is (no prices).
  report: async (ctx) => cartReportParts((await listOpenItems(ctx)).length),
});
