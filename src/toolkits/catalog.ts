// Server-side lookups over the registry: every Toolkit in the marketplace, and the ones a Group has on (cached per
// request, so the layout, the page and its sections share one query).
import { cache } from "react";
import { listToolkits } from "@/services/groups";
import { CATALOG } from "./manifests";
import { TOOLKITS } from "./registry";
import type { Toolkit, ToolkitManifest } from "./types";

/** Every Toolkit in the marketplace: the real ones, then the coming-soon stubs (manifest only). */
export function allToolkits(): readonly ToolkitManifest[] {
  return CATALOG;
}

/** Every Toolkit's on/off for a Group, once per request (the layout, the page and its sections share it). */
export const toolkitStates = cache(async (groupId: string) => listToolkits({ groupId }));
const enabledIds = async (groupId: string) => (await toolkitStates(groupId)).filter((t) => t.enabled).map((t) => t.id);

/** The Group's enabled Toolkits (server entries: tools, dashboard sections, hooks), in registry order. */
export async function enabledFor(groupId: string): Promise<Toolkit[]> {
  const on = await enabledIds(groupId);
  return TOOLKITS.filter((t) => on.includes(t.id));
}

export async function isEnabled(groupId: string, id: string): Promise<boolean> {
  return id === "core" || (await enabledIds(groupId)).includes(id as never);
}

/** Order on Home and Settings: the nav order, then registry order. */
export const byOrder = <T extends Pick<Toolkit, "dashboard">>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (a.dashboard?.nav?.order ?? 100) - (b.dashboard?.nav?.order ?? 100));

/** Order on Home: a Toolkit's homeOrder, else its nav order (standing, then today, then the rest). */
export const byHomeOrder = <T extends Pick<Toolkit, "dashboard">>(list: readonly T[]): T[] =>
  [...list].sort((a, b) => (a.dashboard?.homeOrder ?? a.dashboard?.nav?.order ?? 100) - (b.dashboard?.homeOrder ?? b.dashboard?.nav?.order ?? 100));
