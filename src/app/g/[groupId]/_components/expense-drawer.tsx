"use client"

import { useRef, useState, useTransition } from "react"
import { cn } from "cn"
import { CameraIcon, CheckIcon, RepeatIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { categories, categoryOf, useFormatMoney, type Category } from "@/components/app/money-bits"
import type { Recurrence, SplitMethod } from "@/db/enums"
import { centsToInput, currencySymbol, parseMoney } from "@/lib/money"
import { guessCategory } from "@/services/categories"
import { checkPayers, computeShares, PERCENT_TOLERANCE, SplitError, splitEvenly, type SplitIntent, type SplitRow } from "@/services/split"
import { addExpense, updateExpense, type ExpenseForm } from "../actions"
import { useGroup } from "./group-context"
import type { ExpenseView, ReceiptDraft } from "./types"

const methods: { value: SplitMethod; label: string; hint: string }[] = [
  { value: "equal", label: "Equally", hint: "Everyone ticked pays the same. Odd cents go to the payer first." },
  { value: "exact", label: "Exact", hint: "Type what each person owes. It has to add up to the total." },
  { value: "percent", label: "Percent", hint: "Percentages have to add up to 100. Leftover cents go to the biggest remainders." },
  { value: "shares", label: "Shares", hint: "Like 2:2:1. Each person pays their shares out of the total." },
]

type Repeat = Recurrence | "none"
type PerMember = Record<string, string>

type Draft = {
  amount: string
  description: string
  method: SplitMethod
  included: string[]
  exact: PerMember
  percent: PerMember
  shares: PerMember
  multiPayer: boolean
  payer: string
  paid: PerMember
  category: Category
  categoryTouched: boolean
  date: string
  note: string
  repeat: Repeat
  receiptUrl: string | null
}

const num = (s: string | undefined) => {
  const t = (s ?? "").trim()
  if (!t) return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

function draftFrom(expense: ExpenseView | undefined, me: string, memberIds: string[], today: string): Draft {
  const blank: Draft = {
    amount: "",
    description: "",
    method: "equal",
    included: memberIds,
    exact: {},
    percent: {},
    shares: Object.fromEntries(memberIds.map((id) => [id, "1"])),
    multiPayer: false,
    payer: me,
    paid: {},
    category: "other",
    categoryTouched: false,
    date: today,
    note: "",
    repeat: "none",
    receiptUrl: null,
  }
  if (!expense) return blank
  const weights = Object.fromEntries(expense.shares.map((s) => [s.memberId, s.weight == null ? "" : String(s.weight)]))
  return {
    ...blank,
    amount: centsToInput(expense.cents),
    description: expense.description,
    method: expense.method,
    included: expense.method === "equal" ? memberIds.filter((id) => expense.shares.some((s) => s.memberId === id)) : memberIds,
    exact: expense.method === "exact" ? Object.fromEntries(expense.shares.map((s) => [s.memberId, centsToInput(s.cents)])) : {},
    percent: expense.method === "percent" ? weights : {},
    shares: expense.method === "shares" ? weights : blank.shares,
    multiPayer: expense.payers.length > 1,
    payer: expense.payers[0]?.memberId ?? me,
    paid: Object.fromEntries(expense.payers.map((p) => [p.memberId, centsToInput(p.cents)])),
    category: expense.category,
    categoryTouched: true,
    date: expense.date,
    note: expense.note ?? "",
    repeat: expense.recurring ?? "none",
    receiptUrl: expense.receiptUrl,
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

/** The Shares this draft would save, worked out with the same split.ts the service uses. */
function preview(d: Draft, total: number | null, ids: string[], realName: (id: string) => string, payerIds: string[], currency: string) {
  if (total === null || total <= 0) return { rows: [] as SplitRow[], ok: false, text: "Enter the total first." }
  const tie = { payerIds, nameOf: realName, currency }
  let intent: SplitIntent
  if (d.method === "equal") {
    const among = ids.filter((id) => d.included.includes(id))
    if (!among.length) return { rows: [], ok: false, text: "Tick at least one person." }
    return { rows: splitEvenly(total, among, payerIds[0]), ok: true, text: null }
  }
  if (d.method === "exact") {
    const rows = ids.map((id) => ({ memberId: id, cents: d.exact[id]?.trim() ? parseMoney(d.exact[id]) : 0 }))
    if (rows.some((r) => r.cents === null)) return { rows: [], ok: false, text: "One of the amounts isn't a number." }
    const sum = rows.reduce((s, r) => s + (r.cents ?? 0), 0)
    const left = total - sum
    return {
      rows: rows.filter((r) => (r.cents ?? 0) > 0) as SplitRow[],
      ok: left === 0 && sum > 0,
      remaining: left,
      text: left > 0 ? "left to assign" : left < 0 ? "over the total" : null,
    }
  }
  if (d.method === "percent") {
    const rows = ids.map((id) => ({ memberId: id, percent: num(d.percent[id]) }))
    if (rows.some((r) => Number.isNaN(r.percent))) return { rows: [], ok: false, text: "One of the percentages isn't a number." }
    const sum = rows.reduce((s, r) => s + r.percent, 0)
    const left = Math.round((100 - sum) * 100) / 100
    if (Math.abs(left) > PERCENT_TOLERANCE) return { rows: [], ok: false, text: left > 0 ? `${left}% left to assign` : `${-left}% over 100%` }
    intent = { method: "percent", percents: rows }
  } else {
    const rows = ids.map((id) => ({ memberId: id, shares: num(d.shares[id]) }))
    if (rows.some((r) => Number.isNaN(r.shares) || r.shares < 0)) return { rows: [], ok: false, text: "One of the shares isn't a number." }
    if (!rows.some((r) => r.shares > 0)) return { rows: [], ok: false, text: "Give somebody at least one share." }
    intent = { method: "shares", shares: rows }
  }
  try {
    return { rows: computeShares(total, intent, tie).rows, ok: true, text: null }
  } catch (e) {
    return { rows: [], ok: false, text: e instanceof SplitError ? e.message : "That split doesn't work." }
  }
}

function ExpenseForm({ expense, onDone, onSaved }: { expense?: ExpenseView; onDone: () => void; onSaved?: (id: string) => void }) {
  const { group, me, active: people, members, name, dates } = useGroup()
  const money = useFormatMoney()
  const ids = people.map((m) => m.id)
  const realName = (id: string) => members.find((m) => m.id === id)?.name ?? id
  const [d, setD] = useState<Draft>(() => draftFrom(expense, me.id, ids, dates.today))
  const [tried, setTried] = useState(false)
  const [pending, start] = useTransition()
  const [scanning, setScanning] = useState(false)
  const [scanned, setScanned] = useState<ReceiptDraft | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))
  const setIn = (key: "exact" | "percent" | "shares" | "paid", id: string, v: string) => setD((x) => ({ ...x, [key]: { ...x[key], [id]: v } }))

  const total = parseMoney(d.amount)
  const totalOk = total !== null && total > 0
  const descriptionOk = d.description.trim().length > 0

  // Payers: one person for the whole amount, or several amounts that cover it.
  const payerRows = d.multiPayer ? ids.map((id) => ({ memberId: id, cents: d.paid[id]?.trim() ? parseMoney(d.paid[id]) : 0 })) : [{ memberId: d.payer, cents: total ?? 0 }]
  const paidSum = payerRows.reduce((s, p) => s + (p.cents ?? 0), 0)
  const payersOk = totalOk && payerRows.every((p) => p.cents !== null) && paidSum === total
  const payerIds = payersOk ? checkPayers(total!, payerRows as SplitRow[]).map((p) => p.memberId) : [d.payer]

  const split = preview(d, total, ids, realName, payerIds, group.currency)
  const shareOf = (id: string) => split.rows.find((s) => s.memberId === id)?.cents
  const valid = totalOk && descriptionOk && split.ok && payersOk

  const save = () => {
    setTried(true)
    if (!valid || total === null) return
    const form: ExpenseForm = {
      cents: total,
      description: d.description.trim(),
      method: d.method,
      splitAmong: ids.filter((id) => d.included.includes(id)),
      splits: split.rows,
      percents: ids.map((id) => ({ memberId: id, percent: num(d.percent[id]) })).filter((r) => r.percent > 0),
      shares: ids.map((id) => ({ memberId: id, shares: num(d.shares[id]) })).filter((r) => r.shares > 0),
      payers: (payerRows as SplitRow[]).filter((p) => p.cents > 0),
      category: d.category,
      note: d.note.trim() || null,
      occurredOn: d.date,
      recurring: d.repeat === "none" ? null : d.repeat,
      receiptUrl: d.receiptUrl,
    }
    start(async () => {
      const res = expense ? await updateExpense(group.id, expense.id, form) : await addExpense(group.id, form)
      if (!res.ok) {
        toast.add({ title: expense ? "Couldn't save the changes" : "Couldn't add it", description: res.error, type: "error" })
        return
      }
      toast.add({ title: expense ? "Expense updated" : "Expense added", description: `${form.description}, ${money(total)}`, type: "success" })
      onSaved?.(res.data ?? "")
      onDone()
    })
  }

  const scan = async (file: File) => {
    setScanning(true)
    try {
      const body = new FormData()
      body.set("groupId", group.id)
      body.set("file", file)
      const res = await fetch("/api/receipts", { method: "POST", body })
      const data = (await res.json()) as ReceiptDraft & { error?: string }
      if (!res.ok) return void toast.add({ title: "Couldn't read that receipt", description: data.error, type: "error" })
      setScanned(data)
      const guess = guessCategory(data.merchant)
      set({
        amount: centsToInput(data.totalCents),
        description: data.merchant,
        date: data.date && data.date <= dates.today ? data.date : d.date,
        note: data.items.map((i) => `${i.name} ${money(i.cents)}`).join(", "),
        receiptUrl: data.receiptUrl,
        ...(d.categoryTouched ? {} : { category: guess === "other" ? "food" : guess }),
      })
    } finally {
      setScanning(false)
    }
  }

  const remaining = (() => {
    if (!totalOk) return { ok: false, text: "Enter the total first." }
    if (d.method === "exact" && "remaining" in split && typeof split.remaining === "number" && split.remaining !== 0)
      return { ok: false, text: `${money(Math.abs(split.remaining))} ${split.text}` }
    return { ok: split.ok, text: split.text }
  })()

  const unit = d.method === "percent" ? "%" : d.method === "shares" ? "shares" : null

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
          {!expense ? (
            <Field>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-label="Receipt photo"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void scan(f)
                  e.target.value = ""
                }}
              />
              <Button type="button" variant="tint" size="lg" disabled={scanning} onClick={() => fileRef.current?.click()}>
                {scanning ? <Spinner data-icon="inline-start" /> : <CameraIcon data-icon="inline-start" />}
                {scanning ? "Reading the receipt…" : "Scan receipt"}
              </Button>
              {scanned ? (
                <FieldDescription>
                  Read {scanned.items.length} items{scanned.taxCents ? `, tax ${money(scanned.taxCents)}` : ""}
                  {scanned.tipCents ? `, tip ${money(scanned.tipCents)}` : ""}. Who had what goes under Split (Exact), or ask Roomie in the chat.
                </FieldDescription>
              ) : null}
              {scanned?.mismatch && scanned.printedTotalCents !== null ? (
                <Alert>
                  <AlertTitle>Check the total</AlertTitle>
                  <AlertDescription>
                    The receipt says {money(scanned.printedTotalCents)}, but its items, tax and tip add up to {money(scanned.totalCents)}. We used the sum; change it if the receipt is right.
                  </AlertDescription>
                </Alert>
              ) : null}
            </Field>
          ) : null}

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
              onChange={(e) => set({ description: e.target.value, ...(d.categoryTouched ? {} : { category: guessCategory(e.target.value) }) })}
            />
            {tried && !descriptionOk ? <FieldDescription>Add a few words so people know what it was.</FieldDescription> : null}
          </Field>

          <FieldSet>
            <FieldLegend variant="label">Paid by</FieldLegend>
            {!d.multiPayer ? (
              <Select items={people.map((p) => ({ label: name(p.id), value: p.id }))} value={d.payer} onValueChange={(v) => v && set({ payer: v })}>
                <SelectTrigger className="w-full" aria-label="Paid by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {people.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {name(p.id)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            ) : (
              <div className="flex flex-col divide-y rounded-2xl border">
                {people.map((p) => (
                  <Field key={p.id} orientation="horizontal" className="min-h-14 px-3.5 py-2">
                    <FieldLabel htmlFor={`paid-${p.id}`} className="flex-1">
                      {name(p.id)}
                    </FieldLabel>
                    <InputGroup className="w-32">
                      <InputGroupAddon>
                        <InputGroupText>{currencySymbol(group.currency)}</InputGroupText>
                      </InputGroupAddon>
                      <InputGroupInput
                        id={`paid-${p.id}`}
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder="0.00"
                        className="money text-right"
                        value={d.paid[p.id] ?? ""}
                        onChange={(e) => setIn("paid", p.id, e.target.value)}
                      />
                    </InputGroup>
                  </Field>
                ))}
              </div>
            )}
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="multi-payer">More than one person paid</FieldLabel>
                <FieldDescription>Like two cards at a restaurant.</FieldDescription>
              </FieldContent>
              <Switch
                id="multi-payer"
                checked={d.multiPayer}
                onCheckedChange={(on) => set({ multiPayer: on, paid: on && total ? { [d.payer]: centsToInput(total), ...d.paid } : d.paid })}
              />
            </Field>
            {d.multiPayer ? (
              <Remaining
                ok={payersOk}
                text={!totalOk ? "Enter the total first." : paidSum < (total ?? 0) ? `${money((total ?? 0) - paidSum)} still to cover` : paidSum > (total ?? 0) ? `${money(paidSum - (total ?? 0))} more than the total` : "One of the amounts isn't a number."}
                okText="Payments cover the total"
              />
            ) : null}
          </FieldSet>

          <FieldSet>
            <FieldLegend variant="label">Split</FieldLegend>
            <ToggleGroup variant="segmented" spacing={1} value={[d.method]} onValueChange={(v) => v[0] && set({ method: v[0] as SplitMethod })} aria-label="Split method">
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
                        onCheckedChange={(on) => set({ included: on ? ids.filter((x) => x === p.id || d.included.includes(x)) : d.included.filter((x) => x !== p.id) })}
                      />
                    ) : null}
                    <FieldLabel htmlFor={d.method === "equal" ? `inc-${p.id}` : `w-${p.id}`} className="flex-1">
                      {name(p.id)}
                    </FieldLabel>
                    {d.method === "exact" ? (
                      <InputGroup className="w-32">
                        <InputGroupAddon>
                          <InputGroupText>{currencySymbol(group.currency)}</InputGroupText>
                        </InputGroupAddon>
                        <InputGroupInput id={`w-${p.id}`} inputMode="decimal" autoComplete="off" placeholder="0.00" className="money text-right" value={d.exact[p.id] ?? ""} onChange={(e) => setIn("exact", p.id, e.target.value)} />
                      </InputGroup>
                    ) : unit ? (
                      <InputGroup className="w-28">
                        <InputGroupInput
                          id={`w-${p.id}`}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="0"
                          className="money text-right"
                          value={(d.method === "percent" ? d.percent : d.shares)[p.id] ?? ""}
                          onChange={(e) => setIn(d.method === "percent" ? "percent" : "shares", p.id, e.target.value)}
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupText>{unit}</InputGroupText>
                        </InputGroupAddon>
                      </InputGroup>
                    ) : null}
                    {d.method !== "exact" ? <span className={cn("money w-20 text-right text-sm", share ? "text-foreground" : "text-muted-foreground")}>{money(share ?? 0)}</span> : null}
                  </Field>
                )
              })}
            </div>
            <Remaining ok={remaining.ok} text={remaining.text} />
            {members.some((m) => m.status === "pending") ? <FieldDescription>Pending members join splits once an Admin approves them.</FieldDescription> : null}
          </FieldSet>

          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="date">Date</FieldLabel>
              <Input id="date" type="date" value={d.date} max={dates.today} onChange={(e) => e.target.value && set({ date: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="category">Category</FieldLabel>
              <Select items={categories.map((c) => ({ label: c.label, value: c.value }))} value={d.category} onValueChange={(v) => v && set({ category: v as Category, categoryTouched: true })}>
                <SelectTrigger id="category" className="w-full">
                  <SelectValue>
                    {(v: Category) => {
                      const c = categoryOf(v)
                      return (
                        <span className="flex items-center gap-2">
                          <c.icon aria-hidden />
                          {c.label}
                        </span>
                      )
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {categories.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        <c.icon aria-hidden />
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <FieldSet>
            <FieldLegend variant="label">Repeats</FieldLegend>
            <ToggleGroup variant="segmented" spacing={1} value={[d.repeat]} onValueChange={(v) => v[0] && set({ repeat: v[0] as Repeat })} aria-label="Repeats">
              <ToggleGroupItem value="none">Never</ToggleGroupItem>
              <ToggleGroupItem value="weekly">Weekly</ToggleGroupItem>
              <ToggleGroupItem value="monthly">Monthly</ToggleGroupItem>
            </ToggleGroup>
            {d.repeat !== "none" ? (
              <FieldDescription className="flex items-center gap-1.5">
                <RepeatIcon aria-hidden className="size-4" />
                Repeats {d.repeat}: Roomie adds it again {d.repeat === "monthly" ? `on the ${ordinal(Math.min(Number(d.date.slice(8, 10)), 28))} of each month` : "every week on the same day"}, split the same way.
              </FieldDescription>
            ) : null}
          </FieldSet>

          <Field>
            <FieldLabel htmlFor="note">Note</FieldLabel>
            <Textarea id="note" placeholder="Anything the group should know…" value={d.note} onChange={(e) => set({ note: e.target.value })} />
          </Field>
          {d.receiptUrl ? (
            <Field>
              <FieldLabel>Receipt</FieldLabel>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={d.receiptUrl} alt="Receipt photo" className="max-h-48 w-fit rounded-2xl border object-contain" />
            </Field>
          ) : null}
        </FieldGroup>
      </form>

      <DrawerFooter className="border-t pt-4">
        <Button type="submit" form="expense-form" size="lg" disabled={pending || (tried && !valid)}>
          {pending ? <Spinner data-icon="inline-start" /> : null}
          {expense ? "Save changes" : "Add expense"}
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Cancel</DrawerClose>
      </DrawerFooter>
    </>
  )
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`

function Remaining({ ok, text, okText = "Adds up" }: { ok: boolean; text: string | null; okText?: string }) {
  return (
    <p aria-live="polite" className={cn("type-caption money flex items-center gap-1.5", ok ? "text-owed" : "text-owe")}>
      {ok ? (
        <>
          <CheckIcon className="size-4" aria-hidden />
          {okText}
        </>
      ) : (
        text
      )}
    </p>
  )
}
