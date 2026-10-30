// The Tricks (the user-facing word for Toolkits) as the landing page and /help show them. All the facts come from the
// toolkit manifests and PRESETS; this file only adds what's visual (an accent per Trick).
import { CATALOG, MANIFESTS } from "@/toolkits/manifests"
import { PRESETS } from "@/toolkits/presets"
import type { ToolkitManifest } from "@/toolkits/types"

/** Each Trick's glow on the page, by toolkit id (today's and ADR 0015's). A Trick missing here gets the brand green. */
const ACCENT: Record<string, string> = {
  splitting: "#86efa0",
  money: "#86efa0",
  groceries: "#ffb547",
  chores: "#7cc7ff",
  house: "#7cc7ff",
  upkeep: "#c4a5ff",
  "household-admin": "#fcd34d",
  "lease-inbox": "#fcd34d",
  research: "#5eead4",
  trips: "#ff8a5c",
  pdf: "#f9a8d4",
  stickers: "#ff5fa2",
  outings: "#ff7a9c",
  cooking: "#ff9f43",
  guests: "#7dd3fc",
  "move-out": "#c4a5ff",
}
export const accentOf = (id: string) => ACCENT[id] ?? "#86efa0"

export const builtTricks = (): readonly ToolkitManifest[] => MANIFESTS
export const comingSoonTricks = (): ToolkitManifest[] => CATALOG.filter((m) => m.status === "coming-soon")
export const trickName = (id: string) => CATALOG.find((m) => m.id === id)?.name ?? id

/** Whether roommates start with this Trick (the roommates preset, ADR 0015). */
export const onForRoommates = (id: string): boolean => (PRESETS.roommates as readonly string[]).includes(id)

/** What to say to teach it: "roomie, learn trips". */
export const teachLine = (m: Pick<ToolkitManifest, "name">) => `roomie, learn ${m.name.toLowerCase()}`
