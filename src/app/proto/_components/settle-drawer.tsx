"use client"

import { useState } from "react"
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
import { ME, type PayApp } from "../_data"
import { formatMoney, type Transfer } from "../_lib/money"
import { useMemberName, useMoney, useStore } from "../_lib/store"
import { Amount } from "./money-bits"
import { MemberAvatar } from "./member-avatar"

const apps: { id: PayApp; label: string }[] = [
  { id: "venmo", label: "Venmo" },
  { id: "paypal", label: "PayPal" },
  { id: "cashapp", label: "Cash App" },
]

/**
 * Settle up. With no `transfer`, it lists your rows of the Settle plan first.
 * You owe: pay with their app. You're owed: request with yours. Either way, record it when the money moves.
 */
export function SettleDrawer({
  open,
  onOpenChange,
  transfer,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  transfer?: Transfer | null
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">
        {open ? <SettleBody transfer={transfer ?? null} onDone={() => onOpenChange(false)} /> : null}
      </DrawerContent>
    </Drawer>
  )
}

function SettleBody({ transfer, onDone }: { transfer: Transfer | null; onDone: () => void }) {
  const { plan } = useMoney()
  const mine = plan.filter((t) => t.from === ME || t.to === ME)
  const [picked, setPicked] = useState<Transfer | null>(transfer ?? (mine.length === 1 ? mine[0] : null))
  const name = useMemberName()

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
            const other = t.from === ME ? t.to : t.from
            return (
              <Item key={`${t.from}-${t.to}`} variant="muted" render={<button type="button" onClick={() => setPicked(t)} />}>
                <ItemMedia>
                  <MemberAvatar name={name(other)} size="lg" />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{name(other)}</ItemTitle>
                  <ItemDescription>
                    {t.to === ME ? "owes you " : "you owe "}
                    <Amount cents={t.cents} tone={t.to === ME ? "owed" : "owe"} />
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
  const { state, recordSettlement } = useStore()
  const name = useMemberName()
  const youAreOwed = transfer.to === ME
  const other = youAreOwed ? transfer.from : transfer.to
  const otherName = name(other)
  // You pay into their handles; you request into your own.
  const handleOwner = state.members.find((m) => m.id === transfer.to)
  const amount = formatMoney(transfer.cents)

  return (
    <>
      <DrawerHeader className="items-center gap-2 pt-6 text-center">
        <MemberAvatar name={otherName} size="lg" />
        <DrawerTitle className="type-heading">
          {youAreOwed ? `${otherName} owes you` : `You owe ${otherName}`}
        </DrawerTitle>
        <p className={youAreOwed ? "type-display text-owed" : "type-display text-owe"}>{amount}</p>
        <DrawerDescription className="text-center">
          {youAreOwed
            ? `Send ${otherName} a request with your handle, or record it once they've paid.`
            : `Pay ${otherName} with one of their apps, then record it here.`}
        </DrawerDescription>
      </DrawerHeader>
      <div className="flex flex-col gap-2 p-4">
        {apps.map((app) => {
          const handle = handleOwner?.handles[app.id]
          return (
            <Button
              key={app.id}
              variant="outline"
              size="lg"
              className="justify-between"
              disabled={!handle}
              onClick={() =>
                toast.add({
                  title: `Opens ${app.label}`,
                  description: `${youAreOwed ? "Request" : "Pay"} ${amount} ${youAreOwed ? "from" : "to"} ${handle}, with "Apt 4B" as the note.`,
                })
              }
            >
              <span>
                {youAreOwed ? "Request on" : "Pay with"} {app.label}
              </span>
              <span className="truncate font-normal text-muted-foreground">
                {handle ?? `No ${app.label} handle`}
              </span>
            </Button>
          )
        })}
      </div>
      <DrawerFooter>
        <Button
          size="lg"
          onClick={() => {
            recordSettlement(transfer, "cash")
            toast.add({ title: "Settlement recorded", description: `${name(transfer.from)} paid ${name(transfer.to) === "You" ? "you" : name(transfer.to)} ${amount}.`, type: "success" })
            onDone()
          }}
        >
          {youAreOwed ? `${otherName} paid me` : `I paid ${otherName}`}
        </Button>
        <DrawerClose render={<Button variant="ghost" size="lg" />}>Not now</DrawerClose>
      </DrawerFooter>
    </>
  )
}
