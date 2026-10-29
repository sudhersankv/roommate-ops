import type { Metadata } from "next"
import type { ReactNode } from "react"

import { currentMember } from "@/lib/session"
import { groupView } from "./_components/data"
import { GroupProvider } from "./_components/group-context"
import { PendingScreen } from "./_components/screens/pending"
import { AppShell } from "./_components/shell"

export const dynamic = "force-dynamic"

type Props = { children: ReactNode; params: Promise<{ groupId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { groupId } = await params
  const { group } = await currentMember(groupId)
  return { title: { default: group.name, template: `%s | ${group.name}` }, robots: { index: false, follow: false } }
}

export default async function GroupLayout({ children, params }: Props) {
  const { groupId } = await params
  const session = await currentMember(groupId)
  const view = await groupView(session)
  return (
    <GroupProvider view={view}>
      {/* A Pending member sees who can let them in, not the Group's money (ADR 0003). */}
      <AppShell>{session.member.status === "active" ? children : <PendingScreen />}</AppShell>
    </GroupProvider>
  )
}
