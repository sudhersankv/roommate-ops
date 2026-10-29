"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, House } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Roomie } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
import { MemberAvatar } from "@/components/app/member-avatar"
import { authClient } from "@/lib/auth/client"
import { AskRoomie } from "./ask-roomie"
import { useGroup } from "./group-context"
import { ToolkitOff } from "./toolkit-off"

const LAST_GROUP_COOKIE = "roomie-group" // read by app/page.tsx

export function AppShell({ children }: { children: ReactNode }) {
  const { group } = useGroup()
  // "/" sends you back to the Group you looked at last.
  useEffect(() => {
    document.cookie = `${LAST_GROUP_COOKIE}=${group.id}; path=/; max-age=31536000; samesite=lax`
  }, [group.id])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background md:border-x">
      <a
        href="#main"
        className="sr-only rounded-full bg-primary px-5 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:inline-flex focus:h-11 focus:items-center"
      >
        Skip to content
      </a>
      <main id="main" className="flex flex-1 flex-col pb-32">
        <OwnedPage>{children}</OwnedPage>
      </main>
      <BottomNav />
      <AskRoomie />
    </div>
  )
}

/** Sticky bar with the group switcher and the More menu. `hero` renders it as part of the forest doorway band. */
export function TopBar({ hero = false, title }: { hero?: boolean; title?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-3 px-4",
        hero ? "dark bg-forest text-foreground" : "bg-background/90 backdrop-blur-md supports-backdrop-filter:bg-background/75"
      )}
    >
      <GroupSwitcher />
      {title ? <span className="sr-only">{title}</span> : null}
      <MoreMenu />
    </header>
  )
}

function GroupSwitcher() {
  const router = useRouter()
  const { group, groups } = useGroup()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="tint" size="sm" aria-label={`Group: ${group.name}. Switch group`}>
            <span className="max-w-40 truncate">{group.name}</span>
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your groups</DropdownMenuLabel>
          {groups.map((g) => (
            <DropdownMenuItem key={g.id} onClick={() => g.id !== group.id && router.push(`/g/${g.id}`)}>
              {g.name}
              {g.id === group.id ? <CheckIcon className="ml-auto" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * A page a Toolkit owns (its manifest's `dashboard.pages`) while every owner is off: the off state instead of the
 * page. Pages nobody owns (Home, Members, Settings, Toolkits) always render.
 */
function OwnedPage({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { base, ownedPages } = useGroup()
  const segment = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : ""
  const owned = ownedPages.find((p) => p.prefix === segment)
  if (!owned || owned.owners.some((o) => o.enabled)) return children
  return <ToolkitOff toolkit={owned.owners[0]} />
}

function MoreMenu() {
  const router = useRouter()
  const { me, base, dev, moreNav } = useGroup()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="More: Members, Toolkits, Settings, sign out">
            <MemberAvatar name={me.name} />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-52">
        {moreNav.length ? (
          <>
            <DropdownMenuGroup>
              <DropdownMenuLabel>More</DropdownMenuLabel>
              {moreNav.map((n) => (
                <DropdownMenuItem key={n.href} onClick={() => router.push(n.href)}>
                  {n.icon}
                  {n.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Signed in as {me.name}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => router.push(`${base}/members`)}>Members</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(`${base}/toolkits`)}>Toolkits</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(`${base}/settings`)}>Settings</DropdownMenuItem>
          {dev ? <DropdownMenuItem onClick={() => router.push("/design")}>Design system</DropdownMenuItem> : null}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={async () => {
              await authClient.signOut().catch(() => {})
              router.push("/")
              router.refresh()
            }}
          >
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Home, then the enabled Toolkits' tabs (from their manifests), with Ask Roomie in the middle. */
function BottomNav() {
  const pathname = usePathname()
  const { base, cheers, setAskOpen, nav } = useGroup()
  const [cheering, cheer] = useCheer()
  const links = [{ href: base, label: "Home", icon: <House />, exact: true }, ...nav.map((n) => ({ href: n.href, label: n.label, icon: n.icon, exact: false }))]
  const middle = Math.ceil(links.length / 2)
  const tabs = [...links.slice(0, middle), null, ...links.slice(middle)]

  // The nav dino hops whenever something good happens anywhere in the Group.
  useEffect(() => {
    if (cheers > 0) cheer()
  }, [cheers, cheer])

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:border-x"
    >
      <ul className="grid h-18 items-stretch" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
        {tabs.map((tab) => {
          if (!tab) {
            return (
              <li key="ask" className="flex items-start justify-center">
                <button
                  type="button"
                  onClick={() => setAskOpen(true)}
                  className="group/ask -mt-6 flex flex-col items-center gap-1 rounded-full outline-none"
                >
                  <span className="flex size-16 items-center justify-center rounded-full bg-forest shadow-lg ring-4 ring-card transition-transform group-hover/ask:-translate-y-0.5 group-focus-visible/ask:ring-ring group-active/ask:translate-y-px">
                    <Roomie size={50} mood="calm" animated cheer={cheering} decorative />
                  </span>
                  <span className="text-[0.6875rem] font-semibold text-foreground">Ask Roomie</span>
                </button>
              </li>
            )
          }
          const path = tab.href.split("?")[0]
          const active = tab.exact ? pathname === path : pathname.startsWith(path)
          return (
            <li key={tab.href} className="flex">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "group/tab flex flex-1 flex-col items-center justify-center gap-1 rounded-2xl text-[0.6875rem] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "font-semibold text-foreground"
                )}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors [&_svg]:size-5",
                    active && "bg-primary/18 text-foreground"
                  )}
                  aria-hidden
                >
                  {tab.icon}
                </span>
                {tab.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Page title row used by every screen except Home. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-5 pt-2 pb-4">
      <h1 className="type-title">{title}</h1>
      {children}
    </div>
  )
}
