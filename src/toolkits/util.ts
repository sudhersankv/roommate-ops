import { listGroupMembers, listMembers } from "@/services/members";
import type { Ctx } from "@/services/types";
import type { Button } from "@/channels/types";
import { dashboardUrl } from "@/lib/urls";

export { ctxOf } from "@/mastra/context";
export { appUrl, dashboardUrl, isAbsoluteUrl } from "@/lib/urls";

export const toCents = (dollars: number) => Math.round(dollars * 100);

/**
 * Case-insensitive first-name match among active Members (or pending ones too, for approvals). Unknown names throw
 * so the model can ask.
 */
export async function memberIdByName(ctx: Ctx, name: string, opts: { includePending?: boolean; preferPending?: boolean } = {}): Promise<string> {
  const people = opts.includePending || opts.preferPending ? await listGroupMembers(ctx) : await listMembers(ctx);
  const q = name.trim().toLowerCase();
  // Approvals look at Pending people first: a Join link sign-in may share a name with the seat it asked for.
  const pool = opts.preferPending ? [...people.filter((p) => p.status === "pending"), ...people.filter((p) => p.status !== "pending")] : people;
  const hit = pool.find((p) => p.displayName.toLowerCase() === q) ?? pool.find((p) => p.displayName.toLowerCase().startsWith(q));
  if (!hit) throw new Error(`No member named "${name}". Members: ${people.map((p) => p.displayName).join(", ")}`);
  return hit.id;
}

/**
 * Buttons for Roomie's reply. Tools return them as `links` in their result and the pipeline collects every
 * tool result's links (deduped by url) into Outgoing.buttons, so the model never pastes URLs.
 */
export function dashboardLinks(text: string, path: string): { links?: Button[] } {
  const url = dashboardUrl(path);
  return url ? { links: [{ text, url }] } : {};
}
