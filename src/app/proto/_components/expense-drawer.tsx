"use client"

import { useState } from "react"
import { cn } from "cn"
import { CheckIcon } from "lucide-react"

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
import { ME, type Category, type Expense } from "../_data"
import { TODAY } from "../_lib/dates"
import { centsToInput, computeShares, formatMoney, parseMoney, type SplitMethod } from "../_lib/money"
import { useStore } from "../_lib/store"
import { categories } from "./money-bits"

const methods: { value: SplitMethod; label: string; hint: string }[] = [
  { value: "equal", label: "Equally", hint: "Everyone ticked pays the same. Odd cents go to the first people in the list." },
  { value: "exact", label: "Exact", hint: "Type each person's amount. They have to add up to the total." },
  { value: "percent", label: "Percent", hint: "Percentages have to add up to 100." },
  { value: "shares", label: "Shares", hint: "2 shares pays twice as much as 1 share." },
]

type Draft = {
  amount: string
  description: string
  multiPayer: boolean
  payer: string
  payerAmounts: Record<string, string>
  method: SplitMethod
  included: string[]
  values: Record<string, string>
  date: string
  category: Category
  note: string
}

function draftFrom(expense: Expense | undefined, memberIds: string[]): Draft {
  if (!expense) {
    return {
      amount: "",
      description: "",
      multiPayer: false,
      payer: ME,
      payerAmounts: {},
      method: "equal",
      included: memberIds,
      values: {},
      date: TODAY,
      category: "groceries",
      note: "",
    }
  }
  const { split } = expense
  const values: Record<string, string> = {}
  for (const [k, v] of Object.entries(split.values ?? {})) values[k] = split.method === "exact" ? centsToInput(v) : String(v)
  return {
    amount: centsToInput(expense.cents),
    description: expense.description,
    multiPayer: expense.payers.length > 1,
    payer: expense.payers[0]?.memberId ?? ME,
    payerAmounts: Object.fromEntries(expense.payers.map((p) => [p.memberId, centsToInput(p.cents)])),
    method: split.method,
    included: split.members,
    values,
    date: expense.date,
    category: expense.category,
    note: expense.note ?? "",
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
  expense?: Expense
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

function ExpenseForm({ expense, onDone, onSaved }: { expense?: Expense; onDone: () => void; onSaved?: (id: string) => void }) {
  const { state, saveExpense } = useStore()
  const people = state.members.filter((m) => m.status === "active")
  const ids = people.map((m) => m.id)
  const [d, setD] = useState<Draft>(() => draftFrom(expense, ids))
  const [tried, setTried] = useState(false)
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const nameOf = (id: string) => (id === ME ? "You" : (people.find((p) => p.id === id)?.name ?? id))

  const total = parseMoney(d.amount)
  const totalOk = total !== null && total > 0

  // Payers: one person, or several whose amounts add up to the total.
  const payerCents = ids.map((id) => ({ memberId: id, cents: parseMoney(d.payerAmounts[id] ?? "") ?? 0 }))
  const payerSum = payerCents.reduce((a, p) => a + p.cents, 0)
  const payersLeft = (total ?? 0) - payerSum
  const payersOk = !d.multiPayer || (totalOk && payersLeft === 0)

  // Split: the same service the chat uses computes the Shares and what's left to assign.
  const splitMembers = d.method === "equal" ? ids.filter((id) => d.included.includes(id)) : ids
  const values: Record<string, number> = {}
  for (const id of ids) {
    const raw = d.values[id] ?? ""
    values[id] = d.method === "exact" ? (parseMoney(raw) ?? 0) : Number(raw) || 0
  }
  const check = computeShares(total ?? 0, { method: d.method, members: splitMembers, values })
  const shareOf = (id: string) => check.shares.find((s) => s.memberId === id)?.cents
  const splitOk = totalOk && check.ok && splitMembers.length > 0

  const descriptionOk = d.description.trim().length > 0
  const valid = totalOk && descriptionOk && payersOk && splitOk

  const save = () => {
    setTried(true)
    if (!valid || total === null) return
    const payers = d.multiPayer ? payerCents.filter((p) => p.cents > 0) : [{ memberId: d.payer, cents: total }]
    const members = d.method === "equal" ? splitMembers : ids.filter((id) => values[id] > 0)
    const id = saveExpense({
      id: expense?.id,
      description: d.description.trim(),
      category: d.category,
      date: d.date,
      note: d.note.trim() || undefined,
      cents: total,
      payers,
      split: { method: d.method, members, values: d.method === "equal" ? undefined : Object.fromEntries(members.map((m) => [m, values[m]])) },
      addedBy: expense?.addedBy ?? ME,
    })
    toast.add({ title: expense ? "Expense updated" : "Expense added", description: `${d.description.trim()}, ${formatMoney(total)}`, type: "success" })
    onSaved?.(id)
    onDone()
  }

  const remainingText = () => {
    if (!totalOk) return "Enter the total first."
    if (check.ok) return null
    if (check.unit === "cents") return check.remaining > 0 ? `${formatMoney(check.remaining)} left to assign` : `${formatMoney(-check.remaining)} too much`
    if (check.unit === "percent") {
      const pct = (Math.abs(check.remaining) / 100).toFixed(2).replace(/\.00$/, "")
      return check.remaining > 0 ? `${pct}% left to assign` : `${pct}% too much`
    }
    return d.method === "equal" ? "Tick at least one person." : "Give at least one person a share."
  }
  const left = remainingText()

  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">{expense ? "Edit expense" : "Add expense"}</DrawerTitle>
        <DrawerDescription>
          Roomie posts it in the group chat so everyone sees the same numbers.
        </DrawerDescription>
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
                <InputGroupText className="type-heading">$</InputGroupText>
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
              placeholder="Groceries, internet, pizza…" autoComplete="off"
              value={d.description}
              aria-invalid={tried && !descriptionOk ? true : undefined}
              onChange={(e) => set({ description: e.target.value })}
            />
            {tried && !descriptionOk ? <FieldDescription>Add a few words so people know what it was.</FieldDescription> : null}
          </Field>

          <FieldSet>
            <FieldLegend variant="label">Paid by</FieldLegend>
            {d.multiPayer ? (
              <div className="flex flex-col gap-2">
                {people.map((p) => (
                  <Field key={p.id} orientation="horizontal">
                    <FieldLabel htmlFor={`pay-${p.id}`} className="flex-1">
                      {nameOf(p.id)}
                    </FieldLabel>
                    <InputGroup className="w-32">
                      <InputGroupAddon>
                        <InputGroupText>$</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        id={`pay-${p.id}`}
                        inputMode="decimal"
                        placeholder="0.00"
                        className="money text-right"
                        value={d.payerAmounts[p.id] ?? ""}
                        onChange={(e) => set({ payerAmounts: { ...d.payerAmounts, [p.id]: e.target.value } })}
                      />
                    </InputGroup>
                  </Field>
                ))}
                <Remaining ok={totalOk && payersLeft === 0} text={!totalOk ? "Enter the total first." : payersLeft > 0 ? `${formatMoney(payersLeft)} still unpaid` : payersLeft < 0 ? `${formatMoney(-payersLeft)} more than the total` : null} />
              </div>
            ) : (
              <Select
                items={people.map((p) => ({ label: nameOf(p.id), value: p.id }))}
                value={d.payer}
                onValueChange={(v) => v && set({ payer: v })}
              >
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
            )}
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="multi-payer">More than one person paid</FieldLabel>
                <FieldDescription>Like two cards at a restaurant.</FieldDescription>
              </FieldContent>
              <Switch
                id="multi-payer"
                checked={d.multiPayer}
                onCheckedChange={(on) =>
                  set({
                    multiPayer: on,
                    payerAmounts: on && totalOk && Object.keys(d.payerAmounts).length === 0 ? { [d.payer]: d.amount } : d.payerAmounts,
                  })
                }
              />
            </Field>
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">Split</FieldLegend>
            <ToggleGroup
              variant="segmented"
              spacing={1}
              value={[d.method]}
              onValueChange={(v) => v[0] && set({ method: v[0] as SplitMethod, values: {} })}
              aria-label="Split method"
            >
              {methods.map((m) => (
                <ToggleGroupItem key={m.value} value={m.value}>
                  {m.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <FieldDescription>{methods.find((m) => m.value === d.method)?.hint}</FieldDescription>

            <div className="flex flex-col divide-y rounded-2xl border">
              {people.map((p) => {
                const share = shareOf(p.id)
                return (
                  <Field key={p.id} orientation="horizontal" className="min-h-14 px-3.5 py-2">
                    {d.method === "equal" ? (
                      <Checkbox
                        id={`inc-${p.id}`}
                        checked={d.included.includes(p.id)}
                        onCheckedChange={(on) =>
                          set({ included: on ? ids.filter((x) => x === p.id || d.included.includes(x)) : d.included.filter((x) => x !== p.id) })
                        }
                      />
                    ) : null}
                    <FieldLabel htmlFor={d.method === "equal" ? `inc-${p.id}` : `val-${p.id}`} className="flex-1">
                      {nameOf(p.id)}
                    </FieldLabel>
                    {d.method !== "equal" ? (
                      <InputGroup className="w-28">
                        {d.method === "exact" ? (
                          <InputGroupAddon>
                            <InputGroupText>$</InputGroupText>
                          </InputGroupAddon>
                        ) : null}
                        <InputGroupInput
                          id={`val-${p.id}`}
                          inputMode={d.method === "exact" || d.method === "percent" ? "decimal" : "numeric"}
                          placeholder={d.method === "shares" ? "1" : "0"}
                          className="money text-right"
                          value={d.values[p.id] ?? ""}
                          onChange={(e) => set({ values: { ...d.values, [p.id]: e.target.value } })}
                        />
                        {d.method === "percent" ? (
                          <InputGroupAddon align="inline-end">
                            <InputGroupText>%</InputGroupText>
                          </InputGroupAddon>
                        ) : d.method === "shares" ? (
                          <InputGroupAddon align="inline-end">
                            <InputGroupText>sh</InputGroupText>
                          </InputGroupAddon>
                        ) : null}
                      </InputGroup>
                    ) : null}
                    {d.method !== "exact" ? (
                      <span className={cn("money w-20 text-right text-sm", share ? "text-foreground" : "text-muted-foreground")}>
                        {share ? formatMoney(share) : "$0.00"}
                      </span>
                    ) : null}
                  </Field>
                )
              })}
            </div>
            <Remaining ok={splitOk} text={left} />
            {state.members.some((m) => m.status === "pending") ? (
              <FieldDescription>Pending members join splits once an Admin approves them.</FieldDescription>
            ) : null}
          </FieldSet>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="date">Date</FieldLabel>
              <Input id="date" type="date" value={d.date} max={TODAY} onChange={(e) => set({ date: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="category">Category</FieldLabel>
              <Select items={categories.map((c) => ({ label: c.label, value: c.value }))} value={d.category} onValueChange={(v) => v && set({ category: v as Category })}>
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
          </div>

          <Field>
            <FieldLabel htmlFor="note">Note</FieldLabel>
            <Textarea id="note" placeholder="Anything the group should know…" value={d.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
        </FieldGroup>
      </form>

      <DrawerFooter className="border-t pt-4">
        <Button type="submit" form="expense-form" size="lg" disabled={tried && !valid}>
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
