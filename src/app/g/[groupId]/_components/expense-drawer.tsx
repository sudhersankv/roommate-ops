"use client"

import { useState, useTransition } from "react"
import { cn } from "cn"
import { CheckIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { categories, useFormatMoney } from "@/components/app/money-bits"
import { centsToInput, currencySymbol, parseMoney } from "@/lib/money"
import { splitEvenly } from "@/services/split"
import { addExpense, updateExpense } from "../actions"
import { useGroup } from "./group-context"
import type { ExpenseView } from "./types"

type SplitMethod = "equal" | "exact" | "percent" | "shares"

// Only "Equally" saves today; the other methods, multiple payers, dates, categories and notes arrive in step 5.
const methods: { value: SplitMethod; label: string; hint: string }[] = [
  { value: "equal", label: "Equally", hint: "Everyone ticked pays the same. Odd cents go to the payer first." },
  { value: "exact", label: "Exact", hint: "" },
  { value: "percent", label: "Percent", hint: "" },
  { value: "shares", label: "Shares", hint: "" },
]

type Draft = { amount: string; description: string; payer: string; included: string[] }

function draftFrom(expense: ExpenseView | undefined, me: string, memberIds: string[]): Draft {
  if (!expense) return { amount: "", description: "", payer: me, included: memberIds }
  return {
    amount: centsToInput(expense.cents),
    description: expense.description,
    payer: expense.payers[0]?.memberId ?? me,
    included: memberIds.filter((id) => expense.shares.some((s) => s.memberId === id)),
  }
}

export function ExpenseDrawer({
  open,
  onOpenChange,
  expense,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  expense?: ExpenseView
  onSaved?: (id: string) => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">
        {/* Mounted only while open, so every opening starts from a fresh draft. */}
        {open ? <ExpenseForm expense={expense} onDone={() => onOpenChange(false)} onSaved={onSaved} /> : null}
      </DrawerContent>
    </Drawer>
  )
}

function ExpenseForm({ expense, onDone, onSaved }: { expense?: ExpenseView; onDone: () => void; onSaved?: (id: string) => void }) {
  const { group, me, active: people, members, name, dates } = useGroup()
  const money = useFormatMoney()
  const ids = people.map((m) => m.id)
  const [d, setD] = useState<Draft>(() => draftFrom(expense, me.id, ids))
  const [tried, setTried] = useState(false)
  const [pending, start] = useTransition()
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const nameOf = (id: string) => name(id)

  const total = parseMoney(d.amount)
  const totalOk = total !== null && total > 0
  const splitMembers = ids.filter((id) => d.included.includes(id))
  const shares = totalOk ? splitEvenly(total, splitMembers, d.payer) : []
  const shareOf = (id: string) => shares.find((s) => s.memberId === id)?.cents
  const splitOk = totalOk && splitMembers.length > 0
  const descriptionOk = d.description.trim().length > 0
  const valid = totalOk && descriptionOk && splitOk

  const save = () => {
    setTried(true)
    if (!valid || total === null) return
    const input = { cents: total, description: d.description.trim(), payerId: d.payer, splitAmong: splitMembers }
    start(async () => {
      const res = expense ? await updateExpense(group.id, expense.id, input) : await addExpense(group.id, input)
      if (!res.ok) {
        toast.add({ title: expense ? "Couldn't save the changes" : "Couldn't add it", description: res.error, type: "error" })
        return
      }
      toast.add({ title: expense ? "Expense updated" : "Expense added", description: `${input.description}, ${money(total)}`, type: "success" })
      onSaved?.(res.data ?? "")
      onDone()
    })
  }

  const left = !totalOk ? "Enter the total first." : splitMembers.length === 0 ? "Tick at least one person." : null

  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">{expense ? "Edit expense" : "Add expense"}</DrawerTitle>
        <DrawerDescription>Roomie keeps the group chat and this page on the same numbers.</DrawerDescription>
      </DrawerHeader>

      <form
        id="expense-form"
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <FieldGroup>
          <Field data-invalid={tried && !totalOk ? true : undefined}>
            <FieldLabel htmlFor="amount">Total</FieldLabel>
            <InputGroup className="h-14">
              <InputGroupAddon>
                <InputGroupText className="type-heading">{currencySymbol(group.currency)}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                className="type-title money"
                value={d.amount}
                aria-invalid={tried && !totalOk ? true : undefined}
                onChange={(e) => set({ amount: e.target.value })}
              />
            </InputGroup>
            {tried && !totalOk ? <FieldDescription>Enter an amount like 41.25.</FieldDescription> : null}
          </Field>

          <Field data-invalid={tried && !descriptionOk ? true : undefined}>
            <FieldLabel htmlFor="description">What was it for?</FieldLabel>
            <Input
              id="description"
              placeholder="Groceries, internet, pizza…"
              autoComplete="off"
              value={d.description}
              aria-invalid={tried && !descriptionOk ? true : undefined}
              onChange={(e) => set({ description: e.target.value })}
            />
            {tried && !descriptionOk ? <FieldDescription>Add a few words so people know what it was.</FieldDescription> : null}
          </Field>

          <FieldSet>
            <FieldLegend variant="label">Paid by</FieldLegend>
            <Select items={people.map((p) => ({ label: nameOf(p.id), value: p.id }))} value={d.payer} onValueChange={(v) => v && set({ payer: v })}>
              <SelectTrigger className="w-full" aria-label="Paid by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {people.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {nameOf(p.id)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Field orientation="horizontal" data-disabled>
              <FieldContent>
                <FieldLabel htmlFor="multi-payer">
                  More than one person paid <Badge variant="secondary">Coming soon</Badge>
                </FieldLabel>
                <FieldDescription>Like two cards at a restaurant.</FieldDescription>
              </FieldContent>
              <Switch id="multi-payer" checked={false} disabled />
            </Field>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">Split</FieldLegend>
            <ToggleGroup variant="segmented" spacing={1} value={["equal"]} aria-label="Split method">
              {methods.map((m) => (
                <ToggleGroupItem key={m.value} value={m.value} disabled={m.value !== "equal"}>
                  {m.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>
              {methods[0].hint} Exact amounts, percentages and shares are coming soon.
              {expense?.uneven ? " Saving splits this one equally." : ""}
            </FieldDescription>

            <div className="flex flex-col divide-y rounded-2xl border">
              {people.map((p) => {
                const share = shareOf(p.id)
                return (
                  <Field key={p.id} orientation="horizontal" className="min-h-14 px-3.5 py-2">
                    <Checkbox
                      id={`inc-${p.id}`}
                      checked={d.included.includes(p.id)}
                      onCheckedChange={(on) => set({ included: on ? ids.filter((x) => x === p.id || d.included.includes(x)) : d.included.filter((x) => x !== p.id) })}
                    />
                    <FieldLabel htmlFor={`inc-${p.id}`} className="flex-1">
                      {nameOf(p.id)}
                    </FieldLabel>
                    <span className={cn("money w-20 text-right text-sm", share ? "text-foreground" : "text-muted-foreground")}>{money(share ?? 0)}</span>
                  </Field>
                )
              })}
            </div>
            <Remaining ok={splitOk} text={left} />
            {members.some((m) => m.status === "pending") ? <FieldDescription>Pending members join splits once an Admin approves them.</FieldDescription> : null}
          </FieldSet>

          <div className="grid grid-cols-2 gap-3">
            <Field data-disabled>
              <FieldLabel htmlFor="date">Date</FieldLabel>
              <Input id="date" type="date" value={expense?.date ?? dates.today} disabled readOnly />
            </Field>
            <Field data-disabled>
              <FieldLabel htmlFor="category">Category</FieldLabel>
              <Select items={categories.map((c) => ({ label: c.label, value: c.value }))} value={expense?.category ?? "other"} disabled>
                <SelectTrigger id="category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {categories.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <FieldDescription className="col-span-2">Dates, categories and notes are coming soon. Roomie picks the category for you.</FieldDescription>
          </div>

          <Field data-disabled>
            <FieldLabel htmlFor="note">Note</FieldLabel>
            <Textarea id="note" placeholder="Anything the group should know…" disabled />
          </Field>
        </FieldGroup>
      </form>

      <DrawerFooter className="border-t pt-4">
        <Button type="submit" form="expense-form" size="lg" disabled={pending || (tried && !valid)}>
          {expense ? "Save changes" : "Add expense"}
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </>
  )
}

function Remaining({ ok, text }: { ok: boolean; text: string | null }) {
  return (
    <p aria-live="polite" className={cn("type-caption money flex items-center gap-1.5", ok ? "text-owed" : "text-owe")}>
      {ok ? (
        <>
          <CheckIcon className="size-4" aria-hidden />
          Adds up
        </>
      ) : (
        text
      )}
    </p>
  )
}
