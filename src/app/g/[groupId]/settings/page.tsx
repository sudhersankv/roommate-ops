import type { Metadata } from "next"

import { PersonalitySection } from "@/components/app/personality-section"
import { zonesByRegion } from "@/lib/time"
import { currentMember } from "@/lib/session"
import { scheduleView, splitwiseView } from "../_components/data"
import { SettingsScreen } from "../_components/screens/settings"

export const metadata: Metadata = { title: "Settings" }

type Props = { params: Promise<{ groupId: string }>; searchParams: Promise<{ splitwise?: string }> }

// Admins get every setting; everyone else only Appearance. The server actions check the role again.
export default async function SettingsPage({ params, searchParams }: Props) {
  const [{ groupId }, { splitwise }] = await Promise.all([params, searchParams])
  const s = await currentMember(groupId)
  const admin = s.member.role === "admin" && s.member.status === "active"
  const [sw, schedule] = await Promise.all([admin ? splitwiseView(s) : null, scheduleView(s)])
  return <SettingsScreen splitwise={sw} notice={splitwise ?? null} zones={admin ? zonesByRegion() : []} schedule={schedule} personality={<PersonalitySection groupId={groupId} />} />
}
