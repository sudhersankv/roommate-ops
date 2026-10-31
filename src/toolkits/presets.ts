// What a Group gets switched on when it tells Roomie what it's for (Onboarding). Pure; core is always on.
import type { GroupPurpose } from "@/db/schema";
import { MANIFESTS, TOOLKIT_IDS, type ToolkitId } from "./manifests";

export const PRESETS: Record<GroupPurpose, ToolkitId[]> = {
  roommates: ["splitting", "groceries", "house"],
  family: ["splitting", "groceries", "house"],
  trip: ["splitting", "groceries"],
  friends: ["splitting"],
  work: ["splitting"],
  other: ["splitting", "groceries"],
};

/** The preset for a purpose. No answer yet: every Toolkit that's on by default. */
export function presetFor(purpose: GroupPurpose | null | undefined): ToolkitId[] {
  if (purpose && PRESETS[purpose]) return [...PRESETS[purpose]];
  return TOOLKIT_IDS.filter((id) => MANIFESTS.find((m) => m.id === id)?.defaultOn);
}

/** "roommates: Money, Groceries, House; trip: Money, Groceries; ..." for Roomie's instructions. */
export function describePresets(): string {
  const name = (id: ToolkitId) => MANIFESTS.find((m) => m.id === id)?.name ?? id;
  return (Object.entries(PRESETS) as [GroupPurpose, ToolkitId[]][]).map(([p, ids]) => `${p}: ${ids.map(name).join(", ")}`).join("; ");
}
