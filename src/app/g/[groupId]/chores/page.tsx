import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { choresView, remindersView } from "../_components/data"
import { ChoresScreen, type ChoresTab } from "../_components/screens/chores"

export const metadata: Metadata = { title: "Chores" }

const tabs: ChoresTab[] = ["chores", "upkeep", "reminders"]

export default async function ChoresPage({ params, searchParams }: { params: Promise<{ groupId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ groupId }, { tab }] = await Promise.all([params, searchParams])
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const initialTab = tabs.find((t) => t === tab) ?? "chores"
  const [{ chores, upkeep }, reminders] = await Promise.all([choresView(s), remindersView(s)])
  return <ChoresScreen key={initialTab} initialTab={initialTab} chores={chores} upkeep={upkeep} reminders={reminders} />
}
