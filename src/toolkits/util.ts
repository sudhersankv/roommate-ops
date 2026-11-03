import { listGroupMembers, listMembers } from "@/services/members";
import { loggedTogether, type CombinedShares } from "@/services/money";
import type { Ctx } from "@/services/types";
import type { Button } from "@/channels/types";
import { dashboardUrl } from "@/lib/urls";

export { ctxOf } from "@/mastra/context";
export { appUrl, dashboardUrl, isAbsoluteUrl } from "@/lib/urls";

export const toCents = (dollars: number) => Math.round(dollars * 100);

/** Expenses each agent run logged, by the run's id (RequestContext `runId`, set by the pipeline per message). */
const RUN_EXPENSES = new Map<string, { at: number; ids: string[] }>();
const RUN_TTL_MS = 10 * 60_000;

/**
 * Notes that this run logged Expense `id` and returns every Expense the run has logged so far, in order (#71: a
 * second one in the same run is said as one combined line). Without a runId (Studio, scripts) only `[id]`.
 */
export function loggedThisRun(context: { requestContext?: unknown } | undefined, id: string, now = Date.now()): string[] {
  const runId = (context?.requestContext as { get?: (k: string) => unknown } | undefined)?.get?.("runId");
  if (typeof runId !== "string" || !runId) return [id];
  for (const [k, v] of RUN_EXPENSES) if (now - v.at > RUN_TTL_MS) RUN_EXPENSES.delete(k);
  const entry = RUN_EXPENSES.get(runId) ?? { at: now, ids: [] };
  if (!entry.ids.includes(id)) entry.ids.push(id);
  RUN_EXPENSES.set(runId, entry);
  return [...entry.ids];
}

/**
 * What log_expense / expense_from_receipt add to their result when this run already logged another Expense (#71):
 * `together`, the run's Expenses as one ready-to-say line (money.loggedTogether: summed from their Shares, in
 * cents). Empty for the first one.
 */
export async function togetherThisRun(ctx: Ctx, context: { requestContext?: unknown } | undefined, expenseId: string): Promise<{ together?: CombinedShares }> {
  const together = await loggedTogether(ctx, loggedThisRun(context, expenseId));
  return together ? { together } : {};
}

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
