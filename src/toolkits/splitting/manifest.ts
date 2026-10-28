import type { ToolkitManifest } from "../types";
import { moneyTools } from "./money";

export const splitting = {
  id: "splitting",
  name: "Splitting",
  description: "Shared Expenses, Balances and Settlements: who paid, who owes what, settling up.",
  tools: moneyTools,
} satisfies ToolkitManifest;
