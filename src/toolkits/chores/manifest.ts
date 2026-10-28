import type { ToolkitManifest } from "../types";
import { choreTools } from "./chores";

export const chores = {
  id: "chores",
  name: "Chores",
  description: "The chore chart: who did what, whose turn it is, overdue chores.",
  tools: choreTools,
} satisfies ToolkitManifest;
