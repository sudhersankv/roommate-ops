"use client"

import { useTransition } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { toast } from "@/components/ui/toast"
import { groupAction, type GroupAction } from "./actions"

type Row = {
  id: string
  name: string
  channel: string | null
  chatTitle: string | null
  members: number
  pending: number
  createdAt: string
  lastActivityAt: string | null
  runsToday: number
  pausedAt: string | null
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })

export function GroupList({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <Empty className="rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyTitle>No groups yet</EmptyTitle>
          <EmptyDescription>When someone adds Roomie to a group chat, the group shows up here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((r) => (
        <GroupItem key={r.id} row={r} />
      ))}
    </ul>
  )
}

function GroupItem({ row }: { row: Row }) {
  const [pending, start] = useTransition()
  const run = (action: GroupAction) =>
    start(async () => {
      if (action === "leave" && !window.confirm(`Roomie leaves "${row.name}" and the group is paused. Leave?`)) return
      const res = await groupAction(row.id, action)
      if (!res.ok) toast.add({ title: "That didn't work", description: res.error, type: "error" })
    })
  return (
    <li className="flex flex-col gap-3 rounded-3xl bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="type-heading m-0 truncate">{row.name}</p>
          <p className="type-caption m-0 truncate text-muted-foreground">
            {row.channel ?? "no chat"}
            {row.chatTitle && row.chatTitle !== row.name ? `, "${row.chatTitle}"` : ""} · <code>{row.id}</code>
          </p>
        </div>
        <Badge variant={row.pausedAt ? "destructive" : "secondary"}>{row.pausedAt ? "Paused" : "Live"}</Badge>
      </div>
      <p className="type-body m-0">
        {row.members} members{row.pending ? `, ${row.pending} pending` : ""} · {row.runsToday} runs today · last message {row.lastActivityAt ? when(row.lastActivityAt) : "never"}
      </p>
      <p className="type-caption m-0 text-muted-foreground">
        Added {when(row.createdAt)}
        {row.pausedAt ? ` · paused ${when(row.pausedAt)}` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {row.pausedAt ? (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("resume")}>
            Resume
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={pending} onClick={() => run("pause")}>
            Pause
          </Button>
        )}
        <Button size="sm" variant="destructive" disabled={pending || !row.channel} onClick={() => run("leave")}>
          Leave chat
        </Button>
      </div>
    </li>
  )
}
