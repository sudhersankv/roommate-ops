import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { choresView } from "../_components/data"
import { HouseScreen, type HouseTab } from "../_components/screens/house"

export const metadata: Metadata = { title: "House" }

const tabs: HouseTab[] = ["chores", "upkeep"]

export default async function HousePage({ params, searchParams }: { params: Promise<{ groupId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ groupId }, { tab }] = await Promise.all([params, searchParams])
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const initialTab = tabs.find((t) => t === tab) ?? "chores"
  const { chores, upkeep } = await choresView(s)
  return <HouseScreen key={initialTab} initialTab={initialTab} chores={chores} upkeep={upkeep} />
}
