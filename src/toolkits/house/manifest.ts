import { defineManifest } from "../define";

// Chores and Upkeep as one Trick with two tabs (ADR 0015). The chores / maintenance tables and services are unchanged.
export const house = defineManifest({
  id: "house",
  name: "House",
  description: "The chore chart (whose turn, done and passed turns, streaks, what's due) and the house's upkeep on a schedule (filters, smoke alarms).",
  summary: "The chore chart and the house care nobody remembers, on schedule.",
  longDescription:
    "Say \"I did the dishes\" and Roomie marks it on the chart. Each chore has a Rotation, so it knows whose turn is next; pass your turn when you can't, and streaks keep score. Tell it how often the filter or the smoke alarms need doing and it keeps track, in the Group's time zone. Roomie nudges whoever's up once a day, and Home shows what's yours today.",
  icon: "ListChecks",
  category: "home",
  // "chores" and "upkeep" stay as words people say ("roomie, learn chores" finds House).
  tags: ["chores", "upkeep", "rotation", "dishes", "trash", "cleaning", "streaks", "maintenance", "filters", "smoke alarms", "house care"],
  defaultOn: true,
  status: "stable",
  gate: {
    criterion: "The house's own routine: chores (dishes, trash, cleaning, whose turn it is, passing a turn, who's slacking on the chart) and the upkeep the group does itself on a schedule (filters, smoke alarms, gutters). Not something broken that the landlord has to fix.",
    examples: ["I did the dishes", "whose turn is trash?", "skip my turn on trash", "who's slacking?", "changed the air filter", "track the AC filter every 90 days", "what upkeep is due?"],
  },
  persona: [
    `- Chores: "I did the dishes" is log_chore for the sender; "Dev took out the trash" is log_chore with who=Dev. "Whose turn is trash" / "what's due" is chore_status. "Skip my turn" / "I can't do it today, pass" is chore_skip. "Who's slacking" is hall_of_shame: call it "the chart" and keep it friendly. After a done, say whose turn is next if the tool says.`,
    `- Upkeep: "changed the air filter" is upkeep_done; "what's due this week" is chore_status plus upkeep_status (dueOnly).`,
  ].join("\n"),
  abilities: {
    log_chore: "Mark a chore done, for you or someone else",
    chore_add: "Put a recurring chore on the chart, with a Rotation",
    chore_remove: "Admins: take a chore off the chart",
    chore_status: "Say whose turn it is and what's due or overdue",
    chore_skip: "Pass your turn to the next person",
    hall_of_shame: "The chart: who's done the fewest this week, kept friendly",
    upkeep_add: "Track a recurring upkeep item",
    upkeep_done: "Mark an upkeep item done",
    upkeep_status: "Say what's overdue or due soon",
    upkeep_remove: "Stop tracking an upkeep item",
  },
  adminOnly: {
    chore_remove: { action: String.raw`remove|delete|drop|take\b.*\boff|get rid|no more|stop`, target: "chore", ask: `Take {target} off the chart (its history goes too)?` },
    upkeep_remove: { action: String.raw`remove|delete|drop|stop|untrack|get rid|no more`, target: "item", ask: `Stop tracking {target}?` },
  },
  // Money, the landlord, then the house in the Bundle and the report (ADR 0017).
  postOrder: 30,
  dashboard: {
    nav: { label: "House", href: (g) => `/g/${g}/house`, icon: "ListChecks", order: 30 },
    pages: ["house"],
  },
});
