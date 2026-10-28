import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { choresView } from "../_components/data"
import { ChoresScreen } from "../_components/screens/chores"

export const metadata: Metadata = { title: "Chores" }

export default async function ChoresPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const { chores, upkeep } = await choresView(s)
  return <ChoresScreen chores={chores} upkeep={upkeep} />
}
