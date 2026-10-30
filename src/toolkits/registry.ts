// The Toolkits' server entries (tools, dashboard sections, hooks). The agent's tools for a request are core + the
// Group's enabled Toolkits, narrowed to the one the Gate picked (ADR 0005). Server-only: client code reads
// manifests.ts (or views built from it), never this file.
import type { GateToolkit } from "@/mastra/context";
import { isNotAllowed } from "@/services/authz";
import { core } from "./core/server";
import { splitting } from "./splitting/server";
import { groceries } from "./groceries/server";
import { chores } from "./chores/server";
import { upkeep } from "./upkeep/server";
import { TOOLKIT_IDS, type ToolkitId } from "./manifests";
import { checkAdminAsk, CONFIRM_TTL_MS } from "./admin-ask";
import type { AdminAsk, AnyTool, Toolkit } from "./types";

export { core };

/** One entry per id in manifests.ts; a missing or extra one is a type error. */
const BY_ID = { splitting, groceries, chores, upkeep } satisfies Record<ToolkitId, Toolkit>;

export const TOOLKITS: readonly Toolkit<ToolkitId>[] = TOOLKIT_IDS.map((id) => BY_ID[id] as Toolkit<ToolkitId>);
export const ALL_TOOLKIT_IDS: ToolkitId[] = [...TOOLKIT_IDS];

export const toolkitById = (id: string): Toolkit | undefined => (id === "core" ? core : TOOLKITS.find((t) => t.id === id));

const RELAYED = Symbol("relaysNotAllowed");

type ContextReader = { get(key: string): unknown };

/** Roomie asked an Admin to confirm a tool call: "<groupId>:<memberId>:<toolId>" -> until when (ms). */
const confirming = (): Map<string, number> => {
  const g = globalThis as { __roomieAdminConfirms?: Map<string, number> };
  return (g.__roomieAdminConfirms ??= new Map());
};

/**
 * The admin-only gate (audit H6, admin-ask.ts): an Admin's call runs only when their own current message (`latest` in
 * the RequestContext) asks for it; otherwise { refused: "confirm", ask } and Roomie asks. Non-Admins go straight to
 * the service, which refuses them. Without `latest` (Studio, test:tools) there's nothing to check against.
 */
export function adminAskGate(toolId: string, spec: AdminAsk, input: unknown, context: unknown, now = Date.now()): { refused: "confirm"; ask: string; say: string } | null {
  const rc = (context as { requestContext?: ContextReader } | undefined)?.requestContext;
  const latest = rc?.get("latest");
  if (typeof latest !== "string" || rc?.get("role") !== "admin") return null;
  const key = `${rc.get("groupId")}:${rc.get("memberId")}:${toolId}`;
  const pending = confirming();
  const until = pending.get(key);
  const res = checkAdminAsk(spec, input, latest, !!until && until > now);
  if (res.ok) {
    pending.delete(key);
    return null;
  }
  pending.set(key, now + CONFIRM_TTL_MS);
  if (pending.size > 5_000) for (const [k, t] of pending) if (t <= now) pending.delete(k);
  return { refused: "confirm", ask: res.ask, say: "Nothing was changed. Ask exactly this question and do nothing else until they answer." };
}

/**
 * Permission refusals (Pending member, not an Admin, not your Expense) come back as a plain result instead of a tool
 * error, so the model reads the message and relays it ("Hang on, an admin needs to approve you first..."). Admin-only
 * tools (the manifests' adminOnly) also need the Admin's own message to ask for them.
 */
function relayNotAllowed(tool: AnyTool, toolId: string, adminAsk?: AdminAsk): AnyTool {
  const run = tool.execute;
  const marked = tool as AnyTool & { [RELAYED]?: true };
  if (!run || marked[RELAYED]) return tool;
  tool.execute = async (input, context) => {
    if (adminAsk) {
      const refused = adminAskGate(toolId, adminAsk, input, context);
      if (refused) return refused;
    }
    try {
      return await run(input, context);
    } catch (e) {
      if (isNotAllowed(e)) return { notAllowed: true, reason: e.code, message: e.message };
      throw e;
    }
  };
  marked[RELAYED] = true;
  return tool;
}

for (const tk of [core, ...TOOLKITS]) for (const [id, t] of Object.entries(tk.tools)) relayNotAllowed(t, id, tk.adminOnly?.[id]);

/** Tool ids the manifests mark admin-only (tests, docs). */
export const adminOnlyTools = () => [core, ...TOOLKITS].flatMap((tk) => Object.keys(tk.adminOnly ?? {}));

/**
 * Tools for one request. `toolkit` from the Gate narrows to that Toolkit (plus core); unset or "none" gives every
 * enabled Toolkit; "core" gives core only. A disabled Toolkit is never returned.
 */
export function toolsFor(toolkit?: GateToolkit, enabled: readonly ToolkitId[] = ALL_TOOLKIT_IDS): Record<string, AnyTool> {
  const on = TOOLKITS.filter((t) => enabled.includes(t.id));
  const picked = !toolkit || toolkit === "none" ? on : on.filter((t) => t.id === toolkit);
  return Object.assign({}, core.tools, ...picked.map((t) => t.tools));
}

/** Every tool in the registry, keyed by id, with each tool's own types. Used by tests. */
export const allTools = () => ({ ...core.tools, ...BY_ID.splitting.tools, ...BY_ID.groceries.tools, ...BY_ID.chores.tools, ...BY_ID.upkeep.tools });
