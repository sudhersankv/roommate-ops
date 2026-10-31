// The Toolkits' server entries (tools, dashboard sections, hooks). The agent's tools for a request are core + the
// Group's enabled Toolkits, narrowed to the one the Gate picked (ADR 0005). Server-only: client code reads
// manifests.ts (or views built from it), never this file.
import type { GateToolkit } from "@/mastra/context";
import { isNotAllowed } from "@/services/authz";
import { core } from "./core/server";
import { splitting } from "./splitting/server";
import { groceries } from "./groceries/server";
import { house } from "./house/server";
import { leaseInbox } from "./lease-inbox/server";
import { TOOLKIT_IDS, type ToolkitId } from "./manifests";
import { checkAdminAsk, CONFIRM_TTL_MS } from "./admin-ask";
import type { AdminAsk, AnyTool, Toolkit } from "./types";

export { core };

/** One entry per id in manifests.ts; a missing or extra one is a type error. */
const BY_ID = { splitting, groceries, house, "lease-inbox": leaseInbox } satisfies Record<ToolkitId, Toolkit>;

export const TOOLKITS: readonly Toolkit<ToolkitId>[] = TOOLKIT_IDS.map((id) => BY_ID[id] as Toolkit<ToolkitId>);
export const ALL_TOOLKIT_IDS: ToolkitId[] = [...TOOLKIT_IDS];

export const toolkitById = (id: string): Toolkit | undefined => (id === "core" ? core : TOOLKITS.find((t) => t.id === id));

const RELAYED = Symbol("relaysNotAllowed");

type ContextReader = { get(key: string): unknown };

/** Roomie asked an Admin to confirm a tool call: "<groupId>:<memberId>:<toolId>" -> the call it asked about, until when. */
type Pending = { call: string; until: number };
const confirming = (): Map<string, Pending> => {
  const g = globalThis as { __roomieAdminConfirms?: Map<string, Pending> };
  return (g.__roomieAdminConfirms ??= new Map());
};

/** The call, the same however the model spells or orders it ("Eve" / "eve"), so "yes" confirms only that call. */
export function callKey(input: unknown): string {
  const norm = (v: unknown): unknown =>
    typeof v === "string"
      ? v.trim().toLowerCase()
      : Array.isArray(v)
        ? v.map(norm)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, norm(x)]))
          : v;
  return JSON.stringify(norm(input) ?? null);
}

/** Dev only (test:tools, Studio): ROOMIE_ADMIN_ASK_OFF=1 lets admin-only tools run without a message to check. Never in production. */
const askCheckOff = () => process.env.ROOMIE_ADMIN_ASK_OFF === "1" && process.env.NODE_ENV !== "production";

const NO_MESSAGE = "Admin-only changes need the admin's own message in the chat or on the dashboard's Ask Roomie.";

/**
 * The admin-only gate (audit H6, admin-ask.ts): an Admin's call runs only when their own current message (`latest` in
 * the RequestContext) asks for it; otherwise { refused: "confirm", ask } and Roomie asks. A confirmation counts only for
 * the same call (tool and input). No `latest` (Studio, a script) is refused, unless ROOMIE_ADMIN_ASK_OFF=1 outside
 * production. Non-Admins go straight to the service, which refuses them.
 */
export function adminAskGate(toolId: string, spec: AdminAsk, input: unknown, context: unknown, now = Date.now()): { refused: "confirm"; ask: string; say: string } | null {
  const rc = (context as { requestContext?: ContextReader } | undefined)?.requestContext;
  if (rc?.get("role") !== "admin") return null;
  const latest = rc.get("latest");
  if (typeof latest !== "string") return askCheckOff() ? null : { refused: "confirm", ask: NO_MESSAGE, say: "Nothing was changed. Say this as it is." };
  const key = `${rc.get("groupId")}:${rc.get("memberId")}:${toolId}`;
  const call = callKey(input);
  const pending = confirming();
  const asked = pending.get(key);
  const res = checkAdminAsk(spec, input, latest, !!asked && asked.until > now && asked.call === call);
  if (res.ok) {
    pending.delete(key);
    return null;
  }
  pending.set(key, { call, until: now + CONFIRM_TTL_MS });
  if (pending.size > 5_000) for (const [k, p] of pending) if (p.until <= now) pending.delete(k);
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
export const allTools = () => ({ ...core.tools, ...BY_ID.splitting.tools, ...BY_ID.groceries.tools, ...BY_ID.house.tools, ...BY_ID["lease-inbox"].tools });
