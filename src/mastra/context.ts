// The RequestContext contract for the roomie agent. The pipeline (and Studio presets) fill it; tools and the
// dynamic instructions/tools read it.
import { z } from "zod";
import type { Ctx } from "@/services/types";
import { TOOLKIT_IDS, type ToolkitId } from "@/toolkits/manifests";

/**
 * What the Gate can pick: a Toolkit, "core" (reminders, members, settings, what Roomie can do: core tools only) or
 * "none" (no narrowing). Per request, Jev only sees the Group's enabled Toolkits (gate/jev.ts).
 */
export type GateToolkit = ToolkitId | "core" | "none";
export const GATE_TOOLKITS = [...TOOLKIT_IDS, "core", "none"] as unknown as readonly [GateToolkit, ...GateToolkit[]];

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
  /** The sender's own words in this message (no "[Name]" prefix). Admin-only tools check it (toolkits/admin-ask.ts). */
  latest: z.string().optional(),
  /** A 1:1 message with Roomie (a Member's DM): what's for the whole group has to be posted there separately. */
  isPrivate: z.boolean().optional(),
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
  return { groupId, memberId, source: rc?.get("source") === "ui" ? "ui" : rc?.get("isPrivate") === true ? "dm" : "chat" };
}
