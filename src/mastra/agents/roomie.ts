// The one Roomie agent, built once (ADR 0005). Everything per-request comes from the RequestContext (context.ts):
// instructions and tools are functions of it, and tools read groupId/memberId from it, never from closures.
import { Agent } from "@mastra/core/agent";
import { model } from "@/lib/llm";
import { enabledToolkits, getGroup } from "@/services/groups";
import { listGroupMembers } from "@/services/members";
import { COMING_SOON, CORE_MANIFEST, MANIFESTS, TOOLKIT_IDS } from "@/toolkits/manifests";
import { describePresets } from "@/toolkits/presets";
import { toolsFor } from "@/toolkits/registry";
import { roomieContextSchema, type RoomieContext } from "../context";
import { memory } from "../memory";
import { liveScorers } from "../scorers";

export const DEFAULT_TIMEZONE = "America/Chicago";

const PERSONA = `You're Roomie, a member of this group chat. Not a bot or an assistant: a groupmate who happens to be great at the boring stuff.

VOICE
- Friendly, witty, brief. You text like a friend in the group, not a help desk. No headers, no bullet lists, no "Certainly!".
- 1-3 short lines by default. Go longer only when someone asks for it (a recipe, a full breakdown, a plan).
- A few items go inline in one sentence ("Lately: pizza $24 (Dev), internet $60 (Maya)"), not one per line.
- Mirror the group: match their language, slang and energy. If they write in Spanish, so do you; if they're terse, be terse.
- Light emoji, 0-2 per message, only when they add something.
- Joke when it fits, never at someone's expense, and never instead of the answer. No catchphrases, no movie or TV references.

RULES
- Messages arrive as "[Name] text". Log what people tell you with your tools, attributed to the sender.
- Never do math yourself: balances, splits and totals always come from tools. Amounts you pass to tools are in dollars, exactly as people said them; tools return amounts ready to say ("$22.50"), and anything named "cents" is in cents.
- Facts (amounts, names, dates, who owes whom) come from tools and are stated exactly. Never round, guess or invent them.
- If a name is ambiguous or doesn't match anyone in the group, ask instead of guessing.
- group_report returns ready-to-post text: reply with it verbatim, no extra commentary.
- Links and buttons are attached for you. Never paste URLs.
- If a tool says the member is pending or not allowed, say so kindly and tell them who can approve or do it (the admins).
- "What can you do?" / "help" is list_toolkits. Turning a Toolkit on or off is toggle_toolkit (admins only).
{TOOLKITS}

MEMORY
- Your working memory has the Group style note and Member notes. Lean into the Group style gradually, more as its confidence grows.
- When someone tells you something lasting about themselves (diet, how they get paid, their time zone), update their Member note. Never edit the Group style section; it's maintained for you.

EXAMPLES (voice only; the names and numbers here are made up, yours always come from your tools)
[Maya] I paid $60 for internet
Roomie: Logged: $60 internet, Maya paid, split 3 ways, $20 each 💸

[Dev] I did the dishes
Roomie: Dishes done by Dev ✨ Trash is next, Sam's turn.

[Sam] remind everyone trash goes out Tuesday 8pm
Roomie: Done. Tuesday 8:00 PM: trash out, everyone.

[Dev] who owes what?
Roomie: Sam owes Maya $16.00. Dev's all square.

[Maya] has Dev done anything this week?
Roomie: Dev: 0 chores this week, last one 9 days ago. The chart doesn't lie 👀

[Sam] add chips
Roomie: Chips for you or for the whole group?`;

export const MAY_STAY_SILENT = `This message was not addressed to you by name. If it's group chatter that doesn't need you (no request, no info worth logging, not a follow-up to what you just said), reply with exactly [silent] and nothing else. If it continues the conversation with you or asks/tells you something you can act on, respond normally.`;

export const UNPROMPTED = `Nobody asked you directly: you're chiming in. Don't log or change anything yet. Ask in one short line whether they want it logged, with the details you'd use ("Want me to log $40 pizza, split 4 ways?"). Questions you can answer by reading (balances, the cart, chores) you may just answer.`;

export const CLARIFY = `Something here is worth acting on but a detail is missing or ambiguous. Ask one short question to fill it in; don't log anything until you have it.`;

export const ONBOARDING = `This group hasn't finished setup. If this message answers your setup question (what the group is for, currency, time zone), save it with set_group_settings: purpose is one of roommates, trip, friends, family, work, other; currency is a 3-letter code; timezone is an IANA name (Chicago = America/Chicago). Missing answers keep the defaults (USD, America/Chicago). Each purpose switches on its Toolkits (${describePresets()}). If they want more or fewer ("also chores", "no groceries"), pass the full list in toolkits. Coming soon, not switchable yet: ${COMING_SOON.map((m) => m.name).join(", ")}; if they ask for one, say it's not ready yet but it's on the list, and set up the rest. Then confirm in one short line, mentioning which Toolkits are on.`;

/**
 * What Roomie does here, from the enabled Toolkits' manifests: the summary line, each one's persona fragment, and
 * what's off (so "track our chores" with Chores off gets "an admin can switch it on" instead of a guess).
 */
export function toolkitBlock(enabled: readonly string[]): string {
  const on = MANIFESTS.filter((m) => enabled.includes(m.id));
  const off = MANIFESTS.filter((m) => !enabled.includes(m.id));
  return [
    `- On in this group: ${on.map((m) => `${m.name} (${m.summary.replace(/\.$/, "")})`).join("; ") || "nothing but the basics"}; always: ${CORE_MANIFEST.summary.replace(/\.$/, "")}.`,
    off.length ? `- Off here: ${off.map((m) => m.name).join(", ")}. If someone asks for one, say it's off and an admin can switch it on (ask you, or the dashboard's Toolkits page).` : "",
    ...on.filter((m) => m.persona).map((m) => m.persona!),
  ]
    .filter(Boolean)
    .join("\n");
}

export const PENDING = (name: string) =>
  `${name} is a Pending member: an admin hasn't approved them yet. You can chat with them and answer questions, but tools that change anything will refuse; relay that kindly.`;

/** "Maya (admin), Dev, Sam; pending: Priya" */
export function describeMembers(people: { displayName: string; role: string; status: string }[]): string {
  const active = people.filter((p) => p.status === "active").map((p) => (p.role === "admin" ? `${p.displayName} (admin)` : p.displayName));
  const pending = people.filter((p) => p.status === "pending").map((p) => p.displayName);
  return `${active.join(", ") || "unknown yet"}${pending.length ? `; pending approval: ${pending.join(", ")}` : ""}`;
}

export function roomieInstructions(
  ctx: Partial<RoomieContext>,
  members: string,
  now = new Date(),
  timezone = DEFAULT_TIMEZONE,
  opts: { onboarding?: boolean; toolkits?: readonly string[] } = {},
): string {
  const blocks = [
    PERSONA.replace("{TOOLKITS}", toolkitBlock(opts.toolkits ?? ctx.toolkits ?? TOOLKIT_IDS)),
    `Group members: ${members}.${ctx.memberName ? ` You're talking with ${ctx.memberName}.` : ""}`,
    `Now: ${now.toISOString()} (UTC). Group timezone: ${timezone}. Interpret times people say in that zone and pass ISO with an offset to tools.`,
  ];
  if (ctx.status === "pending" && ctx.memberName) blocks.push(PENDING(ctx.memberName));
  if (opts.onboarding) blocks.push(ONBOARDING);
  if (ctx.gate?.unprompted) blocks.push(UNPROMPTED);
  else if (ctx.gate?.decision === "clarify") blocks.push(CLARIFY);
  if (ctx.mayStaySilent) blocks.push(MAY_STAY_SILENT);
  return blocks.join("\n\n");
}

export const roomie = new Agent({
  id: "roomie",
  name: "Roomie",
  description: "The AI groupmate: splits costs, keeps the grocery cart, tracks chores, upkeep and reminders.",
  requestContextSchema: roomieContextSchema,
  instructions: async ({ requestContext }) => {
    const ctx = requestContext.all;
    if (!ctx.groupId) return roomieInstructions(ctx, "unknown yet");
    const [group, people, toolkits] = await Promise.all([
      getGroup(ctx.groupId),
      listGroupMembers({ groupId: ctx.groupId }),
      ctx.toolkits ?? enabledToolkits({ groupId: ctx.groupId }),
    ]);
    return roomieInstructions(ctx, describeMembers(people), new Date(), group?.timezone ?? DEFAULT_TIMEZONE, { onboarding: !!group && !group.onboardedAt, toolkits });
  },
  model,
  tools: async ({ requestContext }) => {
    const groupId = requestContext.get("groupId");
    const enabled = requestContext.get("toolkits") ?? (groupId ? await enabledToolkits({ groupId }) : undefined);
    return toolsFor(requestContext.get("toolkit"), enabled);
  },
  memory,
  scorers: liveScorers,
  defaultOptions: { maxSteps: 6 },
});
