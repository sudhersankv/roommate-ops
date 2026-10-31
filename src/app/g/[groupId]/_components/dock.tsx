"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useState, useTransition, type ReactNode } from "react"
import { cn } from "cn"
import { ArrowLeftRight, Bell, Check, House, LayoutGrid, Settings, Sparkles, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Spinner } from "@/components/ui/spinner"
import { toast } from "@/components/ui/toast"
import { Roomie } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
import { DOCK_SLOTS } from "@/services/dock-rules"
import { saveDock } from "../actions"
import { useGroup } from "./group-context"

type Target = { href: string; exact?: boolean }

/**
 * The one destination the current URL is: the longest matching path, and an href with a query ("?tab=upkeep") only
 * when the query matches too. /toolkits counts as /tricks (the same page under its old name).
 */
function useActiveHref(base: string, targets: Target[]): string | null {
  const pathname = usePathname().replace(`${base}/toolkits`, `${base}/tricks`)
  const search = useSearchParams()
  let best: string | null = null
  let bestScore = -1
  for (const t of targets) {
    const [path, query] = t.href.split("?")
    const pathOk = t.exact ? pathname === path : pathname === path || pathname.startsWith(`${path}/`)
    if (!pathOk) continue
    let score = path.length
    if (query) {
      if (![...new URLSearchParams(query)].every(([k, v]) => search.get(k) === v)) continue
      score += 1000
    }
    if (score > bestScore) [best, bestScore] = [t.href, score]
  }
  return best
}

const pathOf = (href: string | null) => href?.split("?")[0] ?? null

/**
 * The dock: Home, your two Tricks (your choice, else the first two by manifest nav order), More; Ask Roomie sits in
 * the middle with equal halves either side. More opens the drawer with every page.
 */
export function Dock() {
  const { base, cheers, setAskOpen, nav, drawer } = useGroup()
  const [cheering, cheer] = useCheer()
  const [moreOpen, setMoreOpen] = useState(false)
  const tricks = `${base}/tricks`
  const active = useActiveHref(base, [
    { href: base, exact: true },
    ...[...nav, ...drawer.learned].map((n) => ({ href: n.href })),
    { href: `${base}/reminders` },
    { href: `${base}/members` },
    { href: `${base}/settings` },
    { href: tricks },
  ])
  const activePath = pathOf(active)
  const inBar = activePath === base || nav.some((n) => pathOf(n.href) === activePath)
  const moreActive = !!active && !inBar

  // The nav dino hops whenever something good happens anywhere in the Group.
  useEffect(() => {
    if (cheers > 0) cheer()
  }, [cheers, cheer])

  const items: ReactNode[] = [
    <DockLink key="home" href={base} label="Home" icon={<House />} active={activePath === base} />,
    ...nav.map((n) => <DockLink key={n.href} href={n.href} label={n.label} icon={n.icon} active={pathOf(n.href) === activePath} />),
    <li key="more" className="flex">
      <button
        type="button"
        onClick={() => setMoreOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={moreOpen}
        aria-current={moreActive ? "page" : undefined}
        className={tabClass(moreActive)}
      >
        <span className={pillClass(moreActive)} aria-hidden>
          <LayoutGrid />
        </span>
        More
      </button>
    </li>,
  ]
  const left = Math.ceil(items.length / 2)
  const right = items.length - left

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:border-x"
      >
        {/* Each left item weighs `right` and each right item `left`, so both halves are equal and Ask Roomie is centred. */}
        <ul className="grid h-18 items-stretch" style={{ gridTemplateColumns: `repeat(${left}, minmax(0, ${right}fr)) 4.5rem repeat(${right}, minmax(0, ${left}fr))` }}>
          {items.slice(0, left)}
          <li className="flex items-start justify-center">
            <button type="button" onClick={() => setAskOpen(true)} className="group/ask -mt-6 flex flex-col items-center gap-1 rounded-full outline-none">
              <span className="flex size-16 items-center justify-center rounded-full bg-forest shadow-lg ring-4 ring-card transition-transform group-hover/ask:-translate-y-0.5 group-focus-visible/ask:ring-ring group-active/ask:translate-y-px">
                <Roomie size={50} mood="calm" animated cheer={cheering} decorative />
              </span>
              <span className="text-[0.6875rem] font-semibold whitespace-nowrap text-foreground">Ask Roomie</span>
            </button>
          </li>
          {items.slice(left)}
        </ul>
      </nav>
      <MoreDrawer open={moreOpen} onOpenChange={setMoreOpen} active={active} />
    </>
  )
}

const tabClass = (active: boolean) =>
  cn(
    "group/tab flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
    active && "font-semibold text-foreground"
  )
const pillClass = (active: boolean) =>
  cn("flex h-7 w-12 max-w-full items-center justify-center rounded-full transition-colors [&_svg]:size-5", active && "bg-primary/18 text-foreground")

function DockLink({ href, label, icon, active }: { href: string; label: string; icon: ReactNode; active: boolean }) {
  return (
    <li className="flex min-w-0">
      <Link href={href} aria-current={active ? "page" : undefined} className={tabClass(active)}>
        <span className={pillClass(active)} aria-hidden>
          {icon}
        </span>
        <span className="max-w-full truncate px-0.5">{label}</span>
      </Link>
    </li>
  )
}


/**
 * Every page in one grid: each learned Trick's page (nav order, the dock's two included), a greyed slot for each one
 * not learned yet (Teach, or Ask an admin), one "What's coming" tile (the Tricks page's Soon list), then the Group's
 * own pages: Reminders (core, no Trick owns them), Members and Settings. "Change dock" swaps the grid for the editor.
 */
function MoreDrawer({ open, onOpenChange, active }: { open: boolean; onOpenChange: (open: boolean) => void; active: string | null }) {
  const [editing, setEditing] = useState(false)
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setEditing(false)
      }}
    >
      <DrawerContent className="mx-auto max-w-md">
        {editing ? (
          <DockEditor
            onDone={() => setEditing(false)}
            onSaved={() => {
              onOpenChange(false)
              setEditing(false)
            }}
          />
        ) : (
          <MoreGrid active={active} onNavigate={() => onOpenChange(false)} onEdit={() => setEditing(true)} />
        )}
      </DrawerContent>
    </Drawer>
  )
}

function MoreGrid({ active, onNavigate, onEdit }: { active: string | null; onNavigate: () => void; onEdit: () => void }) {
  const { base, group, isAdmin, drawer } = useGroup()
  const tricks = `${base}/tricks`
  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">More</DrawerTitle>
        <DrawerDescription>Everything in {group.name}.</DrawerDescription>
      </DrawerHeader>
      <nav aria-label="More" className="flex min-h-0 flex-col gap-6 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <section aria-labelledby="more-tricks" className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <h3 id="more-tricks" className="type-caption font-semibold tracking-wide text-muted-foreground uppercase">
              Tricks
            </h3>
            <Link
              href={tricks}
              onClick={onNavigate}
              aria-current={active === tricks ? "page" : undefined}
              className="type-caption font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground"
            >
              All Tricks
            </Link>
          </div>
          <ul className={GRID}>
            {drawer.learned.map((n) => (
              <Tile key={n.href} href={n.href} icon={n.icon} label={n.label} active={active === n.href} onNavigate={onNavigate} />
            ))}
            {drawer.notYet.map((t) => (
              <Tile
                key={t.id}
                href={`${tricks}?open=${t.id}`}
                icon={t.icon}
                label={t.name}
                sub={isAdmin ? "Teach" : "Ask an admin"}
                ariaLabel={`${t.name}: not learned yet. ${isAdmin ? "Teach Roomie" : "Ask an admin"}`}
                state="not-yet"
                onNavigate={onNavigate}
              />
            ))}
            {drawer.soon.length ? (
              <Tile
                href={`${tricks}#soon`}
                icon={<Sparkles />}
                label="What's coming"
                sub={`${drawer.soon.length} soon`}
                ariaLabel={`What's coming: ${drawer.soon.length} Tricks Roomie is learning next`}
                state="soon"
                onNavigate={onNavigate}
              />
            ) : null}
          </ul>
          {drawer.learned.length >= 2 ? (
            <Button variant="tint" size="sm" className="self-start" onClick={onEdit}>
              <ArrowLeftRight data-icon="inline-start" />
              Change dock
            </Button>
          ) : null}
        </section>
        <section aria-labelledby="more-group" className="flex flex-col gap-3">
          <h3 id="more-group" className="type-caption font-semibold tracking-wide text-muted-foreground uppercase">
            Group
          </h3>
          <ul className={GRID}>
            <Tile href={`${base}/reminders`} icon={<Bell />} label="Reminders" active={active === `${base}/reminders`} onNavigate={onNavigate} />
            <Tile href={`${base}/members`} icon={<Users />} label="Members" active={active === `${base}/members`} onNavigate={onNavigate} />
            <Tile href={`${base}/settings`} icon={<Settings />} label="Settings" active={active === `${base}/settings`} onNavigate={onNavigate} />
          </ul>
        </section>
      </nav>
    </>
  )
}

const GRID = "grid grid-cols-3 gap-2 min-[420px]:grid-cols-4"

/**
 * Choose the dock's two Tricks: tap to put one in or take it out (an empty side fills first), Swap to trade sides,
 * Save. Saved per Member on the server, so the phone and the laptop show the same dock; saving closes the drawer, and
 * the new dock is the confirmation.
 */
function DockEditor({ onDone, onSaved }: { onDone: () => void; onSaved: () => void }) {
  const { group, nav, drawer } = useGroup()
  const slots = Math.min(DOCK_SLOTS, drawer.learned.length)
  // One entry per side (null = empty), so taking one out leaves the other where it was.
  const [picked, setPicked] = useState<(string | null)[]>(() => Array.from({ length: slots }, (_, i) => nav[i]?.toolkit ?? null))
  const [pending, start] = useTransition()
  const byId = (id: string | null | undefined) => drawer.learned.find((n) => n.toolkit === id)
  const count = picked.filter(Boolean).length
  const full = count >= slots
  const toggle = (id: string) =>
    setPicked((p) => {
      if (p.includes(id)) return p.map((x) => (x === id ? null : x))
      const free = p.indexOf(null)
      return free < 0 ? p : p.map((x, i) => (i === free ? id : x))
    })
  const save = () =>
    start(async () => {
      const res = await saveDock(group.id, picked.filter((x): x is string => !!x))
      if (!res.ok) return void toast.add({ title: "Couldn't save the dock", description: res.error, type: "error" })
      onSaved()
    })

  return (
    <>
      <DrawerHeader>
        <DrawerTitle className="type-heading">Your dock</DrawerTitle>
        <DrawerDescription>The two Tricks next to Ask Roomie. Just yours, on every device.</DrawerDescription>
      </DrawerHeader>
      <div className="flex min-h-0 flex-col gap-5 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-2">
          <div aria-label="Your dock" role="group" className="grid grid-cols-[1fr_1fr_3.5rem_1fr_1fr] items-center gap-1 rounded-2xl border bg-card px-1 py-2">
            <PreviewSlot icon={<House />} label="Home" fixed />
            <PreviewSlot item={byId(picked[0])} />
            <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-forest" aria-hidden>
              <Roomie size={34} mood="calm" decorative />
            </span>
            <PreviewSlot item={slots > 1 ? byId(picked[1]) : undefined} />
            <PreviewSlot icon={<LayoutGrid />} label="More" fixed />
          </div>
          <Button variant="ghost" size="sm" className="self-center" disabled={slots < 2} onClick={() => setPicked(([a, b]) => [b, a])}>
            <ArrowLeftRight data-icon="inline-start" />
            Swap sides
          </Button>
        </div>
        <section aria-labelledby="dock-pick" className="flex flex-col gap-3">
          <h3 id="dock-pick" className="type-caption font-semibold tracking-wide text-muted-foreground uppercase">
            Tricks
          </h3>
          <ul className={GRID}>
            {drawer.learned.map((n) => {
              const at = picked.indexOf(n.toolkit)
              const on = at >= 0
              return (
                <li key={n.toolkit} className="flex">
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={!on && full}
                    onClick={() => toggle(n.toolkit)}
                    className={cn(
                      tileClass,
                      "bg-muted/60 hover:bg-muted disabled:pointer-events-none disabled:opacity-45",
                      on && "bg-primary/18 ring-2 ring-primary/60 hover:bg-primary/24"
                    )}
                  >
                    <span className={cn(iconClass, "bg-primary/18 text-foreground", on && "bg-primary text-primary-foreground")} aria-hidden>
                      {on ? <Check /> : n.icon}
                    </span>
                    <span className={cn("w-full truncate text-xs font-medium text-foreground", on && "font-semibold")}>{n.label}</span>
                    <span className="w-full truncate text-[0.6875rem] text-muted-foreground">{on ? (slots > 1 ? (at === 0 ? "Left" : "Right") : "In the dock") : "Add"}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="type-caption text-muted-foreground" aria-live="polite">
            {full ? "Tap one in the dock to take it out." : `Pick ${slots - count === 1 ? "one more" : `${slots - count}`}.`}
          </p>
        </section>
        <div className="flex gap-2">
          <Button disabled={pending || !full} onClick={save}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Save
          </Button>
          <Button variant="ghost" disabled={pending} onClick={onDone}>
            Cancel
          </Button>
        </div>
      </div>
    </>
  )
}

function PreviewSlot({ item, icon, label, fixed = false }: { item?: { label: string; icon: ReactNode }; icon?: ReactNode; label?: string; fixed?: boolean }) {
  const shown = item ?? (fixed ? { label: label!, icon } : null)
  return (
    <span className={cn("flex min-w-0 flex-col items-center gap-1 text-[0.6875rem] font-medium", fixed ? "text-muted-foreground" : "text-foreground")}>
      <span
        className={cn(
          "flex h-7 w-11 max-w-full items-center justify-center rounded-full [&_svg]:size-5",
          !fixed && (shown ? "bg-primary/18" : "border border-dashed border-foreground/25")
        )}
        aria-hidden
      >
        {shown?.icon}
      </span>
      <span className="max-w-full truncate">{shown ? shown.label : "Empty"}</span>
    </span>
  )
}

const tileClass =
  "flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50"
const iconClass = "flex size-10 items-center justify-center rounded-2xl transition-colors [&_svg]:size-5"

function Tile({
  href,
  icon,
  label,
  sub,
  ariaLabel,
  active = false,
  state = "learned",
  onNavigate,
}: {
  href: string
  icon: ReactNode
  label: string
  sub?: string
  ariaLabel?: string
  active?: boolean
  state?: "learned" | "not-yet" | "soon"
  onNavigate: () => void
}) {
  const muted = state === "not-yet"
  return (
    <li className="flex">
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={ariaLabel}
        className={cn(
          tileClass,
          muted ? "border border-dashed border-foreground/15 bg-transparent hover:bg-muted/50" : "bg-muted/60 hover:bg-muted",
          state === "soon" && "border border-dashed border-primary/50 bg-primary/8",
          active && "bg-primary/18 ring-2 ring-primary/60"
        )}
      >
        <span className={cn(iconClass, muted ? "bg-muted text-muted-foreground opacity-60 grayscale" : "bg-primary/18 text-foreground")} aria-hidden>
          {icon}
        </span>
        <span className={cn("w-full truncate text-xs font-medium", muted ? "text-muted-foreground" : "text-foreground", active && "font-semibold")}>{label}</span>
        {sub ? <span className="w-full truncate text-[0.6875rem] text-muted-foreground">{sub}</span> : null}
      </Link>
    </li>
  )
}
