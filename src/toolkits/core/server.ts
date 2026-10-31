import { defineToolkit } from "../define";
import { dashboardTools } from "./dashboard";
import { core as manifest } from "./manifest";
import { memberTools } from "./members";
import { peopleTools } from "./people";
import { pollTools } from "./polls";
import { reminderTools } from "./reminders";
import { reportTools } from "./report";
import { settingsTools } from "./settings";

export const core = defineToolkit(manifest, {
  tools: { ...memberTools, ...peopleTools, ...settingsTools, ...dashboardTools, ...reminderTools, ...reportTools, ...pollTools },
});
