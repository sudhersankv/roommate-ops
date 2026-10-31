import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { inboxView } from "../_components/data"
import { InboxScreen } from "../_components/screens/inbox"

export const metadata: Metadata = { title: "Inbox" }

// Lease Inbox owns this page (its manifest's `pages`): while it's off the layout shows the off state.
export default async function InboxPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  return <InboxScreen view={await inboxView(s)} />
}
