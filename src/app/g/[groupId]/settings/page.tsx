import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { SettingsScreen } from "../_components/screens/settings"
import { settingsSections } from "../_components/sections"

export const metadata: Metadata = { title: "Settings" }

type Props = { params: Promise<{ groupId: string }> }

// Core settings plus each enabled Toolkit's settings section (from its manifest). Admins get every control; the
// sections and the server actions check the role again.
export default async function SettingsPage({ params }: Props) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  return <SettingsScreen>{s.member.status === "active" ? await settingsSections(s) : null}</SettingsScreen>
}
