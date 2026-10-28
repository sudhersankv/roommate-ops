// The list of Toolkits. The agent's tools for a request are core + the Group's enabled Toolkits, narrowed to the one
// the Gate picked (ADR 0005).
import type { GateToolkit } from "@/mastra/context";
import { isNotAllowed } from "@/services/authz";
import { core } from "./core/manifest";
import { splitting } from "./splitting/manifest";
import { groceries } from "./groceries/manifest";
import { chores } from "./chores/manifest";
import { upkeep } from "./upkeep/manifest";
import { TOOLKIT_IDS, type AnyTool, type ToolkitId } from "./types";

export { core };
export const TOOLKITS = [splitting, groceries, chores, upkeep] as const;
export const ALL_TOOLKIT_IDS: ToolkitId[] = [...TOOLKIT_IDS];

const RELAYED = Symbol("relaysNotAllowed");

/**
 * Permission refusals (Pending member, not an Admin, not your Expense) come back as a plain result instead of a tool
 * error, so the model reads the message and relays it ("Hang on, an admin needs to approve you first...").
 */
function relayNotAllowed(tool: AnyTool): AnyTool {
  const run = tool.execute;
  const marked = tool as AnyTool & { [RELAYED]?: true };
  if (!run || marked[RELAYED]) return tool;
  tool.execute = async (input, context) => {
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

for (const tk of [core, ...TOOLKITS]) for (const t of Object.values(tk.tools)) relayNotAllowed(t);

/**
 * Tools for one request. `toolkit` from the Gate narrows to that Toolkit (plus core); unset or "none" gives every
 * enabled Toolkit. "reminders" is core, so it narrows to core only. A disabled Toolkit is never returned.
 */
export function toolsFor(toolkit?: GateToolkit, enabled: readonly ToolkitId[] = ALL_TOOLKIT_IDS): Record<string, AnyTool> {
  const on = TOOLKITS.filter((t) => enabled.includes(t.id));
  const picked = !toolkit || toolkit === "none" ? on : on.filter((t) => t.id === toolkit);
  return Object.assign({}, core.tools, ...picked.map((t) => t.tools));
}

/** Every tool in the registry, keyed by id, with each tool's own types. Used by tests. */
export const allTools = () => ({ ...core.tools, ...splitting.tools, ...groceries.tools, ...chores.tools, ...upkeep.tools });
