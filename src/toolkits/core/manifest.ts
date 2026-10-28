import type { ToolkitManifest } from "../types";
import { memberTools } from "./members";
import { reminderTools } from "./reminders";
import { reportTools } from "./report";

export const core = {
  id: "core",
  name: "Core",
  description: "Members, reminders and the Group Report. Always on.",
  tools: { ...memberTools, ...reminderTools, ...reportTools },
} satisfies ToolkitManifest<"core">;
