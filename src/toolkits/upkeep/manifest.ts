import { defineManifest } from "../define";

export const upkeep = defineManifest({
  id: "upkeep",
  name: "Upkeep",
  description: "Recurring home maintenance such as filters, smoke alarms and gutters.",
  summary: "Filters, smoke alarms and the rest of the house care, on schedule.",
  longDescription:
    "Tell Roomie how often something needs doing (\"change the AC filter every 90 days\") and it keeps track. It knows what's overdue or coming up, and \"changed the filter\" resets the clock.",
  icon: "Wrench",
  category: "home",
  tags: ["maintenance", "filters", "smoke alarms", "house care"],
  defaultOn: true,
  status: "stable",
  gate: {
    criterion: "Home maintenance on a schedule: filters, smoke alarms, gutters, repairs.",
    examples: ["changed the air filter", "track the AC filter every 90 days", "what upkeep is due?"],
  },
  abilities: {
    add_maintenance: "Track a recurring upkeep item",
    maintenance_done: "Mark an upkeep item done",
    maintenance_status: "Say what's overdue or due soon",
  },
  // Upkeep lives on the Chores page; with Chores off, its tab still gets you there.
  dashboard: {
    nav: { label: "Upkeep", href: (g) => `/g/${g}/chores`, icon: "Wrench", order: 40 },
    pages: ["chores"],
  },
});
