import type { ToolAction } from "@mastra/core/tools";

/** Switchable Toolkits; core is always on and is not in this list. */
export const TOOLKIT_IDS = ["splitting", "groceries", "chores", "upkeep"] as const;
export type ToolkitId = (typeof TOOLKIT_IDS)[number];
export const isToolkitId = (s: string): s is ToolkitId => (TOOLKIT_IDS as readonly string[]).includes(s);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTool = ToolAction<any, any, any, any, any, any>;

export type ToolkitManifest<Id extends string = ToolkitId> = {
  id: Id;
  name: string;
  /** One line, shown to the Gate and in settings. */
  description: string;
  /** Keyed by tool id. */
  tools: Record<string, AnyTool>;
};
