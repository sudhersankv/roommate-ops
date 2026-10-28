"use client"

import Link from "next/link"
import { Fragment, useEffect, useState, useTransition } from "react"
import { ChevronRightIcon, ShoppingCart } from "lucide-react"

import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Message, MessageAvatar, MessageContent, MessageGroup } from "@/components/ui/message"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/toast"
import { moodForBalance, Roomie } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
import { Doorway } from "@/components/app/doorway"
import { MemberAvatar } from "@/components/app/member-avatar"
import { useFormatMoney } from "@/components/app/money-bits"
import { RoomieAvatar } from "@/components/app/roomie-avatar"
import { markChoreDone } from "../../actions"
import { useGroup } from "../group-context"
import { SettleDrawer } from "../settle-drawer"
import { TopBar } from "../shell"
import type { CartItemView, ChoreView, NarrationView, Transfer } from "../types"

export function HomeScreen({
  you,
  plan,
  chores,
  cart,
  narration,
  nextRecipe,
}: {
  you: number
  plan: Transfer[]
  chores: ChoreView[]
  cart: CartItemView[]
  narration: NarrationView[]
  nextRecipe: { title: string; plannedFor: string } | null
}) {
  const { me, base, cheers } = useGroup()
  const [settleOpen, setSettleOpen] = useState(false)
  const [cheering, cheer] = useCheer()
  const mood = moodForBalance(you, true)

  useEffect(() => {
    if (cheers > 0) cheer()
  }, [cheers, cheer])

  return (
    <>
      <TopBar hero title="Home" />
      <Doorway label={`Roomie in the doorway, ${mood === "happy" ? "happy because you're owed" : mood}`}>
        <Roomie size={124} mood={mood} animated cheer={cheering} decorative />
      </Doorway>

      <section aria-labelledby="balance" className="flex flex-col gap-4 px-5 pt-6 pb-8">
        <BalanceHeading you={you} />
        <p className="type-body text-pretty text-muted-foreground">
          <Breakdown plan={plan} />
        </p>
        {plan.some((t) => t.from === me.id || t.to === me.id) ? (
          <Button size="lg" className="self-start" onClick={() => setSettleOpen(true)}>
            Settle up
          </Button>
        ) : null}
      </section>

      <Today chores={chores} cart={cart} nextRecipe={nextRecipe} />

      <section aria-labelledby="activity-title" className="flex flex-col gap-4 px-4 pt-8">
        <div className="flex items-baseline justify-between px-1">
          <h2 id="activity-title" className="type-heading">
            What Roomie&apos;s been up to
          </h2>
          <Button variant="link" size="xs" nativeButton={false} render={<Link href={`${base}/money?tab=activity`} />}>
            All activity
          </Button>
        </div>
        {narration.length ? (
          <Narration items={narration} />
        ) : (
          <p className="type-body px-1 text-muted-foreground">Nothing yet. Say “roomie hi” in the chat and I&apos;ll get going.</p>
        )}
      </section>

      <SettleDrawer open={settleOpen} onOpenChange={setSettleOpen} plan={plan} />
    </>
  )
}

function BalanceHeading({ you }: { you: number }) {
  const money = useFormatMoney()
  const words = you > 0 ? "You're owed" : you < 0 ? "You owe" : "You're all square"
  return (
    <h1 id="balance" className="flex flex-col gap-1">
      <span className="type-heading text-muted-foreground">{words}</span>
      {you !== 0 ? <span className={you > 0 ? "type-display text-owed" : "type-display text-owe"}>{money(Math.abs(you))}</span> : null}
    </h1>
  )
}

function Breakdown({ plan }: { plan: Transfer[] }) {
  const { me, name } = useGroup()
  const money = useFormatMoney()
  const toYou = plan.filter((t) => t.to === me.id)
  const fromYou = plan.filter((t) => t.from === me.id)
  const parts = [...toYou.map((t) => `${name(t.from)} owes you ${money(t.cents)}`), ...fromYou.map((t) => `you owe ${name(t.to)} ${money(t.cents)}`)]
  if (parts.length === 0) return <>Nobody owes you anything. I&apos;ll speak up when that changes.</>
  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`
  return <>{sentence.charAt(0).toUpperCase() + sentence.slice(1)}.</>
}

function Today({ chores, cart, nextRecipe }: { chores: ChoreView[]; cart: CartItemView[]; nextRecipe: { title: string; plannedFor: string } | null }) {
  const { group, me, base, name, dates, cheer } = useGroup()
  const [pending, start] = useTransition()
  const mineToday = chores.filter((c) => c.turn === me.id && c.due <= dates.today)
  const yourCart = cart.filter((c) => c.addedBy === me.id && !c.shared).length
  const yours = yourCart ? `${yourCart} of them ${yourCart === 1 ? "is" : "are"} just for you.` : "None of them are just for you."
  const recipeHint = nextRecipe ? `${nextRecipe.title} is ${dates.dueLabel(nextRecipe.plannedFor)}.` : null

  const done = (c: ChoreView) =>
    start(async () => {
      const res = await markChoreDone(group.id, c.id)
      if (!res.ok) return void toast.add({ title: "Couldn't mark it done", description: res.error, type: "error" })
      cheer()
      toast.add({ title: `${c.name}: done`, description: `Streak is ${res.data?.streak ?? 1}. Nice.`, type: "success" })
    })

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
                  <MemberAvatar name={me.name} />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{c.name}</ItemTitle>
                  <ItemDescription>
                    Your turn {c.due < dates.today ? `(${dates.dueLabel(c.due)})` : "today"}.
                    {c.lastDone ? ` Last done by ${name(c.lastDone.by) === "You" ? "you" : name(c.lastDone.by)} ${dates.ago(c.lastDone.date)}.` : ""}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <Button size="sm" variant="secondary" disabled={pending} onClick={() => done(c)}>
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
              {cart.length} {cart.length === 1 ? "thing" : "things"} in the Cart
            </ItemTitle>
            <ItemDescription>{recipeHint ? `${recipeHint} ${yours}` : yours}</ItemDescription>
          </ItemContent>
          <ItemActions>
            <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
          </ItemActions>
        </Item>
      </div>
    </section>
  )
}

function Narration({ items }: { items: NarrationView[] }) {
  const { dates } = useGroup()
  const days: { day: string; items: NarrationView[] }[] = []
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
            <MarkerContent>{dates.dayLabel(d.day)}</MarkerContent>
          </Marker>
          <Message align="start">
            <MessageAvatar>
              <RoomieAvatar />
            </MessageAvatar>
            <MessageContent>
              <MessageGroup>
                {d.items.map((n) => (
                  <Bubble key={n.id} variant="secondary" className="max-w-[88%]">
                    {n.href ? <BubbleContent render={<Link href={n.href} />}>{n.text}</BubbleContent> : <BubbleContent>{n.text}</BubbleContent>}
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
