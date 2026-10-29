// The RequestContext contract for the roomie agent. The pipeline (and Studio presets) fill it; tools and the
// dynamic instructions/tools read it.
import { z } from "zod";
import type { Ctx } from "@/services/types";
import { TOOLKIT_IDS } from "@/toolkits/types";

/** What the Gate can pick. "reminders" lives in core, so it narrows to core tools only; "none" means no narrowing. */
export const GATE_TOOLKITS = ["splitting", "groceries", "chores", "upkeep", "reminders", "none"] as const;
export type GateToolkit = (typeof GATE_TOOLKITS)[number];

export const roomieContextSchema = z.object({
  groupId: z.string().min(1),
  memberId: z.string().min(1),
  memberName: z.string().min(1),
  role: z.enum(["admin", "member"]),
  status: z.enum(["pending", "active", "removed"]),
  source: z.enum(["chat", "ui"]),
  /** The Group's enabled Toolkits. The agent loads them from the DB when this is missing (Studio). */
  toolkits: z.array(z.enum(TOOLKIT_IDS)).optional(),
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
  /** A pet behaviour for this reply (services/pet.ts): "/pet", or the day's first message (open with a hello). */
  pet: z.enum(["petted", "greet"]).optional(),
});

export type RoomieContext = z.infer<typeof roomieContextSchema>;

type ContextReader = { get(key: string): unknown };

/** The service Ctx for a tool call, from the run's requestContext. Throws if the pipeline didn't set it. */
export function ctxOf(context: { requestContext?: unknown } | undefined): Ctx {
  const rc = context?.requestContext as ContextReader | undefined;
  const groupId = rc?.get("groupId");
  const memberId = rc?.get("memberId");
  if (typeof groupId !== "string" || !groupId || typeof memberId !== "string" || !memberId) {
    throw new Error("Roomie tools need groupId and memberId in the requestContext.");
  }
  return { groupId, memberId, source: rc?.get("source") === "ui" ? "ui" : "chat" };
}
