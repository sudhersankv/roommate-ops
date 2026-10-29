import { defineToolkit } from "../define";
import { choreTools } from "./chores";
import { chores as manifest } from "./manifest";

export const chores = defineToolkit(manifest, {
  tools: choreTools,
  dashboard: { home: () => import("./dashboard").then((m) => m.ChoresHome) },
});
