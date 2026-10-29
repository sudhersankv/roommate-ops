"use client"

import { useActionState } from "react"
import { TriangleAlertIcon } from "lucide-react"
import { cn } from "cn"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { Roomie } from "@/components/roomie/mascot"
import { BETA_GROUP_SIZES, GROUP_PURPOSES, type BetaGroupSize, type GroupPurpose } from "@/db/enums"
import { requestBeta, type BetaFormState } from "./actions"

const SIZES: Record<BetaGroupSize, string> = { "2": "2 people", "3-4": "3 or 4", "5-8": "5 to 8", "9-15": "9 to 15", "16+": "16 or more" }
const PURPOSES: Record<GroupPurpose, string> = { roommates: "Roommates", trip: "A trip", friends: "Friends", family: "Family", work: "Work", other: "Something else" }

/** The WhatsApp beta request (services/beta.ts). Keeps what you typed when something needs fixing. */
export function BetaForm() {
  const [state, action, pending] = useActionState<BetaFormState, FormData>(requestBeta, { status: "idle" })

  if (state.status === "ok") {
    return (
      <div role="status" className="flex flex-col items-center gap-4 rounded-3xl bg-card px-6 py-10 text-center">
        <Roomie mood="happy" size={88} animated cheer />
        <p className="type-title m-0 max-w-[20ch] text-pretty">Got it. You&apos;ll hear from us within a day or two.</p>
        <p className="type-body m-0 max-w-[36ch] text-muted-foreground">We&apos;ll write to the email you gave us with how to get Roomie into your WhatsApp group.</p>
      </div>
    )
  }

  const values = state.status === "error" ? state.values : {}
  const errors = state.status === "error" ? (state.errors ?? {}) : {}
  const invalid = (k: keyof typeof errors) => (errors[k] ? true : undefined)
  // Remount on each answer so the fields come back with what was sent (React resets a form after its action runs).
  const key = state.status === "error" ? JSON.stringify(values) : "idle"

  return (
    <form key={key} action={action} className="relative flex flex-col gap-6 rounded-3xl bg-card p-5 sm:p-7">
      {state.status === "error" && state.message && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>That didn&apos;t go through</AlertTitle>
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      <FieldGroup>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={invalid("name")}>
            <FieldLabel htmlFor="beta-name">Your name</FieldLabel>
            <Input id="beta-name" name="name" autoComplete="name" required maxLength={80} defaultValue={values.name} aria-invalid={invalid("name")} />
            <FieldError>{errors.name}</FieldError>
          </Field>
          <Field data-invalid={invalid("email")}>
            <FieldLabel htmlFor="beta-email">Email</FieldLabel>
            <Input id="beta-email" name="email" type="email" autoComplete="email" inputMode="email" required maxLength={200} defaultValue={values.email} aria-invalid={invalid("email")} />
            <FieldError>{errors.email}</FieldError>
          </Field>
        </div>

        <FieldSet data-invalid={invalid("purpose")}>
          <FieldLegend variant="label">What&apos;s the group?</FieldLegend>
          <div className="flex flex-wrap gap-2">
            {GROUP_PURPOSES.map((p) => (
              <label key={p} className="relative">
                <input type="radio" name="purpose" value={p} required defaultChecked={values.purpose === p} className="peer absolute inset-0 opacity-0" />
                <span
                  className={cn(
                    "flex h-11 cursor-pointer items-center rounded-full border border-input px-4 text-[0.9375rem] font-medium transition-colors select-none",
                    "hover:bg-muted peer-checked:border-transparent peer-checked:bg-primary peer-checked:text-primary-foreground",
                    "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50",
                  )}
                >
                  {PURPOSES[p]}
                </span>
              </label>
            ))}
          </div>
          <FieldError>{errors.purpose}</FieldError>
        </FieldSet>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field data-invalid={invalid("groupSize")}>
            <FieldLabel htmlFor="beta-size">How many people?</FieldLabel>
            <Select name="groupSize" required defaultValue={values.groupSize ?? null} items={BETA_GROUP_SIZES.map((s) => ({ value: s, label: SIZES[s] }))}>
              <SelectTrigger id="beta-size" className="w-full" aria-invalid={invalid("groupSize")}>
                <SelectValue placeholder="Pick one" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {BETA_GROUP_SIZES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SIZES[s]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldError>{errors.groupSize}</FieldError>
          </Field>
          <Field data-invalid={invalid("phone")}>
            <FieldLabel htmlFor="beta-phone">
              WhatsApp number <span className="font-normal text-muted-foreground">(optional)</span>
            </FieldLabel>
            <Input id="beta-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="+1 555 123 4567" maxLength={32} defaultValue={values.phone} aria-invalid={invalid("phone")} />
            <FieldError>{errors.phone}</FieldError>
          </Field>
        </div>
        <FieldDescription className="-mt-2">With your number, we can add Roomie to your group for you. Without it, we&apos;ll send you Roomie&apos;s number so you can add it yourself.</FieldDescription>

        <Field data-invalid={invalid("notes")}>
          <FieldLabel htmlFor="beta-notes">
            Anything we should know? <span className="font-normal text-muted-foreground">(optional)</span>
          </FieldLabel>
          <Textarea id="beta-notes" name="notes" rows={3} maxLength={1000} placeholder="We split rent four ways and nobody remembers whose turn the trash is." defaultValue={values.notes} aria-invalid={invalid("notes")} />
          <FieldError>{errors.notes}</FieldError>
        </Field>
      </FieldGroup>

      {/* Honeypot: hidden from people and screen readers; bots that fill it get a quiet fake success. */}
      <div aria-hidden className="absolute -left-[10000px] size-px overflow-hidden">
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Button type="submit" size="lg" disabled={pending} className="sm:min-w-48">
          {pending && <Spinner data-icon="inline-start" />}
          {pending ? "Sending" : "Join the beta"}
        </Button>
        <p className="type-caption m-0 text-muted-foreground">We only use this to set you up. No newsletter.</p>
      </div>
    </form>
  )
}
