"use client"

import { useState } from "react"

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
import { toolkits } from "../../_data"
import { useStore } from "../../_lib/store"
import { PageHeader, TopBar } from "../shell"
import { useThemePreference, type ThemePreference } from "../theme"

const currencies = [
  { label: "US dollar (USD)", value: "USD" },
  { label: "Euro (EUR)", value: "EUR" },
  { label: "British pound (GBP)", value: "GBP" },
  { label: "Indian rupee (INR)", value: "INR" },
]

const zones = [
  { label: "Central (Chicago)", value: "America/Chicago" },
  { label: "Eastern (New York)", value: "America/New_York" },
  { label: "Mountain (Denver)", value: "America/Denver" },
  { label: "Pacific (Los Angeles)", value: "America/Los_Angeles" },
]

const chattiness = {
  quiet: "Speaks when someone says “roomie”, mentions it, or replies to it.",
  normal: "Also chimes in when it's clearly useful, like a bill someone forgot to log.",
  chatty: "Jumps in more often with reminders, nudges and the odd joke.",
} as const

export function SettingsScreen() {
  const { state, setGroup, setToolkit, resetGroupData } = useStore()
  const [name, setName] = useState(state.group.name)
  const [theme, setTheme] = useThemePreference()
  const [confirming, setConfirming] = useState(false)

  return (
    <>
      <TopBar title="Settings" />
      <PageHeader title="Settings">
        <p className="type-body text-muted-foreground">Only Admins can change these. You&apos;re an Admin.</p>
      </PageHeader>

      <div className="flex flex-col gap-10 px-5 pb-6">
        <FieldSet>
          <FieldLegend className="type-heading">Group</FieldLegend>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="group-name">Name</FieldLabel>
              <Input
                id="group-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => {
                  const clean = name.trim()
                  if (!clean) return setName(state.group.name)
                  if (clean !== state.group.name) {
                    setGroup({ name: clean })
                    toast.add({ title: "Group renamed", description: `It's ${clean} now. The WhatsApp chat keeps its own name.` })
                  }
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="currency">Currency</FieldLabel>
              <Select items={currencies} value={state.group.currency} onValueChange={(v) => v && setGroup({ currency: v })}>
                <SelectTrigger id="currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {currencies.map((c) => (
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
              <Select items={zones} value={state.group.timeZone} onValueChange={(v) => v && setGroup({ timeZone: v })}>
                <SelectTrigger id="timezone" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {zones.map((z) => (
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
            value={[state.group.chattiness]}
            onValueChange={(v) => v[0] && setGroup({ chattiness: v[0] as keyof typeof chattiness })}
            aria-label="Chattiness"
          >
            <ToggleGroupItem value="quiet">Quiet</ToggleGroupItem>
            <ToggleGroupItem value="normal">Normal</ToggleGroupItem>
            <ToggleGroupItem value="chatty">Chatty</ToggleGroupItem>
          </ToggleGroup>
          <p className="type-body text-muted-foreground" aria-live="polite">
            {chattiness[state.group.chattiness]}
          </p>
        </FieldSet>

        <FieldSet>
          <FieldLegend className="type-heading">Toolkits</FieldLegend>
          <FieldDescription>What Roomie can do in this Group. Switching one off hides its page and its tools.</FieldDescription>
          <FieldGroup className="gap-4">
            {toolkits.map((t) => {
              const soon = t.status === "soon"
              return (
                <Field key={t.id} orientation="horizontal" data-disabled={soon || undefined}>
                  <FieldContent>
                    <FieldLabel htmlFor={`tk-${t.id}`}>
                      {t.name}
                      {soon ? <Badge variant="secondary">Coming soon</Badge> : null}
                    </FieldLabel>
                    <FieldDescription>{t.description}</FieldDescription>
                  </FieldContent>
                  <Switch
                    id={`tk-${t.id}`}
                    disabled={soon}
                    checked={!soon && (state.toolkits[t.id] ?? false)}
                    onCheckedChange={(on) => {
                      setToolkit(t.id, on)
                      toast.add({ title: `${t.name} ${on ? "on" : "off"}`, description: on ? "Roomie can use it in the chat now." : "Roomie stops using it. Nothing is deleted." })
                    }}
                  />
                </Field>
              )
            })}
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

        <FieldSet>
          <FieldLegend className="type-heading">Appearance</FieldLegend>
          <ToggleGroup
            variant="segmented"
            spacing={1}
            value={[theme]}
            onValueChange={(v) => v[0] && setTheme(v[0] as ThemePreference)}
            aria-label="Theme"
          >
            <ToggleGroupItem value="system">System</ToggleGroupItem>
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>System follows your phone.</FieldDescription>
        </FieldSet>

        <FieldSeparator />

        <FieldSet>
          <FieldLegend className="type-heading">Danger zone</FieldLegend>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="delete-data">Delete group data</FieldLabel>
              <FieldDescription>Removes every expense, Cart item, chore and chat line Roomie kept for Apt 4B. Roomie stays in the chat.</FieldDescription>
            </FieldContent>
          </Field>
          <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogTrigger render={<Button id="delete-data" variant="destructive" size="lg" className="self-start" />}>
              Delete group data
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete everything for {state.group.name}?</AlertDialogTitle>
                <AlertDialogDescription>
                  Balances, expenses, the Cart, chores and 30 days of chat history go for good. This can&apos;t be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Keep it</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    resetGroupData()
                    setConfirming(false)
                    toast.add({ title: "Group data deleted", description: "Roomie told the chat. It starts fresh from the next message." })
                  }}
                >
                  Delete everything
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </FieldSet>
      </div>
    </>
  )
}
