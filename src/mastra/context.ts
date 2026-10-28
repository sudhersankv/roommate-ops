// The RequestContext contract for the roomie agent. The pipeline (and Studio presets) fill it; tools and the
// dynamic instructions/tools read it. `householdId`/`actorId` become groupId/memberId in step 4.
import { z } from "zod";
import type { Ctx } from "@/services/types";

/** What the Gate can pick. "reminders" lives in core, so it narrows to core tools only; "none" means no narrowing. */
export const GATE_TOOLKITS = ["splitting", "groceries", "chores", "upkeep", "reminders", "none"] as const;
export type GateToolkit = (typeof GATE_TOOLKITS)[number];

export const roomieContextSchema = z.object({
  householdId: z.string().min(1),
  actorId: z.string().min(1),
  actorName: z.string().min(1),
  source: z.enum(["chat", "ui"]),
  toolkit: z.enum(GATE_TOOLKITS).optional(),
  gate: z
    .object({
      decision: z.enum(["act", "clarify", "maybe"]),
      /** Nobody named Roomie or replied to it: ask before logging anything (ADR 0002). */
      unprompted: z.boolean(),
    })
    .optional(),
  /** Follow-up window grey zone: the agent may answer exactly [silent]. */
  mayStaySilent: z.boolean().optional(),
});

export type RoomieContext = z.infer<typeof roomieContextSchema>;

type ContextReader = { get(key: string): unknown };

/** The service Ctx for a tool call, from the run's requestContext. Throws if the pipeline didn't set it. */
export function ctxOf(context: { requestContext?: unknown } | undefined): Ctx {
  const rc = context?.requestContext as ContextReader | undefined;
  const householdId = rc?.get("householdId");
  const actorId = rc?.get("actorId");
  if (typeof householdId !== "string" || !householdId || typeof actorId !== "string" || !actorId) {
    throw new Error("Roomie tools need householdId and actorId in the requestContext.");
  }
  return { householdId, actorId, source: rc?.get("source") === "ui" ? "ui" : "chat" };
}
