import { defineToolkit } from "../define";
import { choreTools } from "./chores";
import { chores as manifest } from "./manifest";

export const chores = defineToolkit(manifest, {
  tools: choreTools,
  // Home: Today right after your standing (Splitting), before the Cart.
  dashboard: { home: () => import("./dashboard").then((m) => m.ChoresHome), homeOrder: 15 },
});
