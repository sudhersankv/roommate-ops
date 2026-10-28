"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"

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
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useThemePreference, type ThemePreference } from "@/components/app/theme"
import type { ToolkitId } from "@/toolkits/types"
import type { SettingsPatch } from "@/services/groups"
import { deleteGroupData, setToolkit, updateSettings } from "../../actions"
import { useGroup } from "../group-context"
import { PageHeader, TopBar } from "../shell"

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

export function SettingsScreen() {
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
        <Appearance />
        {isAdmin ? <DangerZone /> : null}
      </div>
    </>
  )
}

function AdminSettings() {
  const { group, toolkits: on } = useGroup()
  const [name, setName] = useState(group.name)
  const [, start] = useTransition()

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
          <Field orientation="horizontal" data-disabled>
            <FieldContent>
              <FieldLabel htmlFor="simplify">
                Simplify debts <Badge variant="secondary">Coming soon</Badge>
              </FieldLabel>
              <FieldDescription>Settle with the fewest payments, even between people who didn&apos;t share an expense. Always on for now.</FieldDescription>
            </FieldContent>
            <Switch id="simplify" checked disabled />
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

      <FieldSet>
        <FieldLegend className="type-heading">Splitwise</FieldLegend>
        <Field orientation="horizontal" data-disabled>
          <FieldContent>
            <FieldLabel htmlFor="splitwise">Connect Splitwise</FieldLabel>
            <FieldDescription>Bring in your old Splitwise group, or keep one in sync. Coming soon.</FieldDescription>
          </FieldContent>
          <Button id="splitwise" variant="outline" size="sm" disabled>
            Connect
          </Button>
        </Field>
      </FieldSet>
    </>
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
