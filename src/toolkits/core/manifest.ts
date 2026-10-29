import type { ToolkitManifest } from "../types";
import { dashboardTools } from "./dashboard";
import { memberTools } from "./members";
import { peopleTools } from "./people";
import { reminderTools } from "./reminders";
import { reportTools } from "./report";
import { settingsTools } from "./settings";

export const core = {
  id: "core",
  name: "Core",
  description: "Members and approvals, settings, what Roomie knows about you, the dashboard link, reminders and the Group Report. Always on.",
  tools: { ...memberTools, ...peopleTools, ...settingsTools, ...dashboardTools, ...reminderTools, ...reportTools },
} satisfies ToolkitManifest<"core">;
