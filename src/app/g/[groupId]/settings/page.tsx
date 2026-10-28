import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { splitwiseView } from "../_components/data"
import { SettingsScreen } from "../_components/screens/settings"

export const metadata: Metadata = { title: "Settings" }

type Props = { params: Promise<{ groupId: string }>; searchParams: Promise<{ splitwise?: string }> }

// Admins get every setting; everyone else only Appearance. The server actions check the role again.
export default async function SettingsPage({ params, searchParams }: Props) {
  const [{ groupId }, { splitwise }] = await Promise.all([params, searchParams])
  const s = await currentMember(groupId)
  const admin = s.member.role === "admin" && s.member.status === "active"
  return <SettingsScreen splitwise={admin ? await splitwiseView(s) : null} notice={splitwise ?? null} />
}
