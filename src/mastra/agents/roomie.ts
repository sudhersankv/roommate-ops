// The one Roomie agent, built once (ADR 0005). Everything per-request comes from the RequestContext (context.ts):
// instructions and tools are functions of it, and tools read groupId/memberId from it, never from closures.
import { Agent } from "@mastra/core/agent";
import { model } from "@/lib/llm";
import { enabledToolkits, getGroup } from "@/services/groups";
import { listGroupMembers } from "@/services/members";
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
