// The Tricks (the user-facing word for Toolkits) and group presets as the landing page and /help show them. All the
// facts come from the toolkit manifests and PRESETS; this file only adds what's visual (an accent per Trick) and the
// words for each kind of group.
import type { GroupPurpose } from "@/db/enums"
import { CATALOG, MANIFESTS, type ToolkitId } from "@/toolkits/manifests"
import { PRESETS } from "@/toolkits/presets"
import type { ToolkitManifest } from "@/toolkits/types"

/** Each Trick's glow on the page. A Trick missing here gets the brand green. */
const ACCENT: Record<string, string> = {
  splitting: "#86efa0",
  groceries: "#ffb547",
  chores: "#7cc7ff",
  upkeep: "#c4a5ff",
  research: "#5eead4",
  trips: "#ff8a5c",
  pdf: "#f9a8d4",
  stickers: "#ff5fa2",
  "household-admin": "#bef264",
}
export const accentOf = (id: string) => ACCENT[id] ?? "#86efa0"

export type GroupKind = { id: string; label: string; plural: string; icon: "House" | "Plane" | "Pizza" | "HeartHandshake" | "Briefcase" | "Trophy"; scenario: string; tricks: ToolkitId[] }

// "Club" isn't a purpose of its own (yet): it starts like "other". A `club` preset, if one is added, wins.
const presetOf = (p: GroupPurpose | "club"): ToolkitId[] => (PRESETS as Partial<Record<string, ToolkitId[]>>)[p] ?? PRESETS.other

/** The groups on the landing page's "What's your group?" cards, with the Tricks each starts with. */
export const GROUP_KINDS: GroupKind[] = [
  { id: "roommates", label: "Roommates", plural: "roommates", icon: "House", scenario: "Rent, the Cart, and whose turn the trash is.", tricks: presetOf("roommates") },
  { id: "trip", label: "Trip", plural: "trips", icon: "Plane", scenario: "The Airbnb, the boat, the 2 a.m. tacos. Split as you go.", tricks: presetOf("trip") },
  { id: "friends", label: "Friends", plural: "friends", icon: "Pizza", scenario: "Dinner, tickets, the Uber home. No more “I'll pay you back”.", tricks: presetOf("friends") },
  { id: "family", label: "Family", plural: "families", icon: "HeartHandshake", scenario: "Groceries, kids' chores, the filter nobody remembers.", tricks: presetOf("family") },
  { id: "work", label: "Work", plural: "teams", icon: "Briefcase", scenario: "Team lunch, the gift fund, who still owes for pizza Friday.", tricks: presetOf("work") },
  { id: "club", label: "Club", plural: "clubs", icon: "Trophy", scenario: "Dues, kit and the end-of-season party.", tricks: presetOf("club") },
]

/** "Taught by" on a Trick card: the kinds of group that start with it. */
export const taughtBy = (id: string): string[] => GROUP_KINDS.filter((g) => (g.tricks as string[]).includes(id)).map((g) => g.plural)

export const builtTricks = (): readonly ToolkitManifest[] => MANIFESTS
export const comingSoonTricks = (): ToolkitManifest[] => CATALOG.filter((m) => m.status === "coming-soon")
export const trickName = (id: string) => CATALOG.find((m) => m.id === id)?.name ?? id

/** What to say to teach it: "roomie, learn trips". */
export const teachLine = (m: Pick<ToolkitManifest, "name">) => `roomie, learn ${m.name.toLowerCase()}`
