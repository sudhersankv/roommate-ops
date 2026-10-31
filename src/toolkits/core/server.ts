import { defineToolkit } from "../define";
import { dashboardTools } from "./dashboard";
import { documentTools } from "./documents";
import { core as manifest } from "./manifest";
import { memberTools } from "./members";
import { peopleTools } from "./people";
import { pollTools } from "./polls";
import { reminderTools } from "./reminders";
import { reportTools } from "./report";
import { settingsTools } from "./settings";
import { skill } from "./skill";

export const core = defineToolkit(manifest, {
  skill,
  tools: { ...memberTools, ...peopleTools, ...settingsTools, ...dashboardTools, ...reminderTools, ...reportTools, ...documentTools, ...pollTools },
});
