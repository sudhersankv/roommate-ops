"use client"

import Link from "next/link"
import { Fragment, useEffect, useState, useTransition, type ReactNode } from "react"
import { BellIcon, ChevronRightIcon, FileTextIcon, ShoppingCart, WrenchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Separator } from "@/components/ui/separator"
import { toast } from "@/components/ui/toast"
import { Roomie, type RoomieMood } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
import { Doorway } from "@/components/app/doorway"
import { MemberAvatar } from "@/components/app/member-avatar"
import { useFormatMoney } from "@/components/app/money-bits"
import { RoomieAvatar } from "@/components/app/roomie-avatar"
import { markChoreDone } from "../../actions"
import { useGroup } from "../group-context"
import { SettleDrawer } from "../settle-drawer"
import { TopBar } from "../shell"
import type { ActivityView, CartItemView, ChoreView, RecentDocumentView, ReminderView, TodayRowView, Transfer, UpkeepView } from "../types"

/**
 * Home: Roomie in the doorway with the Group's mood, the Today strip (the morning Bundle on a page), Recent documents
 * (when there are any), then each enabled Toolkit's Home section (children, in home order, from their manifests),
 * core's Reminders coming up, then Recent (the newest Activity).
 */
export function HomeScreen({
  mood,
  moodReason,
  recent,
  today,
  documents,
  children,
}: {
  mood: RoomieMood
  /** Why (services/personality.ts groupMood); without one the mood came from a Toolkit (your own Balance). */
  moodReason?: string | null
  recent: ActivityView[]
  today: TodayRowView[]
  documents: RecentDocumentView[]
  children: ReactNode
}) {
  const { group, cheers } = useGroup()
  const [cheering, cheer] = useCheer()
  const moodWords = moodReason ? `${mood === "worried" ? "a little worried" : mood}: ${moodReason}` : mood === "happy" ? "happy because you're owed" : mood

  useEffect(() => {
    if (cheers > 0) cheer()
  }, [cheers, cheer])

  return (
    <>
      <TopBar hero title="Home" />
      <Doorway label={`Roomie in the doorway, ${moodWords}`}>
        <Roomie size={124} mood={mood} animated cheer={cheering} decorative />
      </Doorway>
      <h1 className="sr-only">{group.name}</h1>

      <div className="flex flex-col gap-8 pt-6">
        <TodayStrip rows={today} />
        <RecentDocuments docs={documents} />
        {children}
        <RecentCard rows={recent} />
      </div>
    </>
  )
}

/** Splitting's Home section: your Balance, who's in it, and Settle up. */
export function BalanceSection({ you, plan }: { you: number; plan: Transfer[] }) {
  const { me } = useGroup()
  const [settleOpen, setSettleOpen] = useState(false)
  return (
    <section aria-labelledby="balance" className="flex flex-col gap-4 px-5">
      <BalanceHeading you={you} />
      <p className="type-body text-pretty text-muted-foreground">
        <Breakdown plan={plan} />
      </p>
      {plan.some((t) => t.from === me.id || t.to === me.id) ? (
        <Button size="lg" className="self-start" onClick={() => setSettleOpen(true)}>
          Settle up
        </Button>
      ) : null}
      <SettleDrawer open={settleOpen} onOpenChange={setSettleOpen} plan={plan} />
    </section>
  )
}

function BalanceHeading({ you }: { you: number }) {
  const money = useFormatMoney()
  const words = you > 0 ? "You're owed" : you < 0 ? "You owe" : "You're all square"
  return (
    <h2 id="balance" className="flex flex-col gap-1">
      <span className="type-heading text-muted-foreground">{words}</span>
      {you !== 0 ? <span className={you > 0 ? "type-display text-owed" : "type-display text-owe"}>{money(Math.abs(you))}</span> : null}
    </h2>
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

function HomeCard({ id, title, action, children }: { id: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 px-4">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 id={id} className="type-heading">
          {title}
        </h2>
        {action}
      </div>
      <div className="flex flex-col rounded-3xl bg-card">{children}</div>
    </section>
  )
}

/**
 * The Today strip: the same lines the morning post is made of (each learned Trick's, in post order, with its accent
 * dot) plus your Reminders due today. One quiet line when nothing is due.
 */
export function TodayStrip({ rows }: { rows: TodayRowView[] }) {
  return (
    <HomeCard id="today-title" title="Today">
      {rows.length === 0 ? (
        <p className="type-body px-4 py-3.5 text-muted-foreground">Nothing due today.</p>
      ) : (
        rows.map((r, i) => (
          <Fragment key={r.id}>
            {i > 0 ? <Separator className="mx-4 data-horizontal:w-auto" /> : null}
            <Item render={r.href ? <Link href={r.href} /> : undefined} className="py-3">
              <ItemMedia className="size-8 justify-center">
                {r.accent ? (
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: r.accent }} aria-hidden />
                ) : (
                  <BellIcon className="size-4 text-muted-foreground" aria-hidden />
                )}
              </ItemMedia>
              <ItemContent>
                <ItemTitle className="font-normal text-pretty">{r.text}</ItemTitle>
              </ItemContent>
              {r.href ? (
                <ItemActions>
                  <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                </ItemActions>
              ) : null}
            </Item>
          </Fragment>
        ))
      )}
    </HomeCard>
  )
}

/**
 * The Recent documents strip: the Group's newest Documents (the lease first in practice), one tap each. Nothing at all
 * for a Group without Documents; fed `[]` until core's Documents land.
 */
export function RecentDocuments({ docs }: { docs: RecentDocumentView[] }) {
  const { dates } = useGroup()
  if (docs.length === 0) return null
  return (
    <HomeCard id="docs-title" title="Recent documents">
      {docs.slice(0, 3).map((d, i) => (
        <Fragment key={d.id}>
          {i > 0 ? <Separator className="mx-4 data-horizontal:w-auto" /> : null}
          <Item render={<Link href={d.href} />} className="py-3">
            <ItemMedia variant="icon" className="size-8 justify-center">
              <FileTextIcon aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{d.title}</ItemTitle>
              <ItemDescription>
                {d.kind.charAt(0).toUpperCase() + d.kind.slice(1)}, {dates.dayLabel(d.createdAt)}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
            </ItemActions>
          </Item>
        </Fragment>
      ))}
    </HomeCard>
  )
}

/** House's Home section: your chores due today, with Mark done (nothing when none are on you; Today says so). */
export function ChoresToday({ chores }: { chores: ChoreView[] }) {
  const { group, me, name, dates, cheer } = useGroup()
  const [pending, start] = useTransition()
  const mineToday = chores.filter((c) => c.turn === me.id && c.due <= dates.today)

  const done = (c: ChoreView) =>
    start(async () => {
      const res = await markChoreDone(group.id, c.id)
      if (!res.ok) return void toast.add({ title: "Couldn't mark it done", description: res.error, type: "error" })
      cheer()
      const streak = res.data?.streak ?? 1
      toast.add({ title: `${c.name}: done`, description: streak > 1 ? `That's ${streak} on time in a row.` : "Logged. The chart is happy.", type: "success" })
    })

  if (mineToday.length === 0) return null
  return (
    <HomeCard id="chores-title" title="Your chores">
      {mineToday.map((c, i) => (
          <Fragment key={c.id}>
            {i > 0 ? <Separator className="mx-4 data-horizontal:w-auto" /> : null}
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
          </Fragment>
        ))}
    </HomeCard>
  )
}

/** House's Home section, part two: the next upkeep item that's due or overdue (nothing when the house is fine). */
export function UpkeepToday({ upkeep }: { upkeep: UpkeepView[] }) {
  const { base, dates } = useGroup()
  const house = upkeep.find((u) => u.status !== "ok")
  if (!house) return null
  return (
    <HomeCard id="upkeep-title" title="House care">
      <Item render={<Link href={`${base}/house?tab=upkeep`} />} className="py-3">
        <ItemMedia variant="icon" className="size-8 justify-center">
          <WrenchIcon aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{house.name}</ItemTitle>
          <ItemDescription>{house.status === "overdue" ? `Upkeep, ${dates.dueLabel(house.due)}.` : `Upkeep, due ${dates.dueLabel(house.due)}.`}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
        </ItemActions>
      </Item>
    </HomeCard>
  )
}

/**
 * Core's Home card: the next Reminders you may see after today (today's are in the Today strip; nothing when there
 * are none); the Reminders page has them all.
 */
export function RemindersComingUp({ reminders }: { reminders: ReminderView[] }) {
  const { base, me, name, dates } = useGroup()
  const later = reminders.filter((r) => r.day > dates.today)
  if (later.length === 0) return null
  return (
    <HomeCard id="reminders-title" title="Coming up">
      {later.slice(0, 3).map((r, i) => (
        <Fragment key={r.id}>
          {i > 0 ? <Separator className="mx-4 data-horizontal:w-auto" /> : null}
          <Item render={<Link href={`${base}/reminders`} />} className="py-3">
            <ItemMedia variant="icon" className="size-8 justify-center">
              <BellIcon aria-hidden />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>{r.text}</ItemTitle>
              <ItemDescription>
                {r.when}. {r.for ? (r.for === me.id ? "Just for you" : `For ${name(r.for)}`) : "For everyone"}.
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
            </ItemActions>
          </Item>
        </Fragment>
      ))}
    </HomeCard>
  )
}

/** Groceries' Home section: what's in the Cart (and what's yours), and the next Recipe. */
export function CartToday({ cart, nextRecipe }: { cart: CartItemView[]; nextRecipe: { title: string; plannedFor: string } | null }) {
  const { me, base, dates } = useGroup()
  const yourCart = cart.filter((c) => c.addedBy === me.id && !c.shared).length
  const yours = cart.length === 0 ? "Nothing to buy right now." : yourCart ? `${yourCart} of them ${yourCart === 1 ? "is" : "are"} just for you.` : "None of them are just for you."
  const recipeHint = nextRecipe ? `${nextRecipe.title} is ${dates.dueLabel(nextRecipe.plannedFor)}.` : null
  return (
    <HomeCard id="cart-title" title="Cart">
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
    </HomeCard>
  )
}


/**
 * The Recent card: the newest Activity, one row each: who (their avatar, their name first), what, and when (the time
 * today, the day before that). All activity has the rest.
 */
export function RecentCard({ rows }: { rows: ActivityView[] }) {
  const { base, me, dates } = useGroup()
  return (
    <HomeCard
      id="recent-title"
      title="Recent"
      action={
        <Button variant="link" size="xs" nativeButton={false} render={<Link href={`${base}/money?tab=activity`} />}>
          All activity
        </Button>
      }
    >
      {rows.length === 0 ? (
        <p className="type-body px-4 py-3.5 text-muted-foreground">Nothing yet. Say “roomie hi” in the chat and I&apos;ll get going.</p>
      ) : (
        rows.map((a, i) => {
          const who = a.actor === "roomie" ? "Roomie" : a.actor === me.id ? "You" : a.actorName
          const when = a.date === dates.today && a.time ? a.time : dates.dayLabel(a.date)
          return (
            <Fragment key={a.id}>
              {i > 0 ? <Separator className="mx-4 data-horizontal:w-auto" /> : null}
              <Item render={a.href ? <Link href={a.href} /> : undefined} className="py-3">
                <ItemMedia className="size-8 justify-center">{a.actor === "roomie" ? <RoomieAvatar size={32} /> : <MemberAvatar name={a.actorName} />}</ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="line-clamp-2 font-normal text-pretty">
                    <span>
                      <span className="font-semibold">{who}</span> {a.text}
                    </span>
                  </ItemTitle>
                  <ItemDescription>{when}</ItemDescription>
                </ItemContent>
                {a.href ? (
                  <ItemActions>
                    <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
                  </ItemActions>
                ) : null}
              </Item>
            </Fragment>
          )
        })
      )}
    </HomeCard>
  )
}
