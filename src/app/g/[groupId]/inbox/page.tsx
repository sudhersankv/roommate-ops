import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { inboxView } from "../_components/data"
import { InboxScreen } from "../_components/screens/inbox"

export const metadata: Metadata = { title: "Inbox" }

// Lease Inbox owns this page (its manifest's `pages`): while it's off the layout shows the off state.
// ?thread=<id> is the open thread (full screen on a phone, beside the list on a wide screen).
export default async function InboxPage({ params, searchParams }: { params: Promise<{ groupId: string }>; searchParams: Promise<{ thread?: string | string[] }> }) {
  const [{ groupId }, { thread }] = await Promise.all([params, searchParams])
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  return <InboxScreen view={await inboxView(s)} openThread={typeof thread === "string" ? thread : null} />
}
