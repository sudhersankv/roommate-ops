"use client"

import { useOptimistic, useTransition } from "react"

import { Badge } from "@/components/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { BETA_STATUSES, type BetaStatus } from "@/db/enums"
import { changeBetaStatus } from "./actions"

type Row = {
  id: string
  createdAt: string
  name: string
  email: string
  groupSize: string
  purpose: string
  phone: string | null
  notes: string | null
  status: BetaStatus
}

const LABEL: Record<BetaStatus, string> = { new: "New", contacted: "Contacted", onboarded: "Onboarded", declined: "Declined" }

export function BetaList({ rows }: { rows: Row[] }) {
  if (rows.length === 0) {
    return (
      <Empty className="rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyTitle>No requests yet</EmptyTitle>
          <EmptyDescription>When someone fills in the WhatsApp beta form on the landing page, it shows up here and you get a DM from Roomie on Telegram.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {rows.map((r) => (
        <Request key={r.id} row={r} />
      ))}
    </ul>
  )
}

function Request({ row }: { row: Row }) {
  const [status, setStatus] = useOptimistic(row.status)
  const [, start] = useTransition()
  const when = new Date(row.createdAt)
  return (
    <li className="flex flex-col gap-3 rounded-3xl bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="type-heading m-0 truncate">{row.name}</p>
          <a href={`mailto:${row.email}`} className="type-body truncate text-muted-foreground underline-offset-4 hover:underline">
            {row.email}
          </a>
        </div>
        <Badge variant={status === "new" ? "owed" : "secondary"}>{LABEL[status]}</Badge>
      </div>
      <p className="type-body m-0">
        {row.purpose}, {row.groupSize} people
        {row.phone ? (
          <>
            , WhatsApp{" "}
            <a href={`https://wa.me/${row.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener noreferrer" className="underline decoration-primary decoration-2 underline-offset-4">
              {row.phone}
            </a>
          </>
        ) : null}
      </p>
      {row.notes && <p className="type-body m-0 whitespace-pre-wrap text-muted-foreground">{row.notes}</p>}
      <p className="type-caption m-0 text-muted-foreground">
        <time dateTime={row.createdAt}>{when.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time>
      </p>
      <ToggleGroup
        variant="segmented"
        spacing={1}
        value={[status]}
        aria-label={`Status of ${row.name}'s request`}
        className="w-full overflow-x-auto"
        onValueChange={(v) => {
          const next = v[0] as BetaStatus | undefined
          if (!next || next === status) return
          start(async () => {
            setStatus(next)
            const res = await changeBetaStatus(row.id, next)
            if (!res.ok) toast.add({ title: "Couldn't change the status", description: res.error, type: "error" })
          })
        }}
      >
        {BETA_STATUSES.map((s) => (
          <ToggleGroupItem key={s} value={s} className="flex-1">
            {LABEL[s]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </li>
  )
}
