"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon } from "lucide-react"

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
import { MemberAvatar } from "@/components/app/member-avatar"
import { authClient } from "@/lib/auth/client"
import { AskRoomie } from "./ask-roomie"
import { Dock } from "./dock"
import { useGroup } from "./group-context"
import { ToolkitOff } from "./toolkit-off"

const LAST_GROUP_COOKIE = "roomie-group" // read by app/page.tsx

export function AppShell({ children }: { children: ReactNode }) {
  const { group } = useGroup()
  // "/" sends you back to the Group you looked at last.
  useEffect(() => {
    document.cookie = `${LAST_GROUP_COOKIE}=${group.id}; path=/; max-age=31536000; samesite=lax`
  }, [group.id])

  // A page that reads better wide (a list beside what it opens) marks its root `data-wide`: the column widens on large
  // screens. The dock stays phone-width.
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background md:border-x lg:has-[[data-wide]]:max-w-6xl">
      <a
        href="#main"
        className="sr-only rounded-full bg-primary px-5 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:inline-flex focus:h-11 focus:items-center"
      >
        Skip to content
      </a>
      <main id="main" className="flex flex-1 flex-col pb-32">
        <OwnedPage>{children}</OwnedPage>
      </main>
      <Dock />
      <AskRoomie />
    </div>
  )
}

/** Sticky bar with the group switcher and the account menu. `hero` renders it as part of the forest doorway band. */
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
      <AccountMenu />
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
 * page. Pages nobody owns (Home, Members, Settings, Tricks) always render.
 */
function OwnedPage({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { base, ownedPages } = useGroup()
  const segment = pathname.startsWith(`${base}/`) ? pathname.slice(base.length + 1).split("/")[0] : ""
  const owned = ownedPages.find((p) => p.prefix === segment)
  if (!owned || owned.owners.some((o) => o.enabled)) return children
  return (
    <>
      <TopBar title={owned.owners[0].name} />
      <ToolkitOff toolkit={owned.owners[0]} />
    </>
  )
}

/** The avatar menu: who you are, the Group's own pages and sign out (the Tricks live in the dock's More drawer). */
function AccountMenu() {
  const router = useRouter()
  const { me, base, dev } = useGroup()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="Account: Members, Tricks, Settings, sign out">
            <MemberAvatar name={me.name} />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Signed in as {me.name}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => router.push(`${base}/members`)}>Members</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(`${base}/tricks`)}>Tricks</DropdownMenuItem>
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

/** Page title row used by every screen except Home. */
export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-5 pt-2 pb-4">
      <h1 className="type-title">{title}</h1>
      {children}
    </div>
  )
}
