"use client"

import { FlameIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { toast } from "@/components/ui/toast"
import { Roomie } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
import { ME, type Chore } from "../../_data"
import { ago, daysUntil, dueLabel, TODAY } from "../../_lib/dates"
import { useMemberName, useStore } from "../../_lib/store"
import { MemberAvatar } from "../member-avatar"
import { PageHeader, TopBar } from "../shell"

export function ChoresScreen() {
  const { state, markChoreDone, markUpkeepDone } = useStore()
  const name = useMemberName()
  const [cheering, cheer] = useCheer()
  const yours = state.chores.filter((c) => c.turn === ME && c.due <= TODAY)
  const today = state.chores.filter((c) => c.due <= TODAY)
  const later = state.chores.filter((c) => c.due > TODAY)

  const done = (c: Chore) => {
    const next = c.rotation[(c.rotation.indexOf(c.turn) + 1) % c.rotation.length]
    markChoreDone(c.id)
    cheer()
    toast.add({ title: `${c.name}: done`, description: `That's ${c.streak + 1} in a row. ${name(next)} is up next.`, type: "success" })
  }

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
            <Button className="self-start" onClick={() => done(yours[0])}>
              Mark done
            </Button>
          ) : null}
        </div>
      </section>

      <div className="flex flex-col gap-8 px-4 pt-8">
        <ChoreList title="Today" chores={today} onDone={done} />
        <ChoreList title="Coming up" chores={later} onDone={done} />

        <section aria-labelledby="upkeep" className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5 px-1">
            <h2 id="upkeep" className="type-heading">
              Upkeep
            </h2>
            <p className="type-caption text-muted-foreground">House care that comes around every few months.</p>
          </div>
          <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
            {[...state.upkeep]
              .sort((a, b) => a.due.localeCompare(b.due))
              .map((u) => {
                const soon = daysUntil(u.due) <= 7
                return (
                  <Item key={u.id} className="py-3">
                    <ItemContent className="min-w-0">
                      <ItemTitle className="flex-wrap">
                        {u.name}
                        {soon ? <Badge variant="owe">Due {dueLabel(u.due)}</Badge> : null}
                      </ItemTitle>
                      <ItemDescription className="line-clamp-none">
                        {u.every}. {soon ? "" : `Next ${dueLabel(u.due)}.`} {u.lastDone ? `Last done ${ago(u.lastDone)}.` : ""}
                      </ItemDescription>
                    </ItemContent>
                    {soon ? (
                      <ItemActions>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            markUpkeepDone(u.id)
                            toast.add({ title: `${u.name}: done`, description: "I'll remind the group when it comes around again.", type: "success" })
                          }}
                        >
                          Mark done
                        </Button>
                      </ItemActions>
                    ) : null}
                  </Item>
                )
              })}
          </ItemGroup>
        </section>
      </div>
    </>
  )
}

function ChoreList({ title, chores, onDone }: { title: string; chores: Chore[]; onDone: (c: Chore) => void }) {
  const name = useMemberName()
  if (chores.length === 0) return null
  return (
    <section aria-labelledby={`chores-${title}`} className="flex flex-col gap-2">
      <h2 id={`chores-${title}`} className="type-heading px-1">
        {title}
      </h2>
      <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
        {chores.map((c) => {
          const who = name(c.turn)
          const dueNow = c.due <= TODAY
          return (
            <Item key={c.id} className="py-3">
              <ItemMedia>
                <MemberAvatar name={c.turn === ME ? "Maya" : who} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle>{c.name}</ItemTitle>
                <ItemDescription className="line-clamp-none">
                  {who === "You" ? "Your" : `${who}'s`} turn{dueNow ? " today" : `, ${dueLabel(c.due)}`}. {c.cadence}.
                  {c.lastDone ? ` Last done by ${name(c.lastDone.by) === "You" ? "you" : name(c.lastDone.by)} ${ago(c.lastDone.date)}.` : ""}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="flex-col items-end gap-1.5">
                <span className="type-caption flex items-center gap-1 text-muted-foreground" aria-label={`${c.streak} in a row`}>
                  <FlameIcon className="size-3.5" aria-hidden />
                  <span className="money">{c.streak}</span>
                </span>
                {dueNow ? (
                  <Button size="sm" variant={c.turn === ME ? "default" : "secondary"} onClick={() => onDone(c)}>
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
