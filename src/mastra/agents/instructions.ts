// Roomie's instructions, pure (no DB, no agent): the composed persona (../persona.ts, ADR 0012) with what's on/off
// from the enabled manifests in its Toolkit slot, and the per-request blocks. agents/roomie.ts fetches the facts and
// calls roomieInstructions; tests import this file directly.
import { defaultPersonality, type Personality } from "@/lib/personality";
import { describeNow } from "@/lib/time";
import { DEFAULT_TIMEZONE } from "@/services/schedule";
import { COMING_SOON, CORE_MANIFEST, MANIFESTS, TOOLKIT_IDS } from "@/toolkits/manifests";
import { describePresets } from "@/toolkits/presets";
import type { RoomieContext } from "../context";
import { composePersona, type PersonaFacts } from "../persona";

export { DEFAULT_TIMEZONE };

export const MAY_STAY_SILENT = `This message was not addressed to you by name. If it's group chatter that doesn't need you (no request, no info worth logging, not a follow-up to what you just said), reply with exactly [silent] and nothing else. If it continues the conversation with you or asks/tells you something you can act on, respond normally.`;

export const UNPROMPTED = `Nobody asked you directly: you're chiming in. Don't log or change anything yet. Ask in one short line whether they want it logged, with the details you'd use ("Want me to log $40 pizza, split 4 ways?"). Questions you can answer by reading (balances, the cart, chores) you may just answer.`;

export const CLARIFY = `Something here is worth acting on but a detail is missing or ambiguous. Ask one short question to fill it in; don't log anything until you have it.`;

export const ONBOARDING = `This group hasn't finished setup. If this message answers your setup question (what the group is for, currency, time zone), save it with set_group_settings: purpose is one of roommates, trip, friends, family, work, other; currency is a 3-letter code; timezone is what they said (a city like "Chicago", "CST", "India" or an IANA name): the tool maps it, and if it says it doesn't know the zone, ask which city they're in. A club, a team or anything else is other. You have one voice and one name (Roomie): if they offer you a vibe or a new name, thank them in a few words and carry on; don't pass it anywhere. Missing answers keep the defaults (USD, Chicago time, and the roommates Tricks when nobody says what the group is for). Each purpose teaches you its Tricks (${describePresets()}). If they want more or fewer ("also chores", "no groceries"), pass the full list in toolkits. Coming soon, can't be learned yet: ${COMING_SOON.map((m) => m.name).join(", ")}; if they ask for one, say it's not ready yet but it's on the list, and set up the rest. Then confirm in one or two short lines: the tool's \`learned\` line as it is (it names the Tricks you learned and what to say next), plus the starter chores and upkeep if the tool added some. Don't list what each Trick does.`;

export const PETTED = `Someone just petted you (/pet). Answer in character, 1-2 short lines, about your day as the group's roommate who keeps track: how you feel right now and maybe one real, harmless thing from the group (no amounts unless a tool gave them, no private facts). No tools, no questions about logging.`;

export const GREET = `This is the first message in the chat today. Start your reply with a very short hello in your voice (a few words, on the same line), then answer as usual.`;

/**
 * What Roomie does here, from the enabled Toolkits' manifests: the summary line, what's off (so "track our chores"
 * with Chores off gets "an admin can switch it on" instead of a guess), and each enabled one's persona fragment.
 * These fill composePersona's Toolkit slot.
 */
export function toolkitPersona(enabled: readonly string[]): string[] {
  const on = MANIFESTS.filter((m) => enabled.includes(m.id));
  const off = MANIFESTS.filter((m) => !enabled.includes(m.id));
  return [
    `- Tricks you know here: ${on.map((m) => `${m.name} (${m.summary.replace(/\.$/, "")})`).join("; ") || "none yet, only the basics"}; always: ${CORE_MANIFEST.summary.replace(/\.$/, "")}.`,
    off.length ? `- Not learned here yet: ${off.map((m) => m.name).join(", ")}. If someone asks for one, say you haven't learned it here yet and an admin can teach you ("roomie, learn ${off[0].name.toLowerCase()}", or the dashboard's Tricks page).` : "",
    `- Coming soon, nobody can teach you these yet: ${COMING_SOON.map((m) => m.name).join(", ")}.`,
    ...on.filter((m) => m.persona).map((m) => m.persona!),
  ].filter(Boolean);
}

export const toolkitBlock = (enabled: readonly string[]): string => toolkitPersona(enabled).join("\n");

export const PENDING = (name: string) =>
  `${name} is a Pending member: an admin hasn't approved them yet. You can chat with them and answer questions, but tools that change anything will refuse; relay that kindly.`;

/** "Maya (admin), Dev, Sam; pending: Priya" */
export function describeMembers(people: { displayName: string; role: string; status: string }[]): string {
  const active = people.filter((p) => p.status === "active").map((p) => (p.role === "admin" ? `${p.displayName} (admin)` : p.displayName));
  const pending = people.filter((p) => p.status === "pending").map((p) => p.displayName);
  return `${active.join(", ") || "unknown yet"}${pending.length ? `; pending approval: ${pending.join(", ")}` : ""}`;
}

export type InstructionOpts = { onboarding?: boolean; toolkits?: readonly string[]; personality?: Personality } & Partial<
  Omit<PersonaFacts, "personality" | "toolkitPersona" | "timezone">
>;

export function roomieInstructions(ctx: Partial<RoomieContext>, members: string, now = new Date(), timezone = DEFAULT_TIMEZONE, opts: InstructionOpts = {}): string {
  const { onboarding, toolkits, personality, ...facts } = opts;
  const blocks = [
    composePersona({ ...facts, personality: personality ?? defaultPersonality(), timezone, toolkitPersona: toolkitPersona(toolkits ?? ctx.toolkits ?? TOOLKIT_IDS) }),
    `Group members: ${members}.${ctx.memberName ? ` You're talking with ${ctx.memberName}.` : ""}`,
    `Now (local): ${describeNow(timezone, now)}. House timezone: ${timezone}. "Today", "tonight", "Tuesday 8pm" and "this week" mean that zone. Pass times to tools as local wall-clock without an offset (2026-11-03T20:00); the tools convert.`,
  ];
  if (ctx.status === "pending" && ctx.memberName) blocks.push(PENDING(ctx.memberName));
  if (onboarding) blocks.push(ONBOARDING);
  if (ctx.pet === "petted") blocks.push(PETTED);
  if (ctx.pet === "greet") blocks.push(GREET);
  if (ctx.gate?.unprompted) blocks.push(UNPROMPTED);
  else if (ctx.gate?.decision === "clarify") blocks.push(CLARIFY);
  if (ctx.mayStaySilent) blocks.push(MAY_STAY_SILENT);
  return blocks.join("\n\n");
}
