"use client"

// Money's Rent card (#25): the rent, when it's due, who pays the landlord and each share; an empty state that offers
// setup. The Payer or an Admin edits it in a drawer (evenly or an amount per person, as typed); the service computes
// and checks every cent (services/rent.ts).
import { useState, useTransition } from "react"
import { HouseIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/components/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { MemberAvatar } from "@/components/app/member-avatar"
import { Amount, useFormatMoney } from "@/components/app/money-bits"
import { centsToInput, currencySymbol, parseMoney } from "@/lib/money"
import { saveRent } from "../actions"
import { useGroup } from "../_components/group-context"
import type { RentCardView } from "../_components/types"

const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`

export function RentCard({ view }: { view: RentCardView }) {
  const { name, dates } = useGroup()
  const [editing, setEditing] = useState(false)
  const rent = view.rent

  return (
    <section aria-labelledby="rent" className="flex flex-col gap-2">
      <div className="flex items-end justify-between gap-2 px-1">
        <h2 id="rent" className="type-heading">
          Rent
        </h2>
        {rent && view.canEdit ? (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        ) : null}
      </div>
      {rent ? (
        <div className="flex flex-col gap-1 rounded-3xl bg-card py-1">
          <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
            <span className="type-body text-muted-foreground">
              Due the {ordinal(rent.dueDay)} · next {dates.dayLabel(rent.nextDue)} · {name(rent.payerId)} {name(rent.payerId) === "You" ? "pay" : "pays"} the landlord
            </span>
            <Amount cents={rent.cents} className="type-heading" />
          </div>
          <ItemGroup className="gap-0">
            {rent.shares.map((s) => (
              <Item key={s.memberId} className="py-2">
                <ItemMedia>
                  <MemberAvatar name={name(s.memberId)} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="font-normal">{name(s.memberId)}</ItemTitle>
                </ItemContent>
                <ItemActions>
                  <Amount cents={s.cents} />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
          <p className="type-caption px-4 pb-3 text-muted-foreground">Three days before, Roomie tells the group and sends each person their own share privately.</p>
        </div>
      ) : (
        <Empty className="rounded-3xl bg-card">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HouseIcon />
            </EmptyMedia>
            <EmptyTitle>No rent yet</EmptyTitle>
            <EmptyDescription>Set it up once and Roomie reminds everyone of their share before it&apos;s due. Or say “roomie, rent is 2400 on the 1st, I pay it”.</EmptyDescription>
          </EmptyHeader>
          {view.canEdit ? (
            <EmptyContent>
              <Button onClick={() => setEditing(true)}>Set up rent</Button>
            </EmptyContent>
          ) : null}
        </Empty>
      )}
      <RentDrawer key={editing ? "open" : "closed"} open={editing} onOpenChange={setEditing} view={view} />
    </section>
  )
}

function RentDrawer({ open, onOpenChange, view }: { open: boolean; onOpenChange: (open: boolean) => void; view: RentCardView }) {
  const { group, me, active, name } = useGroup()
  const money = useFormatMoney()
  const rent = view.rent
  const [amount, setAmount] = useState(rent ? centsToInput(rent.cents) : "")
  const [dueDay, setDueDay] = useState(String(rent?.dueDay ?? 1))
  const [payerId, setPayerId] = useState(rent?.payerId ?? me.id)
  const [method, setMethod] = useState<"equal" | "exact">(rent?.method === "equal" || !rent ? "equal" : "exact")
  const [each, setEach] = useState<Record<string, string>>(() =>
    Object.fromEntries(active.map((m) => [m.id, centsToInput(rent?.shares.find((s) => s.memberId === m.id)?.cents ?? 0)])),
  )
  const [pending, start] = useTransition()
  const cents = parseMoney(amount)
  const typed = active.map((m) => ({ memberId: m.id, cents: parseMoney(each[m.id] ?? "") ?? 0 })).filter((r) => r.cents > 0)
  const left = cents === null ? null : cents - typed.reduce((t, r) => t + r.cents, 0)

  const save = () =>
    start(async () => {
      if (!cents) return void toast.add({ title: "How much is the rent?", type: "error" })
      const res = await saveRent(group.id, { cents, dueDay: Number(dueDay), payerId, method, ...(method === "exact" ? { splits: typed } : {}) })
      if (!res.ok) return void toast.add({ title: "Couldn't save the rent", description: res.error, type: "error" })
      toast.add({ title: rent ? "Rent updated" : "Rent set up", description: `${money(cents)} due the ${ordinal(Math.min(Number(dueDay), 28))}.`, type: "success" })
      onOpenChange(false)
    })

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>{rent ? "Edit rent" : "Set up rent"}</DrawerTitle>
          <DrawerDescription>A monthly expense like any other. A change starts with the next month that isn&apos;t charged yet.</DrawerDescription>
        </DrawerHeader>
        <FieldGroup className="px-4">
          <Field>
            <FieldLabel htmlFor="rent-amount">Amount</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>{currencySymbol(group.currency)}</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput id="rent-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2400.00" />
            </InputGroup>
          </Field>
          <Field>
            <FieldLabel htmlFor="rent-day">Due on day</FieldLabel>
            <Input id="rent-day" type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
            <FieldDescription>Past the 28th counts as the 28th, so February has one too.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>Who pays the landlord</FieldLabel>
            <Select items={active.map((m) => ({ label: name(m.id), value: m.id }))} value={payerId} onValueChange={(v) => v && setPayerId(v)}>
              <SelectTrigger className="w-full" aria-label="Who pays the landlord">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {active.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {name(m.id)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Split</FieldLabel>
            <ToggleGroup variant="segmented" spacing={1} value={[method]} onValueChange={(v) => v[0] && setMethod(v[0] as "equal" | "exact")} aria-label="Split">
              <ToggleGroupItem value="equal">Evenly</ToggleGroupItem>
              <ToggleGroupItem value="exact">Amount each</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          {method === "exact" ? (
            <Field>
              {active.map((m) => (
                <InputGroup key={m.id}>
                  <InputGroupAddon>
                    <InputGroupText className="w-16 truncate">{name(m.id)}</InputGroupText>
                  </InputGroupAddon>
                  <InputGroupInput inputMode="decimal" aria-label={`${m.name}'s share`} value={each[m.id] ?? ""} onChange={(e) => setEach({ ...each, [m.id]: e.target.value })} />
                </InputGroup>
              ))}
              <FieldDescription aria-live="polite">{left === null ? "" : left === 0 ? "Adds up." : left > 0 ? `${money(left)} left to give out.` : `${money(-left)} over.`}</FieldDescription>
            </Field>
          ) : null}
        </FieldGroup>
        <DrawerFooter>
          <Button onClick={save} disabled={pending || !cents || (method === "exact" && left !== 0)}>
            {rent ? "Save" : "Set up rent"}
          </Button>
          <DrawerClose render={<Button variant="ghost" />}>Cancel</DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
