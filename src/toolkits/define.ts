import type { AnyTool, Toolkit, ToolkitManifest } from "./types";

/** A Toolkit's manifest, with its id kept as a literal type (ToolkitId is the union of them). */
export const defineManifest = <const Id extends string>(m: ToolkitManifest<Id>): ToolkitManifest<Id> => m;

/** The server entry: the manifest plus tools, dashboard sections, hooks and its Bundle / report lines. Keeps each tool's own types. */
export function defineToolkit<Id extends string, T extends Record<string, AnyTool>>(
  manifest: ToolkitManifest<Id>,
  server: Pick<Toolkit<Id>, "onEnable" | "onDisable" | "bundle" | "report"> & { tools: T; dashboard?: Pick<NonNullable<Toolkit["dashboard"]>, "home" | "homeOrder" | "settings" | "mood"> },
): Omit<Toolkit<Id>, "tools"> & { tools: T } {
  return { ...manifest, ...server, dashboard: { ...manifest.dashboard, ...server.dashboard } };
}
