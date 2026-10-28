"use client"

import { useEffect, useTransition } from "react"
import { FlameIcon, ListChecks } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { toast } from "@/components/ui/toast"
import { Roomie } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
import { MemberAvatar } from "@/components/app/member-avatar"
import { markChoreDone, markUpkeepDone } from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"
import type { ChoreView, UpkeepView } from "../types"

export function ChoresScreen({ chores, upkeep }: { chores: ChoreView[]; upkeep: UpkeepView[] }) {
  const { group, me, dates, cheers, cheer } = useGroup()
  const [cheering, hop] = useCheer()
  const [pending, start] = useTransition()
  const yours = chores.filter((c) => c.turn === me.id && c.due <= dates.today)
  const today = chores.filter((c) => c.due <= dates.today)
  const later = chores.filter((c) => c.due > dates.today)

  useEffect(() => {
    if (cheers > 0) hop()
  }, [cheers, hop])

  const done = (c: ChoreView) =>
    start(async () => {
      const res = await markChoreDone(group.id, c.id)
      if (!res.ok) return void toast.add({ title: "Couldn't mark it done", description: res.error, type: "error" })
      cheer()
      const streak = res.data?.streak ?? 1
      toast.add({ title: `${c.name}: done`, description: streak > 1 ? `That's ${streak} in a row.` : "Logged. The chart is happy.", type: "success" })
    })

  const upkeepDone = (u: UpkeepView) =>
    start(async () => {
      const res = await markUpkeepDone(group.id, u.id)
      if (!res.ok) return void toast.add({ title: "Couldn't mark it done", description: res.error, type: "error" })
      cheer()
      toast.add({ title: `${u.name}: done`, description: "I'll remind the group when it comes around again.", type: "success" })
    })

  return (
    <>
      <TopBar title="Chores" />
      <PageHeader title="Chores" />

      <section aria-label="Your turn" className="mx-4 flex items-center gap-4 rounded-3xl bg-card p-4">
        <Roomie size={76} mood={yours.length ? "calm" : "happy"} animated cheer={cheering} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="type-heading text-pretty">
            {yours.length ? `Your turn today: ${yours.map((c) => c.name.toLowerCase()).join(" and ")}.` : "Nothing on you today. Nice."}
          </p>
          {yours[0] ? (
            <Button className="self-start" disabled={pending} onClick={() => done(yours[0])}>
              Mark done
            </Button>
          ) : null}
        </div>
      </section>

      <div className="flex flex-col gap-8 px-4 pt-8">
        {chores.length === 0 ? (
          <Empty className="rounded-3xl bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListChecks />
              </EmptyMedia>
              <EmptyTitle>No chores on the chart</EmptyTitle>
              <EmptyDescription>Tell Roomie in the chat: “roomie add dishes every day”.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        <ChoreList title="Today" chores={today} onDone={done} pending={pending} />
        <ChoreList title="Coming up" chores={later} onDone={done} pending={pending} />

        {upkeep.length ? (
          <section aria-labelledby="upkeep" className="flex flex-col gap-2">
            <div className="flex flex-col gap-0.5 px-1">
              <h2 id="upkeep" className="type-heading">
                Upkeep
              </h2>
              <p className="type-caption text-muted-foreground">House care that comes around every few months.</p>
            </div>
            <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
              {[...upkeep]
                .sort((a, b) => a.due.localeCompare(b.due))
                .map((u) => {
                  const soon = dates.daysUntil(u.due) <= 7
                  return (
                    <Item key={u.id} className="py-3">
                      <ItemContent className="min-w-0">
                        <ItemTitle className="flex-wrap">
                          {u.name}
                          {soon ? <Badge variant="owe">Due {dates.dueLabel(u.due)}</Badge> : null}
                        </ItemTitle>
                        <ItemDescription className="line-clamp-none">
                          {u.every}. {soon ? "" : `Next ${dates.dueLabel(u.due)}.`} {u.lastDone ? `Last done ${dates.ago(u.lastDone)}.` : "Never done yet."}
                        </ItemDescription>
                      </ItemContent>
                      {soon ? (
                        <ItemActions>
                          <Button size="sm" variant="secondary" disabled={pending} onClick={() => upkeepDone(u)}>
                            Mark done
                          </Button>
                        </ItemActions>
                      ) : null}
                    </Item>
                  )
                })}
            </ItemGroup>
          </section>
        ) : null}
      </div>
    </>
  )
}

function ChoreList({ title, chores, onDone, pending }: { title: string; chores: ChoreView[]; onDone: (c: ChoreView) => void; pending: boolean }) {
  const { me, name, dates } = useGroup()
  if (chores.length === 0) return null
  return (
    <section aria-labelledby={`chores-${title}`} className="flex flex-col gap-2">
      <h2 id={`chores-${title}`} className="type-heading px-1">
        {title}
      </h2>
      <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
        {chores.map((c) => {
          const who = c.turn ? name(c.turn) : "Nobody"
          const dueNow = c.due <= dates.today
          return (
            <Item key={c.id} className="py-3">
              <ItemMedia>
                <MemberAvatar name={c.turn === me.id ? me.name : who} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>{c.name}</ItemTitle>
                <ItemDescription className="line-clamp-none">
                  {who === "You" ? "Your" : `${who}'s`} turn{dueNow ? (c.due < dates.today ? ` (${dates.dueLabel(c.due)})` : " today") : `, ${dates.dueLabel(c.due)}`}. {c.cadence}.
                  {c.lastDone ? ` Last done by ${name(c.lastDone.by) === "You" ? "you" : name(c.lastDone.by)} ${dates.ago(c.lastDone.date)}.` : ""}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="flex-col items-end gap-1.5">
                <span className="type-caption flex items-center gap-1 text-muted-foreground" aria-label={`${c.streak} in a row`}>
                  <FlameIcon className="size-3.5" aria-hidden />
                  <span className="money">{c.streak}</span>
                </span>
                {dueNow ? (
                  <Button size="sm" variant={c.turn === me.id ? "default" : "secondary"} disabled={pending} onClick={() => onDone(c)}>
                    Mark done
                  </Button>
                ) : null}
              </ItemActions>
            </Item>
          )
        })}
      </ItemGroup>
    </section>
  )
}
