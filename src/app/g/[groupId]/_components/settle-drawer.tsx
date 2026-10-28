"use client"

import { useState, useTransition } from "react"
import { ChevronRightIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item"
import { toast } from "@/components/ui/toast"
import { Amount, useFormatMoney } from "@/components/app/money-bits"
import { MemberAvatar } from "@/components/app/member-avatar"
import type { PaymentApp } from "@/db/schema"
import { payLink } from "@/lib/pay-links"
import { recordSettlement } from "../actions"
import { useGroup } from "./group-context"
import type { Transfer } from "./types"

const apps: { id: PaymentApp; label: string }[] = [
  { id: "venmo", label: "Venmo" },
  { id: "paypal", label: "PayPal" },
  { id: "cashapp", label: "Cash App" },
]

/**
 * Settle up. With no `transfer`, it lists your rows of the Settle plan first.
 * You owe: pay with their app. You're owed: send them your handle. Either way, record it when the money moves.
 */
export function SettleDrawer({
  open,
  onOpenChange,
  plan,
  transfer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  plan: Transfer[]
  transfer?: Transfer | null
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">
        {open ? <SettleBody plan={plan} transfer={transfer ?? null} onDone={() => onOpenChange(false)} /> : null}
      </DrawerContent>
    </Drawer>
  )
}

function SettleBody({ plan, transfer, onDone }: { plan: Transfer[]; transfer: Transfer | null; onDone: () => void }) {
  const { me, name } = useGroup()
  const mine = plan.filter((t) => t.from === me.id || t.to === me.id)
  const [picked, setPicked] = useState<Transfer | null>(transfer ?? (mine.length === 1 ? mine[0] : null))

  if (!picked) {
    return (
      <>
        <DrawerHeader>
          <DrawerTitle className="type-heading">Settle up</DrawerTitle>
          <DrawerDescription>
            {mine.length ? "Pick who you're settling with." : "You're square with everyone. Nothing to settle."}
          </DrawerDescription>
        </DrawerHeader>
        <ItemGroup className="gap-2 p-4">
          {mine.map((t) => {
            const other = t.from === me.id ? t.to : t.from
            return (
              <Item key={`${t.from}-${t.to}`} variant="muted" render={<button type="button" onClick={() => setPicked(t)} />}>
                <ItemMedia>
                  <MemberAvatar name={name(other)} size="lg" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{name(other)}</ItemTitle>
                  <ItemDescription>
                    {t.to === me.id ? "owes you " : "you owe "}
                    <Amount cents={t.cents} tone={t.to === me.id ? "owed" : "owe"} />
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                </ItemActions>
              </Item>
            )
          })}
        </ItemGroup>
        <DrawerFooter>
          <DrawerClose render={<Button variant="secondary" size="lg" />}>Close</DrawerClose>
        </DrawerFooter>
      </>
    )
  }

  return <SettleOne transfer={picked} onDone={onDone} />
}

function SettleOne({ transfer, onDone }: { transfer: Transfer; onDone: () => void }) {
  const { group, me, members, name, cheer } = useGroup()
  const money = useFormatMoney()
  const [pending, start] = useTransition()
  const youAreOwed = transfer.to === me.id
  const other = youAreOwed ? transfer.from : transfer.to
  const otherName = name(other)
  // You pay into their handles; you ask with your own.
  const handleOwner = members.find((m) => m.id === transfer.to)
  const amount = money(transfer.cents)

  const record = () =>
    start(async () => {
      const res = await recordSettlement(group.id, { fromId: transfer.from, toId: transfer.to, cents: transfer.cents })
      if (!res.ok) {
        toast.add({ title: "Couldn't record that", description: res.error, type: "error" })
        return
      }
      cheer()
      toast.add({ title: "Settlement recorded", description: `${name(transfer.from)} paid ${name(transfer.to) === "You" ? "you" : name(transfer.to)} ${amount}.`, type: "success" })
      onDone()
    })

  return (
    <>
      <DrawerHeader className="items-center gap-2 pt-6 text-center">
        <MemberAvatar name={otherName} size="lg" />
        <DrawerTitle className="type-heading">{youAreOwed ? `${otherName} owes you` : `You owe ${otherName}`}</DrawerTitle>
        <p className={youAreOwed ? "type-display text-owed" : "type-display text-owe"}>{amount}</p>
        <DrawerDescription className="text-center">
          {youAreOwed
            ? `Send ${otherName} your handle, or record it once they've paid.`
            : `Pay ${otherName} with one of their apps, then record it here.`}
        </DrawerDescription>
      </DrawerHeader>
      <div className="flex flex-col gap-2 p-4">
        {apps.map((app) => {
          const handle = handleOwner?.handles[app.id]
          const label = (
            <>
              <span>
                {youAreOwed ? "Ask on" : "Pay with"} {app.label}
              </span>
              <span className="truncate font-normal text-muted-foreground">{handle ?? `No ${app.label} handle`}</span>
            </>
          )
          if (!handle) {
            return (
              <Button key={app.id} variant="outline" size="lg" className="justify-between" disabled>
                {label}
              </Button>
            )
          }
          if (youAreOwed) {
            return (
              <Button
                key={app.id}
                variant="outline"
                size="lg"
                className="justify-between"
                onClick={async () => {
                  const text = `${app.label} me ${amount} at ${handle} for ${group.name}`
                  await navigator.clipboard?.writeText(text).catch(() => {})
                  toast.add({ title: "Copied", description: `"${text}". Paste it to ${otherName}.` })
                }}
              >
                {label}
              </Button>
            )
          }
          return (
            <Button
              key={app.id}
              variant="outline"
              size="lg"
              className="justify-between"
              nativeButton={false}
              render={<a href={payLink(app.id, handle, transfer.cents, group.name)} target="_blank" rel="noreferrer" />}
            >
              {label}
            </Button>
          )
        })}
      </div>
      <DrawerFooter>
        <Button size="lg" onClick={record} disabled={pending}>
          {youAreOwed ? `${otherName} paid me` : `I paid ${otherName}`}
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Not now</DrawerClose>
      </DrawerFooter>
    </>
  )
}
