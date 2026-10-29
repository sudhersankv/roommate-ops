import { defineManifest } from "../define";

export const chores = defineManifest({
  id: "chores",
  name: "Chores",
  description: "The chore chart: whose turn it is (Rotation), done and passed turns, streaks, what's due.",
  summary: "A fair chore chart: whose turn it is and who's been slacking.",
  longDescription:
    "Say \"I did the dishes\" and Roomie marks it on the chart. Each chore has a Rotation, so it knows whose turn is next; pass your turn when you can't, and streaks keep score. Roomie nudges whoever's up once a day, and Home shows what's yours today.",
  icon: "ListChecks",
  category: "home",
  tags: ["chores", "rotation", "dishes", "trash", "cleaning", "streaks"],
  defaultOn: true,
  status: "stable",
  gate: {
    criterion: "Chores: dishes, trash, cleaning, whose turn it is, passing a turn, who's slacking on the chart.",
    examples: ["I did the dishes", "whose turn is trash?", "skip my turn on trash", "who's slacking?"],
  },
  persona: `- Chores: "I did the dishes" is log_chore for the sender; "Dev took out the trash" is log_chore with who=Dev. "Whose turn is trash" / "what's due" is chore_status. "Skip my turn" / "I can't do it today, pass" is chore_skip. "Who's slacking" is hall_of_shame: call it "the chart" and keep it friendly. After a done, say whose turn is next if the tool says.`,
  abilities: {
    log_chore: "Mark a chore done, for you or someone else",
    chore_add: "Put a recurring chore on the chart, with a Rotation",
    chore_remove: "Admins: take a chore off the chart",
    chore_status: "Say whose turn it is and what's due or overdue",
    chore_skip: "Pass your turn to the next person",
    hall_of_shame: "The chart: who's done the fewest this week, kept friendly",
  },
  dashboard: {
    nav: { label: "Chores", href: (g) => `/g/${g}/chores`, icon: "ListChecks", order: 30 },
    pages: ["chores"],
  },
});
