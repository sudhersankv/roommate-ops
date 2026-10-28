import type { ToolkitManifest } from "../types";
import { upkeepTools } from "./upkeep";

export const upkeep = {
  id: "upkeep",
  name: "Upkeep",
  description: "Recurring home maintenance such as filters, smoke alarms and gutters.",
  tools: upkeepTools,
} satisfies ToolkitManifest;
