// Every Toolkit's manifest (plain data, no tools): safe for services, client code and tests. Adding a Toolkit:
// its folder's manifest.ts goes in MANIFESTS here and its server.ts in registry.ts (docs/toolkits.md).
import { chores } from "./chores/manifest";
import { COMING_SOON } from "./coming-soon";
import { core } from "./core/manifest";
import { groceries } from "./groceries/manifest";
import { splitting } from "./splitting/manifest";
import { upkeep } from "./upkeep/manifest";
import type { ToolkitManifest } from "./types";

export { core as CORE_MANIFEST, COMING_SOON };

/** The switchable Toolkits that exist, in marketplace order. Core is always on and isn't listed. */
export const MANIFESTS = [splitting, groceries, chores, upkeep] as const;

export type ToolkitId = (typeof MANIFESTS)[number]["id"];
export const TOOLKIT_IDS = MANIFESTS.map((m) => m.id) as unknown as readonly [ToolkitId, ...ToolkitId[]];
export const isToolkitId = (s: string): s is ToolkitId => (TOOLKIT_IDS as readonly string[]).includes(s);

/** Everything in the marketplace: the real Toolkits, then the coming-soon stubs. */
export const CATALOG: readonly ToolkitManifest[] = [...MANIFESTS, ...COMING_SOON];

export function manifestOf(id: string): ToolkitManifest | undefined {
  return id === "core" ? core : CATALOG.find((m) => m.id === id);
}

/** "groceries", "Groceries", "the grocery toolkit", "pdfs" -> the manifest. */
export function findManifest(name: string): ToolkitManifest | undefined {
  const q = name.trim().toLowerCase().replace(/^the\s+/, "").replace(/\s+toolkit$/, "").replace(/[\s_]+/g, "-");
  const plain = (s: string) => s.toLowerCase().replace(/[\s_]+/g, "-");
  const stem = (s: string) => plain(s).replace(/ies$/, "y").replace(/s$/, "");
  return (
    CATALOG.find((m) => m.id === q || plain(m.name) === q || (m.dashboard?.nav && plain(m.dashboard.nav.label) === q)) ??
    CATALOG.find((m) => q.length >= 3 && (stem(m.id) === stem(q) || stem(m.name) === stem(q) || m.id.startsWith(q) || plain(m.name).startsWith(q)))
  );
}
