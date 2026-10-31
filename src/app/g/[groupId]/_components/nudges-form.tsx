"use client"

// The Nudges card's form (nudges-card.tsx): the Settle nudge on or off, the amount worth a private DM and how often.
import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/toast"
import { useFormatMoney } from "@/components/app/money-bits"
import { centsToInput, currencySymbol, parseMoney } from "@/lib/money"
import { updateNudges } from "../actions"
import { useGroup } from "./group-context"
import type { NudgeSettingsView } from "./types"

export function NudgesForm({ initial }: { initial: NudgeSettingsView }) {
  const { group } = useGroup()
  const money = useFormatMoney()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [amount, setAmount] = useState(centsToInput(initial.thresholdCents))
  const [days, setDays] = useState(String(initial.everyDays))
  const [pending, start] = useTransition()
  const cents = parseMoney(amount)
  const changed = cents !== initial.thresholdCents || Number(days) !== initial.everyDays

  const save = (patch: Partial<NudgeSettingsView>, title: string) =>
    start(async () => {
      const res = await updateNudges(group.id, patch)
      if (!res.ok) return void toast.add({ title: "Couldn't save that", description: res.error, type: "error" })
      toast.add({ title })
    })

  return (
    <FieldSet>
      <FieldLegend className="type-heading">Nudges</FieldLegend>
      <FieldDescription>Roomie privately reminds anyone who owes someone more than the amount below, a few hours after it’s logged and then every few days until it’s paid (5 times at most). The group only hears how many balances are open.</FieldDescription>
      <FieldGroup>
        <Field orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor="settle-nudge">Settle nudge</FieldLabel>
            <FieldDescription>Anyone can still say “roomie, stop nudging me”.</FieldDescription>
          </FieldContent>
          <Switch
            id="settle-nudge"
            checked={enabled}
            disabled={pending}
            onCheckedChange={(on) => {
              setEnabled(on)
              save({ enabled: on }, on ? "Settle nudge on" : "Settle nudge off")
            }}
          />
        </Field>
        {enabled ? (
          <>
            <Field>
              <FieldLabel htmlFor="nudge-amount">When someone owes more than</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>{currencySymbol(group.currency)}</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput id="nudge-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="nudge-days">Remind every (days)</FieldLabel>
              <Input id="nudge-days" type="number" min={1} max={14} value={days} onChange={(e) => setDays(e.target.value)} />
            </Field>
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={pending || !changed || cents === null}
              onClick={() => save({ thresholdCents: cents ?? initial.thresholdCents, everyDays: Number(days) }, `Nudging over ${money(cents ?? 0)}, every ${days === "1" ? "day" : `${days} days`}`)}
            >
              Save
            </Button>
          </>
        ) : null}
      </FieldGroup>
    </FieldSet>
  )
}
