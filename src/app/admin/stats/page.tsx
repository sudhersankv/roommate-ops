import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { DownloadIcon } from "lucide-react"

import { RoomieAvatar } from "@/components/app/roomie-avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { currentOperator } from "@/lib/operator"
import { loadStats, type Stats } from "@/services/stats"

export const metadata: Metadata = { title: "Numbers", robots: { index: false, follow: false, nocache: true } }
export const dynamic = "force-dynamic"

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", telegram: "Telegram", dev: "Dev chat", "not given": "No chat" }
const fmt = (n: number) => n.toLocaleString("en-US")

/** The operator's numbers (#83): counts only, no people. The sign-ups' details stay on /admin/beta. */
export default async function StatsAdminPage() {
  const op = await currentOperator()
  if (!op) notFound()
  const s = await loadStats(op)
  const thisWeek = s.activity.at(-1)
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-center gap-3">
        <RoomieAvatar size={40} />
        <div className="min-w-0 flex-1">
          <h1 className="type-title m-0">Numbers</h1>
          <p className="type-caption text-muted-foreground">Counts only, weeks are ISO weeks in UTC. Only operators see this page.</p>
        </div>
        <Button variant="outline" nativeButton={false} render={<a href="/admin/stats/csv" download />}>
          <DownloadIcon data-icon="inline-start" />
          CSV
        </Button>
      </header>

      <section aria-label="At a glance" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Waitlist" value={s.waitlist.total} />
        <Tile label="Groups added" value={s.groups.total} />
        <Tile label="Active groups this week" value={thisWeek?.activeGroups ?? 0} />
        <Tile label="Active members this week" value={thisWeek?.activeMembers ?? 0} />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Waitlist sign-ups</CardTitle>
          <CardDescription>The WhatsApp beta form on the landing page.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Table head={["Week", "Sign-ups"]} rows={s.waitlist.perWeek.map((w) => [w.label, w.n])} />
          <div className="grid gap-5 sm:grid-cols-2">
            <Table head={["Group", "Sign-ups"]} rows={s.waitlist.byPurpose.map((c) => [c.key, c.n])} />
            <Table head={["Size", "Sign-ups"]} rows={s.waitlist.bySize.map((c) => [c.key, c.n])} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Soon votes</CardTitle>
          <CardDescription>&ldquo;I want this&rdquo; on the landing page, all time.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table head={["Trick or chat app", "Votes"]} rows={s.votes.map((v) => [v.name, v.n])} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Groups added</CardTitle>
          <CardDescription>By the chat app they were added in.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Table head={["Chat app", "Groups"]} rows={s.groups.byChannel.map((c) => [CHANNEL[c.key] ?? c.key, c.n])} />
          <Table head={["Week", ...s.groups.channels.map((c) => CHANNEL[c] ?? c), "All"]} rows={s.groups.perWeek.map((w) => [w.label, ...s.groups.channels.map((c) => w.byChannel[c] ?? 0), w.total])} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weekly activity</CardTitle>
          <CardDescription>Active = sent at least one chat message that week. Chat lines are kept 30 days, so only the last {s.activity.length} weeks are here; the oldest may be partial.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <Table
            head={["Week", "Active groups", "Active members", "Members' lines", "Roomie's lines"]}
            rows={s.activity.map((a) => [a.label, a.activeGroups, a.activeMembers, a.memberLines, a.roomieLines])}
          />
          <RunsTable runs={s.runs} />
        </CardContent>
      </Card>
    </main>
  )
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-3xl bg-card p-4">
      <span className="type-caption text-muted-foreground">{label}</span>
      <span className="text-[1.75rem] leading-none font-semibold tabular-nums">{fmt(value)}</span>
    </div>
  )
}

function RunsTable({ runs }: { runs: Stats["runs"] }) {
  if (runs.length === 0) return <p className="type-caption m-0 text-muted-foreground">No replies counted in the last two days.</p>
  return (
    <div className="flex flex-col gap-2">
      <p className="type-caption m-0 text-muted-foreground">Replies worked out per day (the caps&apos; counters, kept two days).</p>
      <Table head={["Day (UTC)", "Runs"]} rows={runs.map((r) => [r.day, r.n])} />
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="type-body w-full border-collapse text-left">
        <thead>
          <tr className="border-b">
            {head.map((h, i) => (
              <th key={h} scope="col" className={`py-2 pr-4 font-semibold whitespace-nowrap ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r[0])} className="border-b border-border/60 last:border-0">
              {r.map((c, i) => (
                <td key={i} className={`py-1.5 pr-4 whitespace-nowrap ${i > 0 ? "text-right tabular-nums" : ""}`}>
                  {typeof c === "number" ? fmt(c) : c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
