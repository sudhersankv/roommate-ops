"use client"

import { useEffect, useState, useTransition } from "react"
import { ArrowDownIcon, ArrowUpIcon, BellIcon, EllipsisIcon, FlameIcon, ListChecks, PlusIcon, WrenchIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Roomie } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
import { MemberAvatar } from "@/components/app/member-avatar"
import { addChore, addUpkeep, addUpkeepDefaults, cancelReminder, markChoreDone, markUpkeepDone, removeChore, removeUpkeep, skipChore } from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"
import type { ChoreView, ReminderView, UpkeepView } from "../types"

export type ChoresTab = "chores" | "upkeep" | "reminders"

export function ChoresScreen({ initialTab = "chores", chores, upkeep, reminders }: { initialTab?: ChoresTab; chores: ChoreView[]; upkeep: UpkeepView[]; reminders: ReminderView[] }) {
  const { group, me, dates, cheers, cheer, toolkits } = useGroup()
  const [cheering, hop] = useCheer()
  const [pending, start] = useTransition()
  const [tab, setTab] = useState<ChoresTab>(initialTab)
  const [adding, setAdding] = useState<"chore" | "upkeep" | null>(null)
  const yours = chores.filter((c) => c.turn === me.id && c.due <= dates.today)

  useEffect(() => {
    if (cheers > 0) hop()
  }, [cheers, hop])

  const show = (t: ChoresTab) => {
    setTab(t)
    window.history.replaceState(null, "", t === "chores" ? window.location.pathname : `?tab=${t}`)
  }

  const done = (c: ChoreView) =>
    start(async () => {
      const res = await markChoreDone(group.id, c.id)
      if (!res.ok) return void toast.add({ title: "Couldn't mark it done", description: res.error, type: "error" })
      cheer()
      const streak = res.data?.streak ?? 1
      const next = res.data?.nextUp ? ` ${res.data.nextUp === me.name ? "You're" : `${res.data.nextUp}'s`} up next.` : ""
      toast.add({ title: `${c.name}: done`, description: `${streak > 1 ? `That's ${streak} on time in a row.` : "Logged. The chart is happy."}${next}`, type: "success" })
    })

  const skip = (c: ChoreView) =>
    start(async () => {
      const res = await skipChore(group.id, c.id)
      if (!res.ok) return void toast.add({ title: "Couldn't pass it", description: res.error, type: "error" })
      toast.add({ title: `Passed ${c.name.toLowerCase()}`, description: res.data?.nextUp ? `${res.data.nextUp}'s up now.` : undefined })
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
            <div className="flex flex-wrap gap-2">
              <Button disabled={pending} onClick={() => done(yours[0])}>
                Mark done
              </Button>
              <Button variant="ghost" disabled={pending} onClick={() => skip(yours[0])}>
                Pass it on
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <div className="px-4 pt-6 pb-4">
        <ToggleGroup variant="segmented" spacing={1} value={[tab]} onValueChange={(v) => v[0] && show(v[0] as ChoresTab)} aria-label="Show">
          <ToggleGroupItem value="chores">Chores</ToggleGroupItem>
          <ToggleGroupItem value="upkeep">Upkeep</ToggleGroupItem>
          <ToggleGroupItem value="reminders">Reminders</ToggleGroupItem>
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-8 px-4 pb-28">
        {tab === "chores" ? (
          <ChoresTabView chores={chores} onDone={done} onSkip={skip} pending={pending} onAdd={() => setAdding("chore")} disabled={!toolkits.chores} />
        ) : tab === "upkeep" ? (
          <UpkeepTabView upkeep={upkeep} onAdd={() => setAdding("upkeep")} disabled={!toolkits.upkeep} />
        ) : (
          <RemindersTabView reminders={reminders} />
        )}
      </div>

      {tab !== "reminders" ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 mx-auto flex max-w-md justify-end px-4">
          <Button size="lg" className="pointer-events-auto shadow-lg" onClick={() => setAdding(tab === "chores" ? "chore" : "upkeep")}>
            <PlusIcon data-icon="inline-start" />
            {tab === "chores" ? "Add chore" : "Add upkeep"}
          </Button>
        </div>
      ) : null}

      <Drawer open={adding === "chore"} onOpenChange={(o) => !o && setAdding(null)}>
        <DrawerContent className="mx-auto max-w-md">{adding === "chore" ? <AddChore onDone={() => setAdding(null)} /> : null}</DrawerContent>
      </Drawer>
      <Drawer open={adding === "upkeep"} onOpenChange={(o) => !o && setAdding(null)}>
        <DrawerContent className="mx-auto max-w-md">{adding === "upkeep" ? <AddUpkeep onDone={() => setAdding(null)} /> : null}</DrawerContent>
      </Drawer>
    </>
  )
}

/* ---------- Chores ---------- */

function ChoresTabView({ chores, onDone, onSkip, pending, onAdd, disabled }: { chores: ChoreView[]; onDone: (c: ChoreView) => void; onSkip: (c: ChoreView) => void; pending: boolean; onAdd: () => void; disabled: boolean }) {
  const { dates } = useGroup()
  const today = chores.filter((c) => c.due <= dates.today)
  const later = chores.filter((c) => c.due > dates.today)
  if (chores.length === 0) {
    return (
      <Empty className="rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListChecks />
          </EmptyMedia>
          <EmptyTitle>No chores on the chart</EmptyTitle>
          <EmptyDescription>{disabled ? "Roomie hasn't learned Chores here yet." : "Add one here, or tell Roomie in the chat: “roomie add dishes every day”."}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onAdd}>Add a chore</Button>
        </EmptyContent>
      </Empty>
    )
  }
  return (
    <>
      <ChoreList title="Today" chores={today} onDone={onDone} onSkip={onSkip} pending={pending} />
      <ChoreList title="Coming up" chores={later} onDone={onDone} onSkip={onSkip} pending={pending} />
    </>
  )
}

function ChoreList({ title, chores, onDone, onSkip, pending }: { title: string; chores: ChoreView[]; onDone: (c: ChoreView) => void; onSkip: (c: ChoreView) => void; pending: boolean }) {
  const { group, me, name, dates, isAdmin } = useGroup()
  const [, start] = useTransition()
  if (chores.length === 0) return null
  const remove = (c: ChoreView) =>
    start(async () => {
      const res = await removeChore(group.id, c.id)
      if (!res.ok) return void toast.add({ title: "Couldn't remove it", description: res.error, type: "error" })
      toast.add({ title: `${c.name} is off the chart` })
    })
  return (
    <section aria-labelledby={`chores-${title}`} className="flex flex-col gap-2">
      <h2 id={`chores-${title}`} className="type-heading px-1">
        {title}
      </h2>
      <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
        {chores.map((c) => {
          const who = c.turn ? name(c.turn) : "Nobody"
          const dueNow = c.due <= dates.today
          const mine = c.turn === me.id
          const turns = c.rotation ? `Turns: ${c.order.map((id) => (id === me.id ? "you" : name(id))).join(", ")}.` : "Everyone takes turns."
          return (
            <Item key={c.id} className="py-3">
              <ItemMedia>
                <MemberAvatar name={mine ? me.name : who} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="flex-wrap">
                  {c.name}
                  {c.state === "overdue" ? <Badge variant="owe">{dates.dueLabel(c.due)}</Badge> : null}
                </ItemTitle>
                <ItemDescription className="line-clamp-none">
                  {mine ? "Your" : `${who}'s`} turn{dueNow ? (c.state === "overdue" ? "" : " today") : `, ${dates.dueLabel(c.due)}`}. {c.cadence}. {turns}
                  {c.lastDone ? ` Last done by ${name(c.lastDone.by) === "You" ? "you" : name(c.lastDone.by)} ${dates.ago(c.lastDone.date)}.` : " Not done yet."}
                </ItemDescription>
              </ItemContent>
              <ItemActions className="flex-col items-end gap-1.5">
                <div className="flex items-center gap-1">
                  <span
                    className="type-caption flex items-center gap-1 text-muted-foreground"
                    aria-label={c.lastDone ? `${c.streak} on time in a row by ${name(c.lastDone.by) === "You" ? "you" : name(c.lastDone.by)}` : "No streak yet"}
                  >
                    <FlameIcon className="size-3.5" aria-hidden />
                    <span className="money">{c.streak}</span>
                  </span>
                  {mine || isAdmin ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`More for ${c.name}`} />}>
                        <EllipsisIcon />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-44">
                        <DropdownMenuGroup>
                          {mine ? <DropdownMenuItem onClick={() => onSkip(c)}>Pass my turn</DropdownMenuItem> : null}
                          {isAdmin ? (
                            <DropdownMenuItem variant="destructive" onClick={() => remove(c)}>
                              Remove chore
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuGroup>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
                {dueNow ? (
                  <Button size="sm" variant={mine ? "default" : "secondary"} disabled={pending} onClick={() => onDone(c)}>
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

const CADENCES = [
  { label: "Daily", days: 1 },
  { label: "3 days", days: 3 },
  { label: "Weekly", days: 7 },
  { label: "2 weeks", days: 14 },
]

function AddChore({ onDone }: { onDone: () => void }) {
  const { group, active, me, cheer } = useGroup()
  const [name, setName] = useState("")
  const [days, setDays] = useState("7")
  const [mode, setMode] = useState<"everyone" | "order">("everyone")
  const [order, setOrder] = useState<string[]>(() => [me.id, ...active.map((m) => m.id).filter((id) => id !== me.id)])
  const [included, setIncluded] = useState<string[]>(active.map((m) => m.id))
  const [saving, start] = useTransition()
  const n = Number(days)
  const daysOk = Number.isInteger(n) && n >= 1 && n <= 365
  const rotation = mode === "order" ? order.filter((id) => included.includes(id)) : []
  const ok = name.trim() && daysOk && (mode === "everyone" || rotation.length > 0)
  const label = (id: string) => (id === me.id ? `${me.name} (you)` : (active.find((m) => m.id === id)?.name ?? "Someone"))

  const move = (id: string, by: -1 | 1) =>
    setOrder((o) => {
      const i = o.indexOf(id)
      const j = i + by
      if (i < 0 || j < 0 || j >= o.length) return o
      const next = [...o]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const save = () =>
    start(async () => {
      const res = await addChore(group.id, { name: name.trim(), everyDays: n, rotation })
      if (!res.ok) return void toast.add({ title: "Couldn't add it", description: res.error, type: "error" })
      cheer()
      toast.add({ title: res.data?.created ? `${res.data.name} is on the chart` : `${res.data?.name} updated`, description: res.data?.rotation.length ? `Turns: ${res.data.rotation.join(", ")}.` : undefined, type: "success" })
      onDone()
    })

  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">Add a chore</DrawerTitle>
        <DrawerDescription>Roomie tracks whose turn it is and nudges the chat on the day it&apos;s due.</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="chore-name">Chore</FieldLabel>
            <Input id="chore-name" autoComplete="off" placeholder="Take out the recycling" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field data-invalid={daysOk ? undefined : true}>
            <FieldLabel htmlFor="chore-days">Every how many days</FieldLabel>
            <ToggleGroup variant="segmented" spacing={1} value={[String(CADENCES.find((c) => c.days === n)?.days ?? "")]} onValueChange={(v) => v[0] && setDays(v[0])} aria-label="How often">
              {CADENCES.map((c) => (
                <ToggleGroupItem key={c.days} value={String(c.days)}>
                  {c.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Input id="chore-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={daysOk ? undefined : true} className="w-24" />
            <FieldDescription>{daysOk ? (n === 1 ? "Every day." : `Every ${n} days.`) : "A number of days, 1 to 365."}</FieldDescription>
          </Field>
          <FieldSet>
            <FieldLegend variant="label">Who takes turns</FieldLegend>
            <ToggleGroup variant="segmented" spacing={1} value={[mode]} onValueChange={(v) => v[0] && setMode(v[0] as "everyone" | "order")} aria-label="Turn order">
              <ToggleGroupItem value="everyone">Everyone</ToggleGroupItem>
              <ToggleGroupItem value="order">In this order</ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>
              {mode === "everyone" ? "Whoever did it least recently goes next, new people included." : "Top goes first. Untick anyone who's not in on this one."}
            </FieldDescription>
            {mode === "order" ? (
              <div className="flex flex-col divide-y rounded-2xl border">
                {order.map((id, i) => (
                  <Field key={id} orientation="horizontal" className="min-h-14 px-3.5 py-2">
                    <Checkbox id={`rot-${id}`} checked={included.includes(id)} onCheckedChange={(on) => setIncluded((x) => (on ? [...x, id] : x.filter((y) => y !== id)))} />
                    <FieldLabel htmlFor={`rot-${id}`} className="flex-1">
                      {label(id)}
                    </FieldLabel>
                    <Button variant="ghost" size="icon-xs" aria-label={`Move ${label(id)} up`} disabled={i === 0} onClick={() => move(id, -1)}>
                      <ArrowUpIcon />
                    </Button>
                    <Button variant="ghost" size="icon-xs" aria-label={`Move ${label(id)} down`} disabled={i === order.length - 1} onClick={() => move(id, 1)}>
                      <ArrowDownIcon />
                    </Button>
                  </Field>
                ))}
              </div>
            ) : null}
          </FieldSet>
        </FieldGroup>
      </div>
      <DrawerFooter className="border-t pt-4">
        <Button size="lg" disabled={!ok || saving} onClick={save}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Add chore
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </>
  )
}

/* ---------- Upkeep ---------- */

function UpkeepTabView({ upkeep, onAdd, disabled }: { upkeep: UpkeepView[]; onAdd: () => void; disabled: boolean }) {
  const { group, dates, isAdmin, cheer } = useGroup()
  const [pending, start] = useTransition()

  const usual = () =>
    start(async () => {
      const res = await addUpkeepDefaults(group.id)
      if (!res.ok) return void toast.add({ title: "Couldn't add them", description: res.error, type: "error" })
      toast.add({ title: `Tracking ${res.data ?? 0} more`, description: "Mark each one done when you next do it, and the clock starts.", type: "success" })
    })
  const markDone = (u: UpkeepView) =>
    start(async () => {
      const res = await markUpkeepDone(group.id, u.id)
      if (!res.ok) return void toast.add({ title: "Couldn't mark it done", description: res.error, type: "error" })
      cheer()
      toast.add({ title: `${u.name}: done`, description: res.data ? `Next one ${dates.dueLabel(res.data.nextDueDay)}.` : undefined, type: "success" })
    })
  const remove = (u: UpkeepView) =>
    start(async () => {
      const res = await removeUpkeep(group.id, u.id)
      if (!res.ok) return void toast.add({ title: "Couldn't remove it", description: res.error, type: "error" })
      toast.add({ title: `Stopped tracking ${u.name}` })
    })

  if (upkeep.length === 0) {
    return (
      <Empty className="rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <WrenchIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing tracked yet</EmptyTitle>
          <EmptyDescription>{disabled ? "Roomie hasn't learned Upkeep here yet." : "Filters, smoke alarms, the dryer vent: Roomie remembers so nobody has to."}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <Button disabled={pending} onClick={usual}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Add the usual 5
          </Button>
          <Button variant="outline" onClick={onAdd}>
            Add your own
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  return (
    <section aria-labelledby="upkeep" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 id="upkeep" className="type-heading">
          Upkeep
        </h2>
        <p className="type-caption text-muted-foreground">House care that comes around every few months. Due-soon ones show up in the weekly report.</p>
      </div>
      <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
        {upkeep.map((u) => {
          const due = u.status !== "ok"
          return (
            <Item key={u.id} className="py-3">
              <ItemContent className="min-w-0">
                <ItemTitle className="flex-wrap">
                  {u.name}
                  {u.status === "overdue" ? <Badge variant="owe">{dates.dueLabel(u.due)}</Badge> : u.status === "due-soon" ? <Badge variant="secondary">Due {dates.dueLabel(u.due)}</Badge> : null}
                </ItemTitle>
                <ItemDescription className="line-clamp-none">
                  {u.every}. {due ? "" : `Next ${dates.dueLabel(u.due)}. `}
                  {u.lastDone ? `Last done ${dates.ago(u.lastDone)}.` : "Not marked done yet."}
                </ItemDescription>
              </ItemContent>
              <ItemActions>
                {due ? (
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => markDone(u)}>
                    Mark done
                  </Button>
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`More for ${u.name}`} />}>
                    <EllipsisIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-44">
                    <DropdownMenuGroup>
                      {!due ? <DropdownMenuItem onClick={() => markDone(u)}>Mark done today</DropdownMenuItem> : null}
                      {isAdmin ? (
                        <DropdownMenuItem variant="destructive" onClick={() => remove(u)}>
                          Stop tracking
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              </ItemActions>
            </Item>
          )
        })}
      </ItemGroup>
    </section>
  )
}

function AddUpkeep({ onDone }: { onDone: () => void }) {
  const { group } = useGroup()
  const [item, setItem] = useState("")
  const [days, setDays] = useState("90")
  const [saving, start] = useTransition()
  const n = Number(days)
  const daysOk = Number.isInteger(n) && n >= 1 && n <= 3650
  const save = () =>
    start(async () => {
      const res = await addUpkeep(group.id, { item: item.trim(), everyDays: n })
      if (!res.ok) return void toast.add({ title: "Couldn't add it", description: res.error, type: "error" })
      toast.add({ title: res.data?.created ? `Tracking ${res.data.item}` : `${res.data?.item} updated`, type: "success" })
      onDone()
    })
  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">Add upkeep</DrawerTitle>
        <DrawerDescription>Something the house needs every so often.</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="upkeep-item">What</FieldLabel>
            <Input id="upkeep-item" autoComplete="off" placeholder="Clean the gutters" value={item} onChange={(e) => setItem(e.target.value)} />
          </Field>
          <Field data-invalid={daysOk ? undefined : true}>
            <FieldLabel htmlFor="upkeep-days">Every how many days</FieldLabel>
            <ToggleGroup variant="segmented" spacing={1} value={[String([30, 90, 180, 365].find((d) => d === n) ?? "")]} onValueChange={(v) => v[0] && setDays(v[0])} aria-label="How often">
              <ToggleGroupItem value="30">Month</ToggleGroupItem>
              <ToggleGroupItem value="90">3 months</ToggleGroupItem>
              <ToggleGroupItem value="180">6 months</ToggleGroupItem>
              <ToggleGroupItem value="365">Year</ToggleGroupItem>
            </ToggleGroup>
            <Input id="upkeep-days" inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} aria-invalid={daysOk ? undefined : true} className="w-24" />
          </Field>
        </FieldGroup>
      </div>
      <DrawerFooter className="border-t pt-4">
        <Button size="lg" disabled={!item.trim() || !daysOk || saving} onClick={save}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Start tracking
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </>
  )
}

/* ---------- Reminders ---------- */

function RemindersTabView({ reminders }: { reminders: ReminderView[] }) {
  const { group, name, me } = useGroup()
  const [pending, start] = useTransition()
  const cancel = (r: ReminderView) =>
    start(async () => {
      const res = await cancelReminder(group.id, r.id)
      if (!res.ok) return void toast.add({ title: "Couldn't cancel it", description: res.error, type: "error" })
      toast.add({ title: "Reminder cancelled", description: r.text })
    })

  if (reminders.length === 0) {
    return (
      <Empty className="rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BellIcon />
          </EmptyMedia>
          <EmptyTitle>No reminders coming up</EmptyTitle>
          <EmptyDescription>Ask in the chat: “roomie remind everyone trash goes out Tuesday 8pm”, or “remind me to pay rent on the 1st every month”.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <section aria-labelledby="reminders" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 id="reminders" className="type-heading">
          Coming up
        </h2>
        <p className="type-caption text-muted-foreground">Everyone&apos;s go to the group chat. One person&apos;s go to them privately.</p>
      </div>
      <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
        {reminders.map((r) => (
          <Item key={r.id} className="py-3">
            <ItemMedia>{r.for ? <MemberAvatar name={r.for === me.id ? me.name : name(r.for)} /> : <BellIcon className="size-5 text-muted-foreground" aria-hidden />}</ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="flex-wrap">
                {r.text}
                {r.repeat ? <Badge variant="secondary">{r.repeat === "daily" ? "Every day" : r.repeat === "weekly" ? "Every week" : "Every month"}</Badge> : null}
              </ItemTitle>
              <ItemDescription className="line-clamp-none">
                {r.when}. {r.for ? (r.for === me.id ? "Just for you" : `For ${name(r.for)}`) : "For everyone"}
                {r.setBy && r.setBy !== r.for ? `, set by ${name(r.setBy) === "You" ? "you" : name(r.setBy)}` : ""}.
              </ItemDescription>
            </ItemContent>
            {r.canCancel ? (
              <ItemActions>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => cancel(r)}>
                  Cancel
                </Button>
              </ItemActions>
            ) : null}
          </Item>
        ))}
      </ItemGroup>
    </section>
  )
}
