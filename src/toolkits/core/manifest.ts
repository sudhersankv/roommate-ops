import { defineManifest } from "../define";

/** Always on, never in the marketplace grid. Its Gate choice ("core") narrows to core tools only. */
export const core = defineManifest({
  id: "core",
  name: "Core",
  description: "Members and approvals, settings, what Roomie knows about you, the dashboard link, reminders and the Group Report. Always on.",
  summary: "Members, approvals, settings, reminders and the weekly report.",
  longDescription: "What Roomie always does: knows who's in the group, asks Admins to approve newcomers, sets reminders, posts the Group Report and sends your dashboard link.",
  icon: "Sparkles",
  category: "planning",
  tags: [],
  defaultOn: true,
  status: "stable",
  gate: {
    criterion:
      "Reminders at a time or date, and the group itself: members and approvals, settings (including Roomie's name, vibe and quirks), what Roomie can do and which Tricks it knows, teaching Roomie a Trick or making it learn or forget one ('roomie learn trips', 'roomie forget groceries', 'turn on chores'), lasting facts about a member ('remember I'm vegetarian', 'what do you know about me'), the dashboard link, the weekly report.",
    examples: ["remind everyone trash goes out tuesday 8pm", "what can you do?", "learn chores", "approve Priya", "send me the dashboard"],
  },
});
