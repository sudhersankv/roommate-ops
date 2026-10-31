import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { remindersView } from "../_components/data"
import { RemindersScreen } from "../_components/screens/reminders"

export const metadata: Metadata = { title: "Reminders" }

// Reminders are core (no Trick owns them): the page is there whatever Roomie has learned.
export default async function RemindersPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  return <RemindersScreen reminders={await remindersView(s)} />
}
