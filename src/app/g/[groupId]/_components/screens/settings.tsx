"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState, useTransition } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useThemePreference, type ThemePreference } from "@/components/app/theme"
import type { ToolkitId } from "@/toolkits/types"
import type { SettingsPatch } from "@/services/groups"
import {
  connectSplitwise,
  deleteGroupData,
  exportSplitwise,
  importSplitwise,
  listSplitwiseGroups,
  setSimplifyDebts,
  setSplitwiseMirror,
  setToolkit,
  updateSchedule,
  updateSettings,
} from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"
import type { ScheduleView, SplitwiseView } from "../types"

const currencies = [
  { label: "US dollar (USD)", value: "USD" },
  { label: "Euro (EUR)", value: "EUR" },
  { label: "British pound (GBP)", value: "GBP" },
  { label: "Indian rupee (INR)", value: "INR" },
  { label: "Canadian dollar (CAD)", value: "CAD" },
]

export type ZoneGroup = { region: string; zones: { value: string; label: string }[] }

const hourLabel = (h: number) => (h === 0 ? "Midnight" : h === 12 ? "Noon" : h < 12 ? `${h} AM` : `${h - 12} PM`)
const hours = Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), value: String(h) }))
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((label, i) => ({ label, value: String(i) }))

const purposes = [
  { label: "Roommates", value: "roommates" },
  { label: "A trip", value: "trip" },
  { label: "Friends", value: "friends" },
  { label: "Family", value: "family" },
  { label: "Work", value: "work" },
  { label: "Something else", value: "other" },
]

const chattiness = {
  quiet: "Speaks when someone says “roomie”, mentions it, or replies to it.",
  normal: "Also chimes in when it's clearly useful, like a bill someone forgot to log.",
  chatty: "Jumps in more often with reminders, nudges and the odd joke.",
} as const

const toolkits: { id: ToolkitId | string; name: string; description: string; soon?: boolean }[] = [
  { id: "splitting", name: "Splitting", description: "Expenses, Shares and settling up" },
  { id: "groceries", name: "Groceries", description: "The Cart and Recipes" },
  { id: "chores", name: "Chores", description: "Rotations, streaks and reminders" },
  { id: "upkeep", name: "Upkeep", description: "Filters, batteries and other house care" },
  { id: "research", name: "Research", description: "Roomie looks things up for the group", soon: true },
  { id: "pdf", name: "PDFs", description: "Receipts, itineraries and summaries", soon: true },
  { id: "trips", name: "Trips", description: "Plan a trip and split it as you go", soon: true },
]

/** Pick the list entry, or add the Group's own value so the Select can show it. */
const withCurrent = (list: { label: string; value: string }[], value: string) => (list.some((x) => x.value === value) ? list : [...list, { label: value, value }])

export function SettingsScreen({ splitwise, notice, zones, schedule }: { splitwise: SplitwiseView | null; notice: string | null; zones: ZoneGroup[]; schedule: ScheduleView }) {
  const { group, isAdmin, active } = useGroup()
  const admins = active.filter((m) => m.role === "admin").map((m) => m.name)
  useEffect(() => {
    if (notice === "connected") toast.add({ title: "Splitwise connected", description: "Pick a Splitwise group to import or copy to.", type: "success" })
    if (notice === "failed") toast.add({ title: "Splitwise didn't connect", description: "Try Connect again.", type: "error" })
  }, [notice])
  return (
    <>
      <TopBar title="Settings" />
      <PageHeader title="Settings">
        <p className="type-body text-muted-foreground">
          {isAdmin ? "Only Admins can change these. You're an Admin." : `Only Admins can change ${group.name}'s settings. Ask ${admins.join(" or ") || "an Admin"}.`}
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10 px-5 pb-6">
        {isAdmin ? <AdminSettings splitwise={splitwise} zones={zones} schedule={schedule} /> : null}
        <Appearance />
        {isAdmin ? <DangerZone /> : null}
      </div>
    </>
  )
}

function AdminSettings({ splitwise, zones, schedule }: { splitwise: SplitwiseView | null; zones: ZoneGroup[]; schedule: ScheduleView }) {
  const { group, toolkits: on } = useGroup()
  const [name, setName] = useState(group.name)
  const [, start] = useTransition()
  const [browserZone, setBrowserZone] = useState<string | null>(null)
  const allZones = zones.flatMap((z) => z.zones)
  const zoneItems = allZones.some((z) => z.value === group.timezone) ? allZones : [...allZones, { value: group.timezone, label: group.timezone }]
  const zoneLabel = (value: string) => {
    const region = zones.find((g) => g.zones.some((z) => z.value === value))?.region
    const city = allZones.find((z) => z.value === value)?.label ?? value
    return region && region !== "Other" ? `${city} (${region})` : city
  }

  // A Group that hasn't finished setup gets the browser's zone offered (read after hydration so SSR matches).
  useEffect(() => {
    if (group.onboarded) return
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && tz !== group.timezone) setBrowserZone(tz)
  }, [group.onboarded, group.timezone])

  const save = (patch: SettingsPatch, ok: { title: string; description?: string }) =>
    start(async () => {
      const res = await updateSettings(group.id, patch)
      if (!res.ok) return void toast.add({ title: "Couldn't save that", description: res.error, type: "error" })
      toast.add(ok)
    })

  const toggle = (id: ToolkitId, label: string, enabled: boolean) =>
    start(async () => {
      const res = await setToolkit(group.id, id, enabled)
      if (!res.ok) return void toast.add({ title: "Couldn't switch it", description: res.error, type: "error" })
      toast.add({ title: `${label} ${enabled ? "on" : "off"}`, description: enabled ? "Roomie can use it in the chat now." : "Roomie stops using it. Nothing is deleted." })
    })

  return (
    <>
      <FieldSet>
        <FieldLegend className="type-heading">Group</FieldLegend>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="group-name">Name</FieldLabel>
            <Input
              id="group-name"
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                const clean = name.trim()
                if (!clean) return setName(group.name)
                if (clean !== group.name) save({ name: clean }, { title: "Group renamed", description: `It's ${clean} now. The WhatsApp chat keeps its own name.` })
              }}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="purpose">What it&apos;s for</FieldLabel>
            <Select items={purposes} value={group.purpose ?? "roommates"} onValueChange={(v) => v && save({ purpose: v as SettingsPatch["purpose"] }, { title: "Saved" })}>
              <SelectTrigger id="purpose" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {purposes.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="currency">Currency</FieldLabel>
            <Select items={withCurrent(currencies, group.currency)} value={group.currency} onValueChange={(v) => v && save({ currency: v }, { title: "Currency changed", description: `Amounts show in ${v} now.` })}>
              <SelectTrigger id="currency" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {withCurrent(currencies, group.currency).map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>One currency per Group. Changing it doesn&apos;t convert old expenses.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="timezone">Time zone</FieldLabel>
            <Select
              items={zoneItems.map((z) => ({ value: z.value, label: zoneLabel(z.value) }))}
              value={group.timezone}
              onValueChange={(v) => v && save({ timezone: v }, { title: "Time zone changed", description: `Chore days, reminders and the weekly report follow ${zoneLabel(v)} now.` })}
            >
              <SelectTrigger id="timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((g) => (
                  <SelectGroup key={g.region}>
                    <SelectLabel>{g.region}</SelectLabel>
                    {g.zones.map((z) => (
                      <SelectItem key={z.value} value={z.value}>
                        {z.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>&quot;Today&quot;, reminders, chore days and the weekly report follow this.</FieldDescription>
            {browserZone ? (
              <Button variant="outline" size="sm" className="self-start" onClick={() => save({ timezone: browserZone }, { title: "Time zone changed", description: `Using ${zoneLabel(browserZone)}, like this browser.` })}>
                Use this browser&apos;s: {zoneLabel(browserZone)}
              </Button>
            ) : null}
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="simplify">Simplify debts</FieldLabel>
              <FieldDescription>
                On: settle with the fewest payments, even between people who didn&apos;t share an expense. Off: each pair settles what they shared.
              </FieldDescription>
            </FieldContent>
            <Switch
              id="simplify"
              checked={group.simplifyDebts}
              onCheckedChange={(on) =>
                start(async () => {
                  const res = await setSimplifyDebts(group.id, on)
                  if (!res.ok) return void toast.add({ title: "Couldn't save that", description: res.error, type: "error" })
                  toast.add({ title: on ? "Simplify debts on" : "Simplify debts off", description: on ? "The Settle plan uses the fewest payments." : "The Settle plan is pairwise now." })
                })
              }
            />
          </Field>
        </FieldGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend className="type-heading">Chattiness</FieldLegend>
        <FieldDescription>How readily Roomie speaks up when nobody asked it.</FieldDescription>
        <ToggleGroup
          variant="segmented"
          spacing={1}
          value={[group.chattiness]}
          onValueChange={(v) => v[0] && save({ chattiness: v[0] as keyof typeof chattiness }, { title: "Saved" })}
          aria-label="Chattiness"
        >
          <ToggleGroupItem value="quiet">Quiet</ToggleGroupItem>
          <ToggleGroupItem value="normal">Normal</ToggleGroupItem>
          <ToggleGroupItem value="chatty">Chatty</ToggleGroupItem>
        </ToggleGroup>
        <p className="type-body text-muted-foreground" aria-live="polite">
          {chattiness[group.chattiness]}
        </p>
      </FieldSet>

      <ScheduleSettings schedule={schedule} choresOn={on.chores} />

      <FieldSet>
        <FieldLegend className="type-heading">Toolkits</FieldLegend>
        <FieldDescription>What Roomie can do in this Group. Switching one off stops its tools in the chat.</FieldDescription>
        <FieldGroup className="gap-4">
          {toolkits.map((t) => (
            <Field key={t.id} orientation="horizontal" data-disabled={t.soon || undefined}>
              <FieldContent>
                <FieldLabel htmlFor={`tk-${t.id}`}>
                  {t.name}
                  {t.soon ? <Badge variant="secondary">Coming soon</Badge> : null}
                </FieldLabel>
                <FieldDescription>{t.description}</FieldDescription>
              </FieldContent>
              <Switch
                id={`tk-${t.id}`}
                disabled={t.soon}
                checked={!t.soon && (on[t.id as ToolkitId] ?? false)}
                onCheckedChange={(v) => toggle(t.id as ToolkitId, t.name, v)}
              />
            </Field>
          ))}
        </FieldGroup>
      </FieldSet>

      {splitwise ? <SplitwiseSettings sw={splitwise} /> : null}
    </>
  )
}

/** When Roomie posts on its own: the daily chores nudge and the weekly report, in the Group's time zone. */
function ScheduleSettings({ schedule, choresOn }: { schedule: ScheduleView; choresOn: boolean }) {
  const { group } = useGroup()
  const [, start] = useTransition()
  const nudgeItems = [{ label: "Off", value: "off" }, ...hours]
  const save = (patch: Partial<ScheduleView>, title: string) =>
    start(async () => {
      const res = await updateSchedule(group.id, patch)
      if (!res.ok) return void toast.add({ title: "Couldn't save that", description: res.error, type: "error" })
      toast.add({ title })
    })
  return (
    <FieldSet>
      <FieldLegend className="type-heading">Roomie&apos;s own posts</FieldLegend>
      <FieldDescription>At most one chores nudge a day, only when something is due, and one report a week. Times are {group.timezone.replace(/_/g, " ")} time.</FieldDescription>
      <FieldGroup>
        <Field data-disabled={choresOn ? undefined : true}>
          <FieldLabel htmlFor="nudge-hour">Chores nudge</FieldLabel>
          <Select
            items={nudgeItems}
            value={schedule.nudgeHour === null ? "off" : String(schedule.nudgeHour)}
            disabled={!choresOn}
            onValueChange={(v) => v && save({ nudgeHour: v === "off" ? null : Number(v) }, v === "off" ? "Chores nudge off" : `Chores nudge at ${hourLabel(Number(v))}`)}
          >
            <SelectTrigger id="nudge-hour" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {nudgeItems.map((h) => (
                  <SelectItem key={h.value} value={h.value}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <FieldDescription>{choresOn ? "Roomie names whose turn it is on anything due or late." : "Switch Chores on to get the nudge."}</FieldDescription>
        </Field>
        <div className="flex gap-3">
          <Field>
            <FieldLabel htmlFor="report-day">Weekly report</FieldLabel>
            <Select items={weekdays} value={String(schedule.reportWeekday)} onValueChange={(v) => v && save({ reportWeekday: Number(v) }, `Weekly report on ${weekdays[Number(v)].label}s`)}>
              <SelectTrigger id="report-day" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {weekdays.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="report-hour">At</FieldLabel>
            <Select items={hours} value={String(schedule.reportHour)} onValueChange={(v) => v && save({ reportHour: Number(v) }, `Weekly report at ${hourLabel(Number(v))}`)}>
              <SelectTrigger id="report-hour" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {hours.map((h) => (
                    <SelectItem key={h.value} value={h.value}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FieldGroup>
    </FieldSet>
  )
}

const TERMS = "Splitwise's free API is for personal, non-commercial use. Roomie only copies what you ask it to, one way."

function SplitwiseSettings({ sw }: { sw: SplitwiseView }) {
  const { group } = useGroup()
  const router = useRouter()
  const [pending, start] = useTransition()
  const [options, setOptions] = useState<{ id: string; name: string; memberNames: string[] }[] | null>(null)
  const [picked, setPicked] = useState<string | null>(sw.group?.id ?? null)

  const fail = (title: string, error: string) => void toast.add({ title, description: error, type: "error" })
  const connect = () =>
    start(async () => {
      const res = await connectSplitwise(group.id)
      if (!res.ok) return fail("Couldn't connect Splitwise", res.error)
      if (res.data && !res.data.connected) return void (window.location.href = res.data.url)
      toast.add({ title: "Splitwise connected", type: "success" })
      router.refresh()
    })
  const loadGroups = () =>
    start(async () => {
      const res = await listSplitwiseGroups(group.id)
      if (!res.ok) return fail("Couldn't load your Splitwise groups", res.error)
      setOptions(res.data ?? [])
      if (!picked && res.data?.[0]) setPicked(res.data[0].id)
    })
  const doImport = () =>
    picked &&
    start(async () => {
      const res = await importSplitwise(group.id, picked)
      if (!res.ok) return fail("Import didn't work", res.error)
      const r = res.data!
      const extra = [r.settlements ? `${r.settlements} payments` : "", r.newMembers.length ? `${r.newMembers.join(", ")} added as pending` : "", r.skipped.duplicate ? `${r.skipped.duplicate} already here` : ""].filter(Boolean)
      toast.add({ title: `Imported ${r.expenses} expenses from ${r.splitwiseGroup}`, description: extra.join(" · ") || undefined, type: "success" })
    })
  const doExport = () =>
    start(async () => {
      const res = await exportSplitwise(group.id, picked ?? undefined)
      if (!res.ok) return fail("Export didn't work", res.error)
      const r = res.data!
      toast.add({ title: `Copied ${r.expenses} expenses to ${r.splitwiseGroup}`, description: r.skipped.length ? `${r.skipped.length} skipped: ${r.skipped[0].why}` : undefined, type: "success" })
    })
  const mirror = (on: boolean) =>
    start(async () => {
      const res = await setSplitwiseMirror(group.id, on, picked ?? undefined)
      if (!res.ok) return fail("Couldn't switch the mirror", res.error)
      toast.add({ title: on ? "Live mirror on" : "Live mirror off", description: on ? "New, changed and deleted expenses are copied to Splitwise within a minute." : undefined })
    })

  if (!sw.ready) {
    return (
      <FieldSet>
        <FieldLegend className="type-heading">Splitwise</FieldLegend>
        <Field orientation="horizontal" data-disabled>
          <FieldContent>
            <FieldLabel htmlFor="splitwise">Connect Splitwise</FieldLabel>
            <FieldDescription>Bring in your old Splitwise group, copy this one over, or keep one in sync.</FieldDescription>
          </FieldContent>
          <Button id="splitwise" variant="outline" size="sm" disabled>
            Connect
          </Button>
        </Field>
        <Alert>
          <AlertTitle>Splitwise isn&apos;t available here yet</AlertTitle>
          <AlertDescription>{sw.hint}</AlertDescription>
        </Alert>
        <FieldDescription>{TERMS}</FieldDescription>
      </FieldSet>
    )
  }

  return (
    <FieldSet>
      <FieldLegend className="type-heading">Splitwise</FieldLegend>
      {!sw.connected ? (
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="splitwise">Connect Splitwise</FieldLabel>
            <FieldDescription>Sign in with your own Splitwise. Then bring in a Splitwise group, copy this one over, or keep one in sync.</FieldDescription>
          </FieldContent>
          <Button id="splitwise" variant="outline" size="sm" disabled={pending} onClick={connect}>
            Connect
          </Button>
        </Field>
      ) : (
        <FieldGroup className="gap-4">
          <FieldDescription>
            Connected{sw.connectedBy ? ` by ${sw.connectedBy}` : ""}
            {sw.group ? `, linked to ${sw.group.name}` : ""}
            {sw.lastSynced ? `. Last copied ${sw.lastSynced}` : ""}.{sw.pendingPushes ? ` ${sw.pendingPushes} change${sw.pendingPushes === 1 ? "" : "s"} waiting to go to Splitwise.` : ""}
            {sw.fake ? " (In-memory test Splitwise.)" : ""}
          </FieldDescription>
          <Field>
            <FieldLabel htmlFor="sw-group">Splitwise group</FieldLabel>
            {options ? (
              <Select items={options.map((o) => ({ label: o.name, value: o.id }))} value={picked} onValueChange={(v) => v && setPicked(v)}>
                <SelectTrigger id="sw-group" className="w-full">
                  <SelectValue placeholder="Pick a group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {options.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <Button id="sw-group" variant="outline" disabled={pending} onClick={loadGroups} className="justify-start">
                {sw.group ? sw.group.name : "Choose a Splitwise group"}
              </Button>
            )}
            {options && picked ? <FieldDescription>People: {options.find((o) => o.id === picked)?.memberNames.join(", ")}</FieldDescription> : null}
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || !picked} onClick={doImport}>
              Import its history
            </Button>
            <Button variant="secondary" disabled={pending || !picked} onClick={doExport}>
              Copy ours to Splitwise
            </Button>
          </div>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="sw-mirror">Live mirror</FieldLabel>
              <FieldDescription>Every expense added, changed or deleted here is copied to Splitwise. Changes in Splitwise don&apos;t come back.</FieldDescription>
            </FieldContent>
            <Switch id="sw-mirror" checked={sw.mirror} disabled={pending || (!picked && !sw.group)} onCheckedChange={mirror} />
          </Field>
        </FieldGroup>
      )}
      <FieldDescription>{TERMS}</FieldDescription>
    </FieldSet>
  )
}

function Appearance() {
  const [theme, setTheme] = useThemePreference()
  return (
    <FieldSet>
      <FieldLegend className="type-heading">Appearance</FieldLegend>
      <ToggleGroup variant="segmented" spacing={1} value={[theme]} onValueChange={(v) => v[0] && setTheme(v[0] as ThemePreference)} aria-label="Theme">
        <ToggleGroupItem value="system">System</ToggleGroupItem>
        <ToggleGroupItem value="light">Light</ToggleGroupItem>
        <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
      </ToggleGroup>
      <FieldDescription>System follows your phone.</FieldDescription>
    </FieldSet>
  )
}

function DangerZone() {
  const router = useRouter()
  const { group } = useGroup()
  const [confirming, setConfirming] = useState(false)
  const [pending, start] = useTransition()
  const wipe = () =>
    start(async () => {
      const res = await deleteGroupData(group.id)
      setConfirming(false)
      if (!res.ok) return void toast.add({ title: "Couldn't delete it", description: res.error, type: "error" })
      toast.add({ title: "Group data deleted", description: "Roomie starts fresh from the next message." })
      router.push(`/g/${group.id}`)
    })
  return (
    <>
      <FieldSeparator />
      <FieldSet>
        <FieldLegend className="type-heading">Danger zone</FieldLegend>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="delete-data">Delete group data</FieldLabel>
            <FieldDescription>Removes every expense, Cart item, chore and chat line Roomie kept for {group.name}, and what it remembers. Roomie stays in the chat.</FieldDescription>
          </FieldContent>
        </Field>
        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogTrigger render={<Button id="delete-data" variant="destructive" size="lg" className="self-start" />}>Delete group data</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete everything for {group.name}?</AlertDialogTitle>
              <AlertDialogDescription>Balances, expenses, the Cart, chores and 30 days of chat history go for good. This can&apos;t be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={pending} onClick={wipe}>
                Delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </FieldSet>
    </>
  )
}
