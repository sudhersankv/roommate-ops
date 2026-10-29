"use client"

import { useState, useTransition } from "react"
import { XIcon } from "lucide-react"
import { cn } from "cn"

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
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Roomie, type RoomieMood } from "@/components/roomie/mascot"
import {
  ARCHETYPE_IDS,
  ARCHETYPES,
  applyPersonalityPatch,
  effectiveDials,
  MAX_QUIRKS,
  MAX_QUIRK_LENGTH,
  previewOwes,
  usableNicknames,
  validatePersonalityPatch,
  type ArchetypeId,
  type Personality,
  type PersonalityPatch,
} from "@/lib/personality"
import { activeHours, hourLabel } from "@/lib/style-stats"
import { resetLearnedStyle, savePersonality } from "./personality-actions"

/** The dino's pose for each archetype in the picker. */
const POSE: Record<ArchetypeId, RoomieMood> = { chill: "sleepy", hype: "happy", deadpan: "calm", mom: "happy", gremlin: "worried", butler: "calm" }

const HUMOR = ["None", "A little", "Playful", "Funny"]
const FORMALITY = ["Very casual", "Casual", "Neat", "Formal"]

export function PersonalityPanel({ groupId, initial, isAdmin, timezone }: { groupId: string; initial: Personality; isAdmin: boolean; timezone: string }) {
  const [p, setP] = useState(initial)
  const [name, setName] = useState(initial.name)
  const [quirk, setQuirk] = useState("")
  const [pending, start] = useTransition()
  const dials = effectiveDials(p)

  const save = (patch: PersonalityPatch, ok: string) => {
    const before = p
    try {
      setP(applyPersonalityPatch(p, validatePersonalityPatch(patch)))
    } catch {
      /* the server explains */
    }
    start(async () => {
      const res = await savePersonality(groupId, patch)
      if (!res.ok) {
        setP(before)
        setName(before.name)
        return void toast.add({ title: "Couldn't save that", description: res.error, type: "error" })
      }
      setP(res.data)
      toast.add({ title: ok })
    })
  }

  const addQuirk = () => {
    const q = quirk.trim()
    if (!q) return
    setQuirk("")
    save({ quirks: [...p.quirks, q] }, "Quirk added")
  }

  return (
    <FieldSet>
      <FieldLegend className="type-heading">Personality</FieldLegend>
      <FieldDescription>
        {p.name} is your group&apos;s pet. Pick its vibe, its name and a few quirks.
        {isAdmin ? "" : " Only Admins can change it."}
      </FieldDescription>

      <div role="radiogroup" aria-label="Vibe" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {ARCHETYPE_IDS.map((id) => {
          const a = ARCHETYPES[id]
          const on = p.base === id
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={!isAdmin || pending}
              onClick={() => !on && save({ base: id }, `${p.name} is ${a.label.toLowerCase()} now`)}
              className={cn(
                "group/vibe relative flex flex-col items-start gap-1 rounded-3xl bg-card p-3 text-left ring-1 ring-foreground/10 transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default",
                on ? "bg-sprout/30 ring-2 ring-forest dark:bg-forest/40 dark:ring-sprout" : "enabled:hover:bg-muted"
              )}
            >
              <span className="relative">
                <Roomie size={52} mood={POSE[id]} decorative />
                <span aria-hidden className="absolute -top-1 -right-2 text-lg leading-none">
                  {a.accessory}
                </span>
              </span>
              <span className="type-heading text-base">{a.label}</span>
              <span className="text-xs text-muted-foreground">{a.tagline}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-2 rounded-3xl bg-muted/60 p-4" aria-live="polite">
        <span className="text-sm text-muted-foreground">How {p.name} would say &ldquo;Dev owes you $30&rdquo;</span>
        <Bubble variant="secondary" className="max-w-full">
          <BubbleContent data-testid="personality-preview">{previewOwes(p)}</BubbleContent>
        </Bubble>
      </div>

      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="pet-name">Name</FieldLabel>
          <Input
            id="pet-name"
            autoComplete="off"
            maxLength={24}
            disabled={!isAdmin}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const clean = name.trim()
              if (!clean) return setName(p.name)
              if (clean !== p.name) save({ name: clean }, `Call me ${clean}`)
            }}
          />
          <FieldDescription>
            Say &ldquo;roomie&rdquo;{p.name.toLowerCase() !== "roomie" ? ` or “${p.name}”` : ""} in the chat, or @mention it, to call it.
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="pet-quirk">Quirks</FieldLabel>
          {p.quirks.length ? (
            <div className="flex flex-wrap gap-2">
              {p.quirks.map((q) => (
                <Badge key={q} variant="secondary" className="h-7 gap-1 pr-1 text-sm">
                  {q}
                  {isAdmin ? (
                    <button
                      type="button"
                      aria-label={`Remove “${q}”`}
                      disabled={pending}
                      onClick={() => save({ quirks: p.quirks.filter((x) => x !== q) }, "Quirk removed")}
                      className="rounded-full p-0.5 hover:bg-foreground/10"
                    >
                      <XIcon className="size-3.5" aria-hidden />
                    </button>
                  ) : null}
                </Badge>
              ))}
            </div>
          ) : null}
          {isAdmin && p.quirks.length < MAX_QUIRKS ? (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                addQuirk()
              }}
            >
              <Input id="pet-quirk" autoComplete="off" maxLength={MAX_QUIRK_LENGTH} placeholder="always blames the cat" value={quirk} onChange={(e) => setQuirk(e.target.value)} />
              <Button type="submit" variant="secondary" disabled={pending || !quirk.trim()}>
                Add
              </Button>
            </form>
          ) : null}
          <FieldDescription>Up to {MAX_QUIRKS} little traits. They show now and then, not in every message.</FieldDescription>
        </Field>

        <Field>
          <FieldLabel>Emoji</FieldLabel>
          <ToggleGroup variant="segmented" spacing={1} value={[dials.emoji]} disabled={!isAdmin || pending} onValueChange={(v) => v[0] && save({ emoji: v[0] as typeof dials.emoji }, "Saved")} aria-label="Emoji">
            <ToggleGroupItem value="none">None</ToggleGroupItem>
            <ToggleGroupItem value="light">A few</ToggleGroupItem>
            <ToggleGroupItem value="lots">Lots</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>Humor</FieldLabel>
          <ToggleGroup variant="segmented" spacing={1} value={[String(dials.humor)]} disabled={!isAdmin || pending} onValueChange={(v) => v[0] && save({ humor: Number(v[0]) }, "Saved")} aria-label="Humor">
            {HUMOR.map((label, i) => (
              <ToggleGroupItem key={label} value={String(i)}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <Field>
          <FieldLabel>Formality</FieldLabel>
          <ToggleGroup variant="segmented" spacing={1} value={[String(dials.formality)]} disabled={!isAdmin || pending} onValueChange={(v) => v[0] && save({ formality: Number(v[0]) }, "Saved")} aria-label="Formality">
            {FORMALITY.map((label, i) => (
              <ToggleGroupItem key={label} value={String(i)}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>Picking a vibe resets these to its defaults.</FieldDescription>
        </Field>
      </FieldGroup>

      <Learned groupId={groupId} p={p} isAdmin={isAdmin} timezone={timezone} onReset={setP} />
    </FieldSet>
  )
}

function Learned({ groupId, p, isAdmin, timezone, onReset }: { groupId: string; p: Personality; isAdmin: boolean; timezone: string; onReset: (p: Personality) => void }) {
  const l = p.learned
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const nicks = usableNicknames(l)
  const hours = activeHours(l.hours)
  const reset = () =>
    start(async () => {
      const res = await resetLearnedStyle(groupId)
      setOpen(false)
      if (!res.ok) return void toast.add({ title: "Couldn't reset it", description: res.error, type: "error" })
      onReset(res.data)
      toast.add({ title: "Starting fresh", description: `${p.name} keeps your vibe, name and quirks.` })
    })

  return (
    <section aria-labelledby="learned-title" className="flex flex-col gap-3 rounded-3xl bg-card p-4 ring-1 ring-foreground/10">
      <h3 id="learned-title" className="type-heading text-base">
        What {p.name} has picked up
      </h3>
      <Progress value={Math.round(l.confidence * 100)} aria-label="How well it knows the group">
        <span className="text-sm text-muted-foreground">{l.messagesSeen ? `How well it knows you: from ${l.messagesSeen} messages` : "Nothing yet."}</span>
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">{Math.round(l.confidence * 100)}%</span>
      </Progress>
      {l.messagesSeen ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Languages</dt>
          <dd>
            {l.languages.map((x) => `${x.name} ${Math.round(x.share * 100)}%`).join(", ") || "Not sure yet"}
            {l.codeSwitching >= 0.1 ? `, mixed in ${Math.round(l.codeSwitching * 100)}% of messages` : ""}
          </dd>
          <dt className="text-muted-foreground">Slang</dt>
          <dd className="flex flex-wrap gap-1">
            {l.slang.length
              ? l.slang.map((s) => (
                  <Badge key={s.phrase} variant="outline">
                    {s.phrase} <span className="text-muted-foreground tabular-nums">{s.count}</span>
                  </Badge>
                ))
              : "None yet"}
          </dd>
          <dt className="text-muted-foreground">Tone</dt>
          <dd>{l.tone.join(", ") || "Not sure yet"}</dd>
          {nicks.length ? (
            <>
              <dt className="text-muted-foreground">Nicknames</dt>
              <dd>{nicks.map((n) => `${n.member} is “${n.nickname}”`).join(", ")}</dd>
            </>
          ) : null}
          {hours.length ? (
            <>
              <dt className="text-muted-foreground">Busiest</dt>
              <dd>
                {hours.map(hourLabel).join(", ")} <span className="text-muted-foreground">({timezone})</span>
              </dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {isAdmin && l.messagesSeen ? (
        <AlertDialog open={open} onOpenChange={setOpen}>
          <AlertDialogTrigger render={<Button variant="outline" size="sm" className="self-start" />}>Start fresh</AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Clear what {p.name} picked up?</AlertDialogTitle>
              <AlertDialogDescription>The list above starts again from new messages. Your vibe, name and quirks stay.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction variant="destructive" disabled={pending} onClick={reset}>
                Reset
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  )
}
