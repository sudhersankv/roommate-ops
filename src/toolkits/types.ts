import type { ToolAction } from "@mastra/core/tools";

/** Switchable Toolkits; core is always on and is not in this list. */
export type ToolkitId = "splitting" | "groceries" | "chores" | "upkeep";

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
