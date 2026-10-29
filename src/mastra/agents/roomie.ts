// The one Roomie agent, built once (ADR 0005). Everything per-request comes from the RequestContext (context.ts):
// instructions and tools are functions of it, and tools read groupId/memberId from it, never from closures.
// The persona is composed per Group in ../persona.ts (ADR 0012): archetype, dials, quirks, Learned style, mood.
import { Agent } from "@mastra/core/agent";
import { model } from "@/lib/llm";
import { defaultPersonality, type Personality } from "@/lib/personality";
import { roomieRecentTexts } from "@/services/chatlog";
import { enabledToolkits, getGroup } from "@/services/groups";
import { listGroupMembers, peopleFacts } from "@/services/members";
import { getPersonality, groupMood } from "@/services/personality";
import { toolsFor, TOOLKITS } from "@/toolkits/registry";
import type { ToolkitId } from "@/toolkits/types";
import { roomieContextSchema, type RoomieContext } from "../context";
import { memory } from "../memory";
import { composePersona, type PersonaFacts } from "../persona";
import { liveScorers } from "../scorers";

export const DEFAULT_TIMEZONE = "America/Chicago";

export const MAY_STAY_SILENT = `This message was not addressed to you by name. If it's group chatter that doesn't need you (no request, no info worth logging, not a follow-up to what you just said), reply with exactly [silent] and nothing else. If it continues the conversation with you or asks/tells you something you can act on, respond normally.`;

export const UNPROMPTED = `Nobody asked you directly: you're chiming in. Don't log or change anything yet. Ask in one short line whether they want it logged, with the details you'd use ("Want me to log $40 pizza, split 4 ways?"). Questions you can answer by reading (balances, the cart, chores) you may just answer.`;

export const CLARIFY = `Something here is worth acting on but a detail is missing or ambiguous. Ask one short question to fill it in; don't log anything until you have it.`;

export const ONBOARDING = `This group hasn't finished setup. If this message answers your setup question (what the group is for, currency, time zone, your vibe), save it with set_group_settings: purpose is one of roommates, trip, friends, family, work, other; currency is a 3-letter code; timezone is an IANA name (Chicago = America/Chicago); personality.base is the vibe (chill, hype, deadpan, mom, gremlin, butler), and personality.name if they give you a name. Missing answers keep the defaults (USD, America/Chicago, chill). Then confirm in one short line in your (new) voice, mentioning which Toolkits are on.`;

export const PETTED = `Someone just petted you (/pet). Answer in character, 1-2 short lines, about your day as the group's pet: how you feel right now and maybe one real, harmless thing from the group (no amounts unless a tool gave them, no private facts). No tools, no questions about logging.`;

export const GREET = `This is the first message in the chat today. Start your reply with a very short hello in your voice (a few words, on the same line), then answer as usual.`;

export const PENDING = (name: string) =>
  `${name} is a Pending member: an admin hasn't approved them yet. You can chat with them and answer questions, but tools that change anything will refuse; relay that kindly.`;

/** "Maya (admin), Dev, Sam; pending: Priya" */
export function describeMembers(people: { displayName: string; role: string; status: string }[]): string {
  const active = people.filter((p) => p.status === "active").map((p) => (p.role === "admin" ? `${p.displayName} (admin)` : p.displayName));
  const pending = people.filter((p) => p.status === "pending").map((p) => p.displayName);
  return `${active.join(", ") || "unknown yet"}${pending.length ? `; pending approval: ${pending.join(", ")}` : ""}`;
}

export type InstructionOpts = { onboarding?: boolean } & Partial<Omit<PersonaFacts, "personality">> & { personality?: Personality };

export function roomieInstructions(ctx: Partial<RoomieContext>, members: string, now = new Date(), timezone = DEFAULT_TIMEZONE, opts: InstructionOpts = {}): string {
  const blocks = [
    composePersona({ ...opts, personality: opts.personality ?? defaultPersonality(), timezone }),
    `Group members: ${members}.${ctx.memberName ? ` You're talking with ${ctx.memberName}.` : ""}`,
    `Now: ${now.toISOString()} (UTC). Group timezone: ${timezone}. Interpret times people say in that zone and pass ISO with an offset to tools.`,
  ];
  if (ctx.status === "pending" && ctx.memberName) blocks.push(PENDING(ctx.memberName));
  if (opts.onboarding) blocks.push(ONBOARDING);
  if (ctx.pet === "petted") blocks.push(PETTED);
  if (ctx.pet === "greet") blocks.push(GREET);
  if (ctx.gate?.unprompted) blocks.push(UNPROMPTED);
  else if (ctx.gate?.decision === "clarify") blocks.push(CLARIFY);
  if (ctx.mayStaySilent) blocks.push(MAY_STAY_SILENT);
  return blocks.join("\n\n");
}

/** Persona lines from enabled Toolkits (`manifest.persona`, when a manifest has one). */
export function toolkitPersona(enabled: readonly ToolkitId[]): string[] {
  return TOOLKITS.filter((t) => enabled.includes(t.id))
    .map((t) => (t as { persona?: unknown }).persona)
    .filter((p): p is string => typeof p === "string" && !!p.trim());
}

export const roomie = new Agent({
  id: "roomie",
  name: "Roomie",
  description: "The group's pet: splits costs, keeps the grocery cart, tracks chores, upkeep and reminders, in the group's own voice.",
  requestContextSchema: roomieContextSchema,
  instructions: async ({ requestContext }) => {
    const ctx = requestContext.all;
    if (!ctx.groupId) return roomieInstructions(ctx, "unknown yet");
    const g = { groupId: ctx.groupId };
    const [group, people, personality, mood, facts, recentReplies, enabled] = await Promise.all([
      getGroup(ctx.groupId),
      listGroupMembers(g),
      getPersonality(g),
      groupMood(g).catch(() => undefined),
      peopleFacts(g),
      roomieRecentTexts(ctx.groupId),
      ctx.toolkits ? Promise.resolve(ctx.toolkits) : enabledToolkits(g),
    ]);
    return roomieInstructions(ctx, describeMembers(people), new Date(), group?.timezone ?? DEFAULT_TIMEZONE, {
      onboarding: !!group && !group.onboardedAt,
      personality,
      mood,
      people: facts,
      recentReplies,
      toolkitPersona: toolkitPersona(enabled),
    });
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
