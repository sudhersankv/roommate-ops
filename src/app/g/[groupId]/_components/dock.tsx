"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { useEffect, useState, type ReactNode } from "react"
import { cn } from "cn"
import { Bell, House, LayoutGrid, Settings, Sparkles, Users } from "lucide-react"

import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { Roomie } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
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
 * The dock: Home, the first two learned Tricks (manifest nav order), More; Ask Roomie sits in the middle with equal
 * halves either side. More opens the drawer with everything else.
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
 * Everything the dock has no room for: the learned Tricks that aren't in the dock, a greyed slot for each one not
 * learned yet (Teach, or Ask an admin), one "What's coming" tile (the Tricks page's Soon list), then the Group's own
 * pages: Reminders (core, no Trick owns them), Members and Settings.
 */
function MoreDrawer({ open, onOpenChange, active }: { open: boolean; onOpenChange: (open: boolean) => void; active: string | null }) {
  const { base, group, isAdmin, drawer } = useGroup()
  const close = () => onOpenChange(false)
  const tricks = `${base}/tricks`
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-md">
        <DrawerHeader>
          <DrawerTitle className="type-heading">More</DrawerTitle>
          <DrawerDescription>The rest of {group.name}.</DrawerDescription>
        </DrawerHeader>
        <nav aria-label="More" className="flex min-h-0 flex-col gap-6 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <section aria-labelledby="more-tricks" className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h3 id="more-tricks" className="type-caption font-semibold tracking-wide text-muted-foreground uppercase">
                Tricks
              </h3>
              <Link
                href={tricks}
                onClick={close}
                aria-current={active === tricks ? "page" : undefined}
                className="type-caption font-medium text-foreground underline decoration-primary decoration-2 underline-offset-4 hover:decoration-foreground"
              >
                All Tricks
              </Link>
            </div>
            <ul className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4">
              {drawer.learned.map((n) => (
                <Tile key={n.href} href={n.href} icon={n.icon} label={n.label} active={active === n.href} onNavigate={close} />
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
                  onNavigate={close}
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
                  onNavigate={close}
                />
              ) : null}
            </ul>
          </section>
          <section aria-labelledby="more-group" className="flex flex-col gap-3">
            <h3 id="more-group" className="type-caption font-semibold tracking-wide text-muted-foreground uppercase">
              Group
            </h3>
            <ul className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4">
              <Tile href={`${base}/reminders`} icon={<Bell />} label="Reminders" active={active === `${base}/reminders`} onNavigate={close} />
              <Tile href={`${base}/members`} icon={<Users />} label="Members" active={active === `${base}/members`} onNavigate={close} />
              <Tile href={`${base}/settings`} icon={<Settings />} label="Settings" active={active === `${base}/settings`} onNavigate={close} />
            </ul>
          </section>
        </nav>
      </DrawerContent>
    </Drawer>
  )
}

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
          "flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-center outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50",
          muted ? "border border-dashed border-foreground/15 bg-transparent hover:bg-muted/50" : "bg-muted/60 hover:bg-muted",
          state === "soon" && "border border-dashed border-primary/50 bg-primary/8",
          active && "bg-primary/18 ring-2 ring-primary/60"
        )}
      >
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-2xl [&_svg]:size-5",
            muted ? "bg-muted text-muted-foreground opacity-60 grayscale" : "bg-primary/18 text-foreground"
          )}
          aria-hidden
        >
          {icon}
        </span>
        <span className={cn("w-full truncate text-xs font-medium", muted ? "text-muted-foreground" : "text-foreground", active && "font-semibold")}>{label}</span>
        {sub ? <span className="w-full truncate text-[0.6875rem] text-muted-foreground">{sub}</span> : null}
      </Link>
    </li>
  )
}
