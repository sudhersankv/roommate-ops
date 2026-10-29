import type { Metadata } from "next"

import { zonesByRegion } from "@/lib/time"
import { currentMember } from "@/lib/session"
import { scheduleView } from "../_components/data"
import { SettingsScreen } from "../_components/screens/settings"
import { settingsSections } from "../_components/sections"

export const metadata: Metadata = { title: "Settings" }

type Props = { params: Promise<{ groupId: string }> }

// Core settings plus each enabled Toolkit's settings section (from its manifest). Admins get every control; the
// sections and the server actions check the role again.
export default async function SettingsPage({ params }: Props) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  const admin = s.member.role === "admin" && s.member.status === "active"
  const [schedule, sections] = await Promise.all([scheduleView(s), s.member.status === "active" ? settingsSections(s) : null])
  return (
    <SettingsScreen zones={admin ? zonesByRegion() : []} schedule={schedule}>
      {sections}
    </SettingsScreen>
  )
}
