import { defineManifest } from "../define";

/** Always on, never in the marketplace grid. Its Gate choice ("core") narrows to core tools only. */
export const core = defineManifest({
  id: "core",
  name: "Core",
  description: "Members and approvals, settings, what Roomie knows about you, the dashboard link, reminders, polls, DMs, the Group Report and the group's documents. Always on.",
  summary: "Members, approvals, settings, reminders and the weekly report.",
  longDescription: "What Roomie always does: knows who's in the group, asks Admins to approve newcomers, sets reminders, posts the Group Report and sends your dashboard link.",
  icon: "Sparkles",
  category: "planning",
  tags: [],
  defaultOn: true,
  status: "stable",
  gate: {
    criterion:
      "Reminders at a time or date, the group's documents ('roomie keep this' on a photo or file, 'find the lease', 'the March internet bill'), and the group itself: members and approvals, settings, what Roomie can do and which Tricks it knows, teaching Roomie a Trick or making it learn or forget one ('roomie learn trips', 'roomie forget groceries', 'turn on chores'), lasting facts about a member ('remember I'm vegetarian', 'what do you know about me'), the dashboard link (for me, or for everyone: the group's Join link, rotating it, who may join, disconnecting someone's dashboard seat), the weekly report, turning a member's private nudges off or on ('roomie stop nudging me', 'nudge me again').",
    examples: ["remind everyone trash goes out tuesday 8pm", "roomie keep this, it's the lease", "roomie find the lease", "what can you do?", "learn house", "approve Priya", "send me the dashboard", "send us the dashboard"],
  },
  abilities: {
    keep_document: "Keep a photo or file someone sent: the lease, a bill, a notice",
    find_documents: "Find a kept document by name or kind",
    ask_poll: "Ask the chat a quick poll for who-questions (who was in, who's shopping)",
    set_nudges: "Stop or restart your private nudges",
  },
  adminOnly: {
    approve_member: { action: String.raw`\b(?:approve|accept|admit)|\blet\b.*\bin\b`, target: "name", ask: `Approve {target}?` },
    decline_member: { action: String.raw`\b(?:decline|reject|deny|refuse|not approve|don'?t approve)`, target: "name", ask: `Decline {target}?` },
    promote_member: { action: String.raw`\b(?:promote|admin)`, target: "name", ask: `Make {target} an admin?` },
    rotate_join_link: {
      // An instruction, not a question: "rotate the join link" passes, "should I rotate it?" / "what's the new link?" ask.
      action: String.raw`(?<!\b(?:what|whats|how|why|when|which|where|who|does|do|did|should|can|could|would|will|is|are)\b.*)(?:\b(?:rotate|reset|regenerate|renew|replace)\b|\bnew\b[^.?!]*\blink\b)`,
      ask: `Make a new Join link? The old one stops working.`,
    },
    set_join_policy: {
      action: String.raw`\b(?:join policy|approve (?:every|all|each)\b|every join|(?:pick|choose) (?:their|your|his|her) (?:own )?names?|let (?:anyone|everyone|people) (?:in|join|pick))`,
      ask: `Change who gets in from the Join link?`,
    },
    revoke_seat: {
      action: String.raw`\b(?:revoke|disconnect|unlink)|\b(?:kick|remove|boot)\b[^.?!]*\b(?:off|from) the dashboard`,
      target: "name",
      ask: `Disconnect the Google account on {target}'s seat?`,
    },
    toggle_toolkit: {
      action: String.raw`\b(?:learn|forget|teach|unlearn|enable|disable|stop|start)|\b(?:turn|switch)\b.*\b(?:on|off)\b`,
      target: "toolkit",
      ask: `Learn or forget {target}?`,
    },
    // Every field the call changes needs its own words: "roommates, USD, Chicago" sets purpose, currency and time zone,
    // never Tricks.
    set_group_settings: {
      action: String.raw`\bsettings?\b`,
      fields: {
        name: { words: String.raw`\b(?:rename\w*|group'?s? name|name (?:the|this|our) (?:group|chat)|call (?:the|this|our) (?:group|chat))\b`, byValue: true },
        purpose: { words: String.raw`\b(?:purpose|roommates?|flatmates?|housemates?|family|friends|trip|work(?:mates)?|colleagues|team)\b`, byValue: true },
        currency: { words: String.raw`\b(?:currency|usd|eur|gbp|inr|cad|aud|dollars?|euros?|pounds?|rupees?)\b`, byValue: true, byMeaning: "currency" },
        timezone: { words: String.raw`\b(?:time\s?zones?|city|tz|we(?:'re| are) in|live in|based in)\b`, byValue: true, byMeaning: "timezone" },
        chattiness: { words: String.raw`\b(?:chatt\w*|quiet\w*|talk (?:less|more)|speak up|pipe down|shush|normal)\b`, byValue: true },
        simplifyDebts: { words: String.raw`\b(?:simplif\w*|fewest|pairwise|pair by pair)\b` },
        toolkits: { words: String.raw`\b(?:tricks?|learn|forget|teach|unlearn)\b` },
        choresNudgeHour: { words: String.raw`\b(?:nudge\w*|chores? (?:reminder|ping)s?)\b` },
        reportDay: { words: String.raw`\breports?\b` },
        reportHour: { words: String.raw`\breports?\b` },
      },
      ask: `Change the group's {target}?`,
    },
  },
});
