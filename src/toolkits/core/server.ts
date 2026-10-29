import { defineToolkit } from "../define";
import { dashboardTools } from "./dashboard";
import { core as manifest } from "./manifest";
import { memberTools } from "./members";
import { reminderTools } from "./reminders";
import { reportTools } from "./report";
import { settingsTools } from "./settings";

export const core = defineToolkit(manifest, {
  tools: { ...memberTools, ...settingsTools, ...dashboardTools, ...reminderTools, ...reportTools },
});
