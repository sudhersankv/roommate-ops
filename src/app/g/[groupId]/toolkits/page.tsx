import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { tricksView } from "../_components/data"
import { TricksScreen } from "../_components/screens/toolkits"

export const metadata: Metadata = { title: "Tricks" }

type Props = { params: Promise<{ groupId: string }>; searchParams: Promise<{ open?: string }> }

// The Tricks page (also at /tricks): every Toolkit from the manifests as a plain list, Learned / Not yet / Soon.
// Everyone reads; Admins teach and make Roomie forget.
export default async function ToolkitsPage({ params, searchParams }: Props) {
  const [{ groupId }, { open }] = await Promise.all([params, searchParams])
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  return <TricksScreen tricks={await tricksView(s)} openId={open ?? null} />
}
