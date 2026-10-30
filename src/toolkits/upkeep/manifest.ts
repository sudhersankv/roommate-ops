import { defineManifest } from "../define";

export const upkeep = defineManifest({
  id: "upkeep",
  name: "Upkeep",
  description: "Recurring home maintenance such as filters, smoke alarms and gutters.",
  summary: "Filters, smoke alarms and the rest of the house care, on schedule.",
  longDescription:
    "Tell Roomie how often something needs doing (\"change the AC filter every 90 days\") and it keeps track, in the Group's time zone. It knows what's overdue or coming up, and \"changed the filter\" resets the clock. Roommates and families start with the usual five.",
  icon: "Wrench",
  category: "home",
  tags: ["maintenance", "filters", "smoke alarms", "house care"],
  defaultOn: true,
  status: "stable",
  gate: {
    criterion: "Home maintenance on a schedule: filters, smoke alarms, gutters, repairs.",
    examples: ["changed the air filter", "track the AC filter every 90 days", "what upkeep is due?"],
  },
  persona: `- Upkeep: "changed the air filter" is upkeep_done; "what's due this week" is chore_status plus upkeep_status (dueOnly).`,
  abilities: {
    upkeep_add: "Track a recurring upkeep item",
    upkeep_done: "Mark an upkeep item done",
    upkeep_status: "Say what's overdue or due soon",
    upkeep_remove: "Stop tracking an upkeep item",
  },
  adminOnly: {
    upkeep_remove: { action: String.raw`remove|delete|drop|stop|untrack|get rid|no more`, target: "item", ask: `Stop tracking {target}? Say "roomie, yes remove {target}".` },
  },
  // Upkeep lives on the Chores page's Upkeep tab; with Chores off, its own tab still gets you there.
  dashboard: {
    nav: { label: "Upkeep", href: (g) => `/g/${g}/chores?tab=upkeep`, icon: "Wrench", order: 40 },
    pages: ["chores"],
  },
});
