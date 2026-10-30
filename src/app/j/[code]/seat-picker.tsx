"use client"

import Link from "next/link"
import { useActionState, useState } from "react"
import { TriangleAlertIcon, UserPlusIcon } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel, FieldLegend, FieldSet, FieldTitle } from "@/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Spinner } from "@/components/ui/spinner"
import { MemberAvatar } from "@/components/app/member-avatar"
import { SignedInAs } from "@/components/app/sign-in"
import { Roomie } from "@/components/roomie/mascot"
import { pickSeat, type PickState } from "./actions"

const NOT_LISTED = "none"
// Kept in step with services/joins.ts PENDING_LINE (a client file can't import the service).
const PENDING_LINE = "An Admin needs to approve you; I'll let you know in the chat."

type Props = { code: string; group: { id: string; name: string }; seats: { id: string; label: string }[]; declined: boolean; email: string }

/** "Which one are you?": the open seats as one list of choices, then a button that says who you'll be. */
export function SeatPicker({ code, group, seats, declined, email }: Props) {
  const [state, action, pending] = useActionState<PickState, FormData>(pickSeat, { status: "idle" })
  const [picked, setPicked] = useState<string | null>(null)
  const pickedLabel = picked === NOT_LISTED ? null : seats.find((s) => s.id === picked)?.label

  if (state.status === "pending" || declined) {
    return (
      <Shell group={group.name} email={email} title={declined ? "Not this time" : "Waiting for an Admin"} mood="sleepy">
        <p className="type-body text-pretty text-muted-foreground" aria-live="polite">
          {declined ? "An Admin turned this request down. Ask them in the group chat." : PENDING_LINE}
        </p>
        {state.status === "pending" ? (
          <Button size="lg" variant="secondary" className="w-full" nativeButton={false} render={<Link href={`/g/${state.groupId}`} />}>
            Open {group.name}
          </Button>
        ) : null}
      </Shell>
    )
  }

  return (
    <Shell group={group.name} email={email} title="Which one are you?">
      <form action={action} className="flex flex-col gap-5">
        <input type="hidden" name="code" value={code} />
        <input type="hidden" name="seat" value={picked ?? ""} />
        <FieldSet>
          <FieldLegend className="sr-only">Your name in {group.name}</FieldLegend>
          {seats.length ? null : <FieldDescription>Everyone in the chat is connected already.</FieldDescription>}
          <RadioGroup value={picked} onValueChange={(v) => setPicked(v as string)} aria-label={`Your name in ${group.name}`} className="gap-2">
            {seats.map((s) => (
              <FieldLabel key={s.id} htmlFor={`seat-${s.id}`} className="rounded-2xl bg-card">
                <Field orientation="horizontal" className="gap-3 has-[>[data-slot=field-content]]:items-center">
                  <MemberAvatar name={s.label.replace(/^\+/, "#")} size="lg" />
                  <FieldContent className="min-w-0">
                    <FieldTitle className="type-body truncate font-medium" translate="no">
                      {s.label}
                    </FieldTitle>
                  </FieldContent>
                  <RadioGroupItem value={s.id} id={`seat-${s.id}`} />
                </Field>
              </FieldLabel>
            ))}
            <FieldLabel htmlFor="seat-none" className="rounded-2xl">
              <Field orientation="horizontal" className="gap-3 has-[>[data-slot=field-content]]:items-center">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                  <UserPlusIcon />
                </span>
                <FieldContent>
                  <FieldTitle className="type-body">I&apos;m not on this list</FieldTitle>
                  <FieldDescription>An Admin lets you in.</FieldDescription>
                </FieldContent>
                <RadioGroupItem value={NOT_LISTED} id="seat-none" />
              </Field>
            </FieldLabel>
          </RadioGroup>
        </FieldSet>
        {state.status === "error" ? (
          <Alert variant="destructive" aria-live="polite">
            <TriangleAlertIcon />
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        ) : null}
        <Button type="submit" size="lg" className="w-full" disabled={!picked || pending}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {pending ? "Connecting…" : pickedLabel ? `I'm ${pickedLabel}` : picked === NOT_LISTED ? "Ask to join" : "Pick your name"}
        </Button>
      </form>
    </Shell>
  )
}

function Shell({ group, email, title, mood = "happy", children }: { group: string; email: string; title?: string; mood?: "happy" | "sleepy"; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-8 px-5 pt-[8dvh] pb-8">
      <header className="flex items-end gap-4">
        <Roomie size={72} mood={mood} animated decorative />
        <div className="flex min-w-0 flex-col gap-1 pb-1">
          <p className="type-body truncate text-muted-foreground">{group}</p>
          {title ? <h1 className="type-title text-pretty">{title}</h1> : null}
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-5">{children}</div>
      <SignedInAs email={email} />
    </main>
  )
}
