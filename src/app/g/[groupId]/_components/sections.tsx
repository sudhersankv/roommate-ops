// The Toolkits' dashboard contributions (manifest `dashboard.home` / `settings` / `mood`), resolved for one
// request: only enabled Toolkits, in nav order. Pages render these; they never name a Toolkit themselves.
import type { ReactNode } from "react"

import type { RoomieMood } from "@/components/roomie/mascot"
import type { GroupSession } from "@/lib/session"
import { byHomeOrder, byOrder, enabledFor } from "@/toolkits/catalog"
import type { ToolkitSectionCtx } from "@/toolkits/types"

export const sectionCtx = (s: GroupSession): ToolkitSectionCtx => ({
  session: s,
  isAdmin: s.member.role === "admin" && s.member.status === "active",
  base: `/g/${s.group.id}`,
})

async function render(s: GroupSession, slot: "home" | "settings"): Promise<ReactNode[]> {
  const ctx = sectionCtx(s)
  const on = (slot === "home" ? byHomeOrder : byOrder)(await enabledFor(s.group.id)).filter((t) => t.dashboard?.[slot])
  const sections = await Promise.all(on.map(async (t) => ({ id: t.id, Section: await t.dashboard![slot]!() })))
  return sections.map(({ id, Section }) => <Section key={id} ctx={ctx} />)
}

export const homeSections = (s: GroupSession) => render(s, "home")
export const settingsSections = (s: GroupSession) => render(s, "settings")

/** Roomie's mood in the Home doorway when the Group's mood can't be read: the first enabled Toolkit with an opinion, else calm. */
export async function homeMood(s: GroupSession): Promise<RoomieMood> {
  const ctx = sectionCtx(s)
  for (const t of byOrder(await enabledFor(s.group.id))) {
    if (!t.dashboard?.mood) continue
    const mood = await (await t.dashboard.mood())(ctx)
    if (mood) return mood
  }
  return "calm"
}
