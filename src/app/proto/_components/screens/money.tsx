"use client"

import Link from "next/link"
import { useState } from "react"
import { PlusIcon, ReceiptText } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ME } from "../../_data"
import { dayLabel } from "../../_lib/dates"
import { formatMoney, type Transfer } from "../../_lib/money"
import { useMemberName, useMoney, useStore, type ExpenseView } from "../../_lib/store"
import { ExpenseDrawer } from "../expense-drawer"
import { MemberAvatar } from "../member-avatar"
import { Amount, CategoryIcon } from "../money-bits"
import { RoomieAvatar } from "../roomie-avatar"
import { SettleDrawer } from "../settle-drawer"
import { base, PageHeader, TopBar } from "../shell"

type Tab = "balances" | "expenses" | "activity"

export function MoneyScreen({ initialTab = "balances" }: { initialTab?: Tab }) {
  const { you } = useMoney()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [adding, setAdding] = useState(false)
  // Keep the tab in the URL so it survives reloads and can be linked to.
  const show = (t: Tab) => {
    setTab(t)
    window.history.replaceState(null, "", t === "balances" ? window.location.pathname : `?tab=${t}`)
  }

  return (
    <>
      <TopBar title="Money" />
      <PageHeader title="Money">
        <p className="type-body text-muted-foreground">
          {you > 0 ? (
            <>
              Overall, you&apos;re owed <Amount cents={you} tone="owed" className="font-semibold" />.
            </>
          ) : you < 0 ? (
            <>
              Overall, you owe <Amount cents={-you} tone="owe" className="font-semibold" />.
            </>
          ) : (
            "You're all square with everyone."
          )}
        </p>
      </PageHeader>

      <div className="px-4 pb-4">
        <ToggleGroup variant="segmented" spacing={1} value={[tab]} onValueChange={(v) => v[0] && show(v[0] as Tab)} aria-label="Show">
          <ToggleGroupItem value="balances">Balances</ToggleGroupItem>
          <ToggleGroupItem value="expenses">Expenses</ToggleGroupItem>
          <ToggleGroupItem value="activity">Activity</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {tab === "balances" ? <Balances /> : tab === "expenses" ? <Expenses onAdd={() => setAdding(true)} /> : <Activity />}

      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 mx-auto flex max-w-md justify-end px-4">
        <Button size="lg" className="pointer-events-auto shadow-lg" onClick={() => setAdding(true)}>
          <PlusIcon data-icon="inline-start" />
          Add expense
        </Button>
      </div>
      <ExpenseDrawer open={adding} onOpenChange={setAdding} onSaved={() => show("expenses")} />
    </>
  )
}

function Balances() {
  const { balances, plan, active } = useMoney()
  const name = useMemberName()
  const [settling, setSettling] = useState<Transfer | null>(null)
  const others = active.filter((m) => m.id !== ME)

  return (
    <div className="flex flex-col gap-8 px-4">
      <section aria-labelledby="with-you" className="flex flex-col gap-2">
        <h2 id="with-you" className="type-heading px-1">
          Your balances
        </h2>
        <ItemGroup className="gap-0 rounded-3xl bg-card py-1">
          {others.map((m) => {
            const t = plan.find((x) => (x.from === m.id && x.to === ME) || (x.from === ME && x.to === m.id))
            return (
              <Item key={m.id} className="py-3">
                <ItemMedia>
                  <MemberAvatar name={m.name} size="lg" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{m.name}</ItemTitle>
                  <ItemDescription>
                    {t ? (
                      <Badge variant={t.to === ME ? "owed" : "owe"}>
                        {t.to === ME ? "owes you " : "you owe "}
                        {formatMoney(t.cents)}
                      </Badge>
                    ) : (
                      "You two are square"
                    )}
                  </ItemDescription>
                </ItemContent>
                {t ? (
                  <ItemActions>
                    <Button size="sm" variant="secondary" onClick={() => setSettling(t)}>
                      Settle
                    </Button>
                  </ItemActions>
                ) : null}
              </Item>
            )
          })}
        </ItemGroup>
      </section>

      <section aria-labelledby="plan" className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5 px-1">
          <h2 id="plan" className="type-heading">
            Settle plan
          </h2>
          <p className="type-caption text-muted-foreground">The fewest payments that get everyone to zero.</p>
        </div>
        {plan.length === 0 ? (
          <Empty className="rounded-3xl bg-card">
            <EmptyHeader>
              <EmptyTitle>Everyone&apos;s square</EmptyTitle>
              <EmptyDescription>New expenses show up here as soon as they&apos;re logged.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ol className="flex flex-col gap-2">
            {plan.map((t) => (
              <li key={`${t.from}-${t.to}`} className="flex items-center gap-3 rounded-2xl border px-4 py-3">
                <span className="type-body flex-1">
                  <span className="font-semibold">{name(t.from)}</span> {t.from === ME ? "pay" : "pays"}{" "}
                  <span className="font-semibold">{name(t.to) === "You" ? "you" : name(t.to)}</span>
                </span>
                <Amount cents={t.cents} className="type-heading" />
              </li>
            ))}
          </ol>
        )}
        <p className="type-caption px-1 text-muted-foreground">
          Group balances: {active.map((m) => `${name(m.id)} ${formatMoney(balances[m.id] ?? 0, "USD", { sign: true })}`).join(", ")}.
        </p>
      </section>

      <SettleDrawer open={settling !== null} onOpenChange={(o) => !o && setSettling(null)} transfer={settling} />
    </div>
  )
}

function Expenses({ onAdd }: { onAdd: () => void }) {
  const { expenses } = useMoney()
  if (expenses.length === 0) {
    return (
      <Empty className="mx-4 rounded-3xl bg-card">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ReceiptText />
          </EmptyMedia>
          <EmptyTitle>No expenses yet</EmptyTitle>
          <EmptyDescription>Add one here, or tell Roomie in the chat: “roomie I paid $40 for groceries”.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onAdd}>Add expense</Button>
        </EmptyContent>
      </Empty>
    )
  }
  const days: { day: string; items: ExpenseView[] }[] = []
  for (const e of expenses) {
    const last = days.at(-1)
    if (last && last.day === e.date) last.items.push(e)
    else days.push({ day: e.date, items: [e] })
  }
  return (
    <div className="flex flex-col gap-5 px-4">
      {days.map((d) => (
        <section key={d.day} className="flex flex-col gap-1" aria-label={dayLabel(d.day)}>
          <Marker variant="separator" className="py-1">
            <MarkerContent>{dayLabel(d.day)}</MarkerContent>
          </Marker>
          <ItemGroup className="gap-1">
            {d.items.map((e) => (
              <ExpenseRow key={e.id} expense={e} />
            ))}
          </ItemGroup>
        </section>
      ))}
    </div>
  )
}

function ExpenseRow({ expense: e }: { expense: ExpenseView }) {
  const name = useMemberName()
  const payers = e.payers.map((p) => name(p.memberId))
  const paidBy = payers.length > 1 ? `${payers.slice(0, -1).join(", ")} and ${payers.at(-1)} paid` : `${payers[0]} paid`
  const inIt = e.shares.some((s) => s.memberId === ME)
  return (
    <Item render={<Link href={`${base}/money/${e.id}`} />} className="px-2 py-2.5">
      <ItemMedia>
        <CategoryIcon category={e.category} />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="truncate">{e.description}</ItemTitle>
        <ItemDescription>
          {paidBy} <Amount cents={e.cents} />
        </ItemDescription>
      </ItemContent>
      <ItemActions className="flex-col items-end gap-0.5">
        {inIt ? (
          <>
            <span className="type-caption text-muted-foreground">your share</span>
            <Amount cents={e.yourShare} className="type-heading" />
          </>
        ) : (
          <span className="type-caption text-muted-foreground">not in this one</span>
        )}
      </ItemActions>
    </Item>
  )
}

function Activity() {
  const { state } = useStore()
  const name = useMemberName()
  const days: { day: string; items: typeof state.activity }[] = []
  for (const a of state.activity) {
    const last = days.at(-1)
    if (last && last.day === a.date) last.items.push(a)
    else days.push({ day: a.date, items: [a] })
  }
  return (
    <div className="flex flex-col gap-5 px-4">
      {days.map((d) => (
        <section key={d.day} className="flex flex-col gap-1" aria-label={dayLabel(d.day)}>
          <Marker variant="separator" className="py-1">
            <MarkerContent>{dayLabel(d.day)}</MarkerContent>
          </Marker>
          <ItemGroup className="gap-0">
            {d.items.map((a) => {
              const who = a.actor === "roomie" ? "Roomie" : name(a.actor)
              const body = (
                <>
                  <ItemMedia>
                    {a.actor === "roomie" ? <RoomieAvatar size={32} /> : <MemberAvatar name={who === "You" ? "Maya" : who} />}
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle className="line-clamp-2 font-normal">
                      <span>
                        <span className="font-semibold">{who}</span> {a.text}
                      </span>
                    </ItemTitle>
                  </ItemContent>
                </>
              )
              return a.href ? (
                <Item key={a.id} render={<Link href={a.href} />} className="px-2 py-2">
                  {body}
                </Item>
              ) : (
                <Item key={a.id} className="px-2 py-2">
                  {body}
                </Item>
              )
            })}
          </ItemGroup>
        </section>
      ))}
    </div>
  )
}
