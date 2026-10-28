"use client"

import Link from "next/link"
import { Fragment, useState } from "react"
import { ChevronRightIcon, ShoppingCart } from "lucide-react"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Message, MessageAvatar, MessageContent, MessageGroup } from "@/components/ui/message"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/toast"
import { moodForBalance, Roomie } from "@/components/roomie/mascot"
import { ME } from "../../_data"
import { dayLabel, TODAY } from "../../_lib/dates"
import { formatMoney } from "../../_lib/money"
import { useMemberName, useMoney, useStore } from "../../_lib/store"
import { Doorway } from "../doorway"
import { MemberAvatar } from "../member-avatar"
import { RoomieAvatar } from "../roomie-avatar"
import { SettleDrawer } from "../settle-drawer"
import { base, TopBar } from "../shell"

export function HomeScreen() {
  const { state } = useStore()
  const { you, plan } = useMoney()
  const [settleOpen, setSettleOpen] = useState(false)
  const mood = moodForBalance(you, true)

  return (
    <>
      <TopBar hero title="Home" />
      <Doorway label={`Roomie in the doorway, ${mood === "happy" ? "happy because you're owed" : mood}`}>
        <Roomie size={124} mood={mood} animated decorative />
      </Doorway>

      <section aria-labelledby="balance" className="flex flex-col gap-4 px-5 pt-6 pb-8">
        <BalanceHeading you={you} />
        <p className="type-body text-pretty text-muted-foreground">
          <Breakdown plan={plan} />
        </p>
        {plan.some((t) => t.from === ME || t.to === ME) ? (
          <Button size="lg" className="self-start" onClick={() => setSettleOpen(true)}>
            Settle up
          </Button>
        ) : null}
      </section>

      <Today />

      <section aria-labelledby="activity-title" className="flex flex-col gap-4 px-4 pt-8">
        <div className="flex items-baseline justify-between px-1">
          <h2 id="activity-title" className="type-heading">
            What Roomie's been up to
          </h2>
          <Button variant="link" size="xs" nativeButton={false} render={<Link href={`${base}/money?tab=activity`} />}>
            All activity
          </Button>
        </div>
        <Narration items={state.narration.slice(0, 6)} />
      </section>

      <SettleDrawer open={settleOpen} onOpenChange={setSettleOpen} />
    </>
  )
}

function BalanceHeading({ you }: { you: number }) {
  const words = you > 0 ? "You're owed" : you < 0 ? "You owe" : "You're all square"
  return (
    <h1 id="balance" className="flex flex-col gap-1">
      <span className="type-heading text-muted-foreground">{words}</span>
      {you !== 0 ? (
        <span className={you > 0 ? "type-display text-owed" : "type-display text-owe"}>{formatMoney(Math.abs(you))}</span>
      ) : null}
    </h1>
  )
}

function Breakdown({ plan }: { plan: { from: string; to: string; cents: number }[] }) {
  const name = useMemberName()
  const toYou = plan.filter((t) => t.to === ME)
  const fromYou = plan.filter((t) => t.from === ME)
  const parts = [
    ...toYou.map((t) => `${name(t.from)} owes you ${formatMoney(t.cents)}`),
    ...fromYou.map((t) => `you owe ${name(t.to)} ${formatMoney(t.cents)}`),
  ]
  if (parts.length === 0) return <>Nobody owes anybody. I&apos;ll speak up when that changes.</>
  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
  return <>{sentence.charAt(0).toUpperCase() + sentence.slice(1)}.</>
}

function Today() {
  const { state, markChoreDone } = useStore()
  const name = useMemberName()
  const mineToday = state.chores.filter((c) => c.turn === ME && c.due <= TODAY)
  const yourCart = state.cart.filter((c) => c.addedBy === ME).length
  const me = state.members.find((m) => m.id === ME)?.name ?? "You"

  return (
    <section aria-labelledby="today-title" className="flex flex-col gap-3 px-4">
      <h2 id="today-title" className="type-heading px-1">
        Today
      </h2>
      <div className="flex flex-col rounded-3xl bg-card">
        {mineToday.length === 0 ? (
          <Item>
            <ItemContent>
              <ItemTitle>No chores on you today</ItemTitle>
              <ItemDescription>Next one shows up here the day it&apos;s yours.</ItemDescription>
            </ItemContent>
          </Item>
        ) : (
          mineToday.map((c) => (
            <Fragment key={c.id}>
              <Item className="py-3">
                <ItemMedia>
                  <MemberAvatar name={me} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{c.name}</ItemTitle>
                  <ItemDescription>Your turn today. {c.streak}-day streak going.</ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      markChoreDone(c.id)
                      toast.add({ title: `${c.name}: done`, description: `Streak is ${c.streak + 1}. ${name(c.rotation[(c.rotation.indexOf(c.turn) + 1) % c.rotation.length])} is up next.`, type: "success" })
                    }}
                  >
                    Mark done
                  </Button>
                </ItemActions>
              </Item>
              <Separator className="mx-4 data-horizontal:w-auto" />
            </Fragment>
          ))
        )}
        <Item render={<Link href={`${base}/cart`} />} className="py-3">
          <ItemMedia variant="icon" className="size-8 justify-center">
            <ShoppingCart aria-hidden />
          </ItemMedia>
          <ItemContent>
            <ItemTitle>
              {state.cart.length} {state.cart.length === 1 ? "thing" : "things"} in the Cart
            </ItemTitle>
            <ItemDescription>
              {yourCart ? `${yourCart} of them ${yourCart === 1 ? "is" : "are"} yours.` : "None of them are yours."} Tacos are Friday.
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
          </ItemActions>
        </Item>
      </div>
    </section>
  )
}

function Narration({ items }: { items: { id: string; date: string; text: string; href?: string }[] }) {
  const days: { day: string; items: typeof items }[] = []
  for (const n of items) {
    const last = days.at(-1)
    if (last && last.day === n.date) last.items.push(n)
    else days.push({ day: n.date, items: [n] })
  }
  return (
    <div className="flex flex-col gap-4">
      {days.map((d) => (
        <div key={d.day} className="flex flex-col gap-3">
          <Marker variant="separator">
            <MarkerContent>{dayLabel(d.day)}</MarkerContent>
          </Marker>
          <Message align="start">
            <MessageAvatar>
              <RoomieAvatar />
            </MessageAvatar>
            <MessageContent>
              <MessageGroup>
                {d.items.map((n) => (
                  <Bubble key={n.id} variant="secondary" className="max-w-[88%]">
                    {n.href ? (
                      <BubbleContent render={<Link href={n.href} />}>{n.text}</BubbleContent>
                    ) : (
                      <BubbleContent>{n.text}</BubbleContent>
                    )}
                  </Bubble>
                ))}
              </MessageGroup>
            </MessageContent>
          </Message>
        </div>
      ))}
    </div>
  )
}
