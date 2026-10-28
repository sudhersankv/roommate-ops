// The list of Toolkits. The agent's tools for a request are core + the enabled Toolkits, narrowed to the one the
// Gate picked (ADR 0005). Every Group has every Toolkit enabled until group_toolkits exists (step 4).
import type { GateToolkit } from "@/mastra/context";
import { core } from "./core/manifest";
import { splitting } from "./splitting/manifest";
import { groceries } from "./groceries/manifest";
import { chores } from "./chores/manifest";
import { upkeep } from "./upkeep/manifest";
import type { AnyTool, ToolkitId } from "./types";

export { core };
export const TOOLKITS = [splitting, groceries, chores, upkeep] as const;
export const ALL_TOOLKIT_IDS: ToolkitId[] = TOOLKITS.map((t) => t.id);

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
