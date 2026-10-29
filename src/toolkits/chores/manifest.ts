import { defineManifest } from "../define";

export const chores = defineManifest({
  id: "chores",
  name: "Chores",
  description: "The chore chart: who did what, whose turn it is, overdue chores.",
  summary: "A fair chore chart: whose turn it is and who's been slacking.",
  longDescription:
    "Say \"I did the dishes\" and Roomie marks it on the chart. It knows whose turn each chore is, what's overdue and who's on a streak. The Home screen shows what's yours today.",
  icon: "ListChecks",
  category: "home",
  tags: ["chores", "rotation", "dishes", "trash", "cleaning"],
  defaultOn: true,
  status: "stable",
  gate: {
    criterion: "Chores: dishes, trash, cleaning, whose turn it is.",
    examples: ["I did the dishes", "whose turn is trash?", "add vacuuming every week"],
  },
  abilities: {
    log_chore: "Mark a chore done",
    add_chore: "Put a recurring chore on the chart",
    chore_status: "Say whose turn it is and what's overdue",
  },
  dashboard: {
    nav: { label: "Chores", href: (g) => `/g/${g}/chores`, icon: "ListChecks", order: 30 },
    pages: ["chores"],
  },
});
