"use client"

import { useState, useTransition } from "react"
import { BellIcon, PlusIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MemberAvatar } from "@/components/app/member-avatar"
import { addReminder, cancelReminder } from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"
import type { ReminderView } from "../types"

type Repeat = ReminderView["repeat"]

/** The Reminders page, laid out like House's tabs: Today and Coming up lists, Cancel where you may, and Add. */
export function RemindersScreen({ reminders }: { reminders: ReminderView[] }) {
  const { dates } = useGroup()
  const [adding, setAdding] = useState(false)
  const today = reminders.filter((r) => r.day <= dates.today)
  const later = reminders.filter((r) => r.day > dates.today)
  return (
    <>
      <TopBar title="Reminders" />
      <PageHeader title="Reminders">
        <p className="type-body text-muted-foreground">Everyone&apos;s go to the group chat. One person&apos;s go to them privately.</p>
      </PageHeader>
      <div className="flex flex-col gap-8 px-4 pb-28">
        {reminders.length === 0 ? (
          <Empty className="rounded-3xl bg-card">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon />
              </EmptyMedia>
              <EmptyTitle>No reminders coming up</EmptyTitle>
              <EmptyDescription>Add one here, or ask in the chat: “roomie remind everyone trash goes out Tuesday 8pm”.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={() => setAdding(true)}>Add a reminder</Button>
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <RemindersList title="Today" reminders={today} />
            <RemindersList title="Coming up" reminders={later} />
          </>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 mx-auto flex max-w-md justify-end px-4">
        <Button size="lg" className="pointer-events-auto shadow-lg" onClick={() => setAdding(true)}>
          <PlusIcon data-icon="inline-start" />
          Add reminder
        </Button>
      </div>

      <Drawer open={adding} onOpenChange={setAdding}>
        <DrawerContent className="mx-auto max-w-md">{adding ? <AddReminder onDone={() => setAdding(false)} /> : null}</DrawerContent>
      </Drawer>
    </>
  )
}

export function RemindersList({ title, reminders }: { title: string; reminders: ReminderView[] }) {
  const { group, name, me } = useGroup()
  const [pending, start] = useTransition()
  if (reminders.length === 0) return null
  const id = `reminders-${title.toLowerCase().replace(/\s+/g, "-")}`
  const cancel = (r: ReminderView) =>
    start(async () => {
      const res = await cancelReminder(group.id, r.id)
      if (!res.ok) return void toast.add({ title: "Couldn't cancel it", description: res.error, type: "error" })
      toast.add({ title: "Reminder cancelled", description: r.text })
    })

  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="type-heading px-1">
        {title}
      </h2>
      <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
        {reminders.map((r) => (
          <Item key={r.id} className="py-3">
            <ItemMedia>{r.for ? <MemberAvatar name={r.for === me.id ? me.name : name(r.for)} /> : <BellIcon className="size-5 text-muted-foreground" aria-hidden />}</ItemMedia>
            <ItemContent className="min-w-0">
              <ItemTitle className="flex-wrap">
                {r.text}
                {r.repeat ? <Badge variant="secondary">{REPEATS.find((x) => x.value === r.repeat)?.label}</Badge> : null}
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

const REPEATS: { label: string; short: string; value: Repeat }[] = [
  { label: "Once", short: "Once", value: null },
  { label: "Every day", short: "Daily", value: "daily" },
  { label: "Every week", short: "Weekly", value: "weekly" },
  { label: "Every month", short: "Monthly", value: "monthly" },
]

function AddReminder({ onDone }: { onDone: () => void }) {
  const { group, dates, cheer } = useGroup()
  const [text, setText] = useState("")
  const [day, setDay] = useState(dates.today)
  const [time, setTime] = useState("20:00")
  const [who, setWho] = useState<"everyone" | "me">("everyone")
  const [repeat, setRepeat] = useState<Repeat>(null)
  const [saving, start] = useTransition()
  const ok = text.trim() && /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{2}:\d{2}$/.test(time)

  const save = () =>
    start(async () => {
      const res = await addReminder(group.id, { text: text.trim(), at: `${day}T${time}`, justMe: who === "me", repeat })
      if (!res.ok) return void toast.add({ title: "Couldn't set it", description: res.error, type: "error" })
      cheer()
      toast.add({ title: "Reminder set", description: res.data ? `${res.data.text}: ${res.data.when}.` : undefined, type: "success" })
      onDone()
    })

  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">Add a reminder</DrawerTitle>
        <DrawerDescription>Roomie posts it at that time, in the chat or to you privately.</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="reminder-text">What</FieldLabel>
            <Input id="reminder-text" autoComplete="off" placeholder="Trash goes out" value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <div className="flex gap-3">
            <Field>
              <FieldLabel htmlFor="reminder-day">Day</FieldLabel>
              <Input id="reminder-day" type="date" min={dates.today} value={day} onChange={(e) => setDay(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="reminder-time">Time</FieldLabel>
              <Input id="reminder-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel>Who</FieldLabel>
            <ToggleGroup variant="segmented" spacing={1} value={[who]} onValueChange={(v) => v[0] && setWho(v[0] as "everyone" | "me")} aria-label="Who it's for">
              <ToggleGroupItem value="everyone">Everyone</ToggleGroupItem>
              <ToggleGroupItem value="me">Just me</ToggleGroupItem>
            </ToggleGroup>
            <FieldDescription>{who === "everyone" ? "Posted in the group chat." : "Sent to you privately."}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Repeat</FieldLabel>
            <ToggleGroup variant="segmented" spacing={1} value={[repeat ?? "once"]} onValueChange={(v) => v[0] && setRepeat(v[0] === "once" ? null : (v[0] as Repeat))} aria-label="Repeat">
              {REPEATS.map((r) => (
                <ToggleGroupItem key={r.label} value={r.value ?? "once"}>
                  {r.short}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </FieldGroup>
      </div>
      <DrawerFooter className="border-t pt-4">
        <Button size="lg" disabled={!ok || saving} onClick={save}>
          {saving ? <Spinner data-icon="inline-start" /> : null}
          Set reminder
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </>
  )
}
