import type { ToolkitManifest } from "../types";
import { choreTools } from "./chores";

export const chores = {
  id: "chores",
  name: "Chores",
  description: "The chore chart: whose turn it is (Rotation), done and passed turns, streaks, what's due.",
  tools: choreTools,
} satisfies ToolkitManifest;
