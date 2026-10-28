import type { ToolkitManifest } from "../types";
import { cartTools } from "./cart";

export const groceries = {
  id: "groceries",
  name: "Groceries",
  description: "The shared grocery Cart: adding and removing items, checking out, logging what the shop cost.",
  tools: cartTools,
} satisfies ToolkitManifest;
