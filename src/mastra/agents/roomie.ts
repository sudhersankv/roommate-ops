// The one Roomie agent, built once (ADR 0005). Everything per-request comes from the RequestContext (context.ts):
// instructions and tools are functions of it, and tools read groupId/memberId from it, never from closures.
// The persona is composed per Group in ../persona.ts (ADR 0012): archetype, dials, quirks, Learned style, mood, and
// the enabled Toolkits' manifest fragments (instructions.ts fills that slot).
import { Agent } from "@mastra/core/agent";
import { model } from "@/lib/llm";
import { changesSinceRoomieSpoke } from "@/services/activity";
import { roomieRecentTexts } from "@/services/chatlog";
import { enabledToolkits, getGroup } from "@/services/groups";
import { listGroupMembers, peopleFacts } from "@/services/members";
import { getPersonality, groupMood } from "@/services/personality";
import { toolsFor } from "@/toolkits/registry";
import { roomieContextSchema } from "../context";
import { memory } from "../memory";
import { liveScorers } from "../scorers";
import { DEFAULT_TIMEZONE, describeMembers, roomieInstructions } from "./instructions";

// The instructions are pure and live in instructions.ts (importable without a DB); re-exported for callers.
export * from "./instructions";

export const roomie = new Agent({
  id: "roomie",
  name: "Roomie",
  description: "The group's pet: splits costs, keeps the grocery cart, tracks chores, upkeep and reminders, in the group's own voice.",
  requestContextSchema: roomieContextSchema,
  instructions: async ({ requestContext }) => {
    const ctx = requestContext.all;
    if (!ctx.groupId) return roomieInstructions(ctx, "unknown yet");
    const g = { groupId: ctx.groupId };
    const [group, people, personality, mood, facts, recentReplies, toolkits, changes] = await Promise.all([
      getGroup(ctx.groupId),
      listGroupMembers(g),
      getPersonality(g),
      groupMood(g).catch(() => undefined),
      peopleFacts(g),
      roomieRecentTexts(ctx.groupId),
      ctx.toolkits ?? enabledToolkits(g),
      changesSinceRoomieSpoke(ctx.groupId, new Date(), { ui: ctx.source === "ui" }).catch(() => []),
    ]);
    return roomieInstructions(ctx, describeMembers(people), new Date(), group?.timezone ?? DEFAULT_TIMEZONE, {
      onboarding: !!group && !group.onboardedAt,
      currency: group?.currency,
      groupName: group?.name,
      toolkits,
      personality,
      mood,
      people: facts,
      recentReplies,
      changes,
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
