import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { marketplaceView } from "../_components/data"
import { ToolkitsScreen } from "../_components/screens/toolkits"

export const metadata: Metadata = { title: "Toolkits" }

type Props = { params: Promise<{ groupId: string }>; searchParams: Promise<{ open?: string }> }

// The marketplace: every Toolkit from the manifests, with this Group's on/off. Everyone browses; Admins switch.
export default async function ToolkitsPage({ params, searchParams }: Props) {
  const [{ groupId }, { open }] = await Promise.all([params, searchParams])
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  return <ToolkitsScreen cards={await marketplaceView(s)} openId={open ?? null} />
}
