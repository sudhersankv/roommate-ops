// The dashboard dock's rules, pure (no DB import, so the shell and its tests use them as they are): which learned
// Tricks have a page, and which two of them sit in a Member's dock.
import type { ToolkitManifest } from "@/toolkits/types";

/** Home · 2 Tricks · Ask Roomie · More: two a side, so Ask stays centred. */
export const DOCK_SLOTS = 2;

/**
 * The learned Tricks with a page, by nav order, one per page (the first owner wins). These are the More drawer's
 * blocks and the only Tricks a dock may hold.
 */
export function tricksWithPages<M extends Pick<ToolkitManifest, "id" | "dashboard">>(manifests: readonly M[], on: Readonly<Record<string, boolean>>): M[] {
  const seen = new Set<string>();
  return manifests
    .filter((m) => on[m.id] && m.dashboard?.nav)
    .sort((a, b) => a.dashboard!.nav!.order - b.dashboard!.nav!.order)
    .filter((m) => {
      const path = m.dashboard!.nav!.href("g").split("?")[0];
      if (seen.has(path)) return false;
      seen.add(path);
      return true;
    });
}

/** A saved choice cleaned against what's there now: known ids only, no repeats, at most DOCK_SLOTS, in the order given. */
export function cleanDock(available: readonly string[], saved: readonly string[] | null | undefined): string[] {
  return [...new Set(saved ?? [])].filter((id) => available.includes(id)).slice(0, DOCK_SLOTS);
}

/**
 * The dock's Tricks, left to right: each side keeps what the Member chose while it's still learned (a repeat or an
 * unknown id counts as no choice), and an empty side takes the next learned Trick by nav order. So a forgotten Trick
 * leaves its side to the next one and the other side stays put; no choice at all is the first two by nav order.
 */
export function pickDock(available: readonly string[], saved: readonly string[] | null | undefined): string[] {
  const used = new Set<string>();
  const sides = Array.from({ length: DOCK_SLOTS }, (_, i) => {
    const id = saved?.[i];
    if (!id || !available.includes(id) || used.has(id)) return null;
    used.add(id);
    return id;
  });
  const rest = available.filter((id) => !used.has(id));
  return sides.map((id) => id ?? rest.shift() ?? null).filter((id): id is string => !!id);
}
