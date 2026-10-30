import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { RoomieAvatar } from "@/components/app/roomie-avatar"
import { CAPS } from "@/lib/caps"
import { roomiePaused } from "@/lib/kill-switch"
import { currentOperator } from "@/lib/operator"
import { listGroupsForOperator } from "@/services/operator-groups"
import { GroupList } from "./list"

export const metadata: Metadata = { title: "Groups", robots: { index: false, follow: false, nocache: true } }
export const dynamic = "force-dynamic"

/** The operator's list of every Group: who's in it, how busy Roomie is there today, and pause / resume / leave. */
export default async function GroupsAdminPage() {
  const op = await currentOperator()
  if (!op) notFound()
  const rows = await listGroupsForOperator(op)
  const paused = roomiePaused()
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center gap-3">
        <RoomieAvatar size={40} />
        <div>
          <h1 className="type-title m-0">Groups</h1>
          <p className="type-caption text-muted-foreground">
            {rows.length === 0 ? "None yet." : `${rows.length} groups, ${rows.filter((r) => r.pausedAt).length} paused.`} Runs today count against {CAPS.groupDay.max} a day per group. Only operators see this page.
          </p>
        </div>
      </header>
      {paused && (
        <p role="status" className="type-body m-0 rounded-3xl bg-destructive/10 p-4 text-destructive">
          ROOMIE_PAUSED=1 is set on this server: Roomie answers nothing, posts nothing and joins nothing anywhere. Unset it (fly secrets unset ROOMIE_PAUSED) to resume.
        </p>
      )}
      <GroupList
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          channel: r.channel,
          chatTitle: r.chatTitle,
          members: r.members,
          pending: r.pending,
          createdAt: r.createdAt.toISOString(),
          lastActivityAt: r.lastActivityAt?.toISOString() ?? null,
          runsToday: r.runsToday,
          pausedAt: r.pausedAt?.toISOString() ?? null,
        }))}
      />
    </main>
  )
}
