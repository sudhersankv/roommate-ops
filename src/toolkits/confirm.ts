// A ✅ on Roomie's confirm poll (services/polls.ts, live test #10) runs the one action it pinned: the same tool with
// the same input, as the Member who was asked, with "confirmedCall" in the RequestContext so the admin-ask gate lets
// exactly that call through. The services still check who acts (requireAdmin), from the Member as stored now.
import { RequestContext } from "@mastra/core/request-context";
import { members } from "@/services";
import { registerConfirmRunner, type ConfirmAbout } from "@/services/polls";
import { allTools, callKey } from "./registry";

/** What to say once a confirmed action ran: the tool's own ready-to-post line when it has one. */
export function confirmedLine(result: unknown): string {
  const r = (result ?? {}) as Record<string, unknown>;
  if (r.notAllowed || r.refused) return typeof r.message === "string" ? r.message : "That didn't go through.";
  for (const k of ["say", "learned", "message"]) if (typeof r[k] === "string" && r[k]) return r[k] as string;
  return "Done ✅";
}

export async function runConfirmed(groupId: string, about: ConfirmAbout): Promise<string | null> {
  const tool = (allTools() as Record<string, { execute?: (input: unknown, context: unknown) => Promise<unknown> }>)[about.toolId];
  const member = await members.getMember({ groupId }, about.memberId);
  if (!tool?.execute || !member) return null;
  const requestContext = new RequestContext<unknown>([
    ["groupId", groupId],
    ["memberId", member.id],
    ["memberName", member.displayName],
    ["role", member.role],
    ["status", member.status],
    ["source", "chat"],
    ["confirmedCall", `${about.toolId}:${callKey(about.input)}`],
  ]);
  return confirmedLine(await tool.execute(about.input, { requestContext }));
}

registerConfirmRunner(runConfirmed);
