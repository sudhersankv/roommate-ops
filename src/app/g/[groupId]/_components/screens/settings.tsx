"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useState, useTransition, type ReactNode } from "react"

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
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSeparator, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useThemePreference, type ThemePreference } from "@/components/app/theme"
import type { SettingsPatch } from "@/services/groups"
import {
  connectSplitwise,
  deleteGroupData,
  exportSplitwise,
  importSplitwise,
  listSplitwiseGroups,
  setSimplifyDebts,
  setSplitwiseMirror,
  updateSettings,
} from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"
import type { SplitwiseView } from "../types"

const currencies = [
  { label: "US dollar (USD)", value: "USD" },
  { label: "Euro (EUR)", value: "EUR" },
  { label: "British pound (GBP)", value: "GBP" },
  { label: "Indian rupee (INR)", value: "INR" },
  { label: "Canadian dollar (CAD)", value: "CAD" },
]

const zones = [
  { label: "Central (Chicago)", value: "America/Chicago" },
  { label: "Eastern (New York)", value: "America/New_York" },
  { label: "Mountain (Denver)", value: "America/Denver" },
  { label: "Pacific (Los Angeles)", value: "America/Los_Angeles" },
  { label: "London", value: "Europe/London" },
  { label: "Berlin", value: "Europe/Berlin" },
  { label: "India (Kolkata)", value: "Asia/Kolkata" },
]

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

/** Pick the list entry, or add the Group's own value so the Select can show it. */
const withCurrent = (list: { label: string; value: string }[], value: string) => (list.some((x) => x.value === value) ? list : [...list, { label: value, value }])

/**
 * Core settings (Group, Chattiness, which Toolkits are on, Appearance, Danger zone) with each enabled Toolkit's own
 * settings section (children, from the manifests) in between.
 */
export function SettingsScreen({ children }: { children?: ReactNode }) {
  const { group, isAdmin, active } = useGroup()
  const admins = active.filter((m) => m.role === "admin").map((m) => m.name)
  return (
    <>
      <TopBar title="Settings" />
      <PageHeader title="Settings">
        <p className="type-body text-muted-foreground">
          {isAdmin ? "Only Admins can change these. You're an Admin." : `Only Admins can change ${group.name}'s settings. Ask ${admins.join(" or ") || "an Admin"}.`}
        </p>
      </PageHeader>
      <div className="flex flex-col gap-10 px-5 pb-6">
        {isAdmin ? <AdminSettings /> : null}
        <ToolkitsSummary />
        {children}
        <Appearance />
        {isAdmin ? <DangerZone /> : null}
      </div>
    </>
  )
}

/** Which Toolkits are on, and the way to the marketplace (switching happens there). */
function ToolkitsSummary() {
  const { base, nav, moreNav, toolkits, isAdmin } = useGroup()
  const on = Object.values(toolkits).filter(Boolean).length
  const names = [...nav, ...moreNav].map((n) => n.label)
  return (
    <FieldSet>
      <FieldLegend className="type-heading">Toolkits</FieldLegend>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldLabel htmlFor="browse-toolkits">
            {on} on{names.length ? `: ${names.join(", ")}` : ""}
          </FieldLabel>
          <FieldDescription>What Roomie can do in this Group. {isAdmin ? "Add or switch them off in the marketplace." : "Admins switch them on and off."}</FieldDescription>
        </FieldContent>
        <Button id="browse-toolkits" variant="outline" size="sm" nativeButton={false} render={<Link href={`${base}/toolkits`} />}>
          Browse
        </Button>
      </Field>
    </FieldSet>
  )
}

/** Splitting's settings section (Admins): simplify debts and Splitwise. */
export function SplittingSettingsSection({ splitwise }: { splitwise: SplitwiseView }) {
  const { group } = useGroup()
  const [, start] = useTransition()
  const notice = useSearchParams().get("splitwise")
  useEffect(() => {
    if (notice === "connected") toast.add({ title: "Splitwise connected", description: "Pick a Splitwise group to import or copy to.", type: "success" })
    if (notice === "failed") toast.add({ title: "Splitwise didn't connect", description: "Try Connect again.", type: "error" })
  }, [notice])
  return (
    <>
      <FieldSet>
        <FieldLegend className="type-heading">Splitting</FieldLegend>
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
      </FieldSet>
      <SplitwiseSettings sw={splitwise} />
    </>
  )
}

function AdminSettings() {
  const { group } = useGroup()
  const [name, setName] = useState(group.name)
  const [, start] = useTransition()

  const save = (patch: SettingsPatch, ok: { title: string; description?: string }) =>
    start(async () => {
      const res = await updateSettings(group.id, patch)
      if (!res.ok) return void toast.add({ title: "Couldn't save that", description: res.error, type: "error" })
      toast.add(ok)
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
            <Select items={withCurrent(zones, group.timezone)} value={group.timezone} onValueChange={(v) => v && save({ timezone: v }, { title: "Time zone changed" })}>
              <SelectTrigger id="timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {withCurrent(zones, group.timezone).map((z) => (
                    <SelectItem key={z.value} value={z.value}>
                      {z.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>Reminders and chore days follow this.</FieldDescription>
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
    </>
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
