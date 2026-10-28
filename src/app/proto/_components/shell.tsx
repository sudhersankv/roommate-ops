"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useEffect, type ReactNode } from "react"
import { cn } from "cn"
import { CheckIcon, ChevronDownIcon, House, ListChecks, ShoppingCart, Wallet } from "lucide-react"

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
import { toast } from "@/components/ui/toast"
import { Roomie } from "@/components/roomie/mascot"
import { useCheer } from "@/components/roomie/use-cheer"
import { ME, otherGroups } from "../_data"
import { useStore } from "../_lib/store"
import { AskRoomie } from "./ask-roomie"
import { MemberAvatar } from "./member-avatar"

export const base = "/proto/g/apt-4b"

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-background md:border-x">
      <a
        href="#main"
        className="sr-only rounded-full bg-primary px-5 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:inline-flex focus:h-11 focus:items-center"
      >
        Skip to content
      </a>
      <main id="main" className="flex flex-1 flex-col pb-32">
        {children}
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
  const { state } = useStore()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="tint" size="sm" aria-label={`Group: ${state.group.name}. Switch group`}>
            <span className="max-w-40 truncate">{state.group.name}</span>
            <ChevronDownIcon data-icon="inline-end" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Your groups</DropdownMenuLabel>
          <DropdownMenuItem>
            {state.group.name}
            <CheckIcon className="ml-auto" />
          </DropdownMenuItem>
          {otherGroups.map((g) => (
            <DropdownMenuItem
              key={g.slug}
              onClick={() =>
                toast.add({ title: `${g.name} isn't in the prototype`, description: "Only Apt 4B has data. The switcher works the same way for every Group." })
              }
            >
              {g.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function MoreMenu() {
  const router = useRouter()
  const { state } = useStore()
  const me = state.members.find((m) => m.id === ME)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" aria-label="More: Members, Settings, sign out">
            <MemberAvatar name={me?.name ?? "You"} />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Signed in as {me?.name}</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => router.push(`${base}/members`)}>Members</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push(`${base}/settings`)}>Settings</DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/proto/design")}>Design system</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => router.push("/proto")}>Sign out</DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const tabs = [
  { href: base, label: "Home", icon: House, exact: true },
  { href: `${base}/money`, label: "Money", icon: Wallet },
  null,
  { href: `${base}/cart`, label: "Cart", icon: ShoppingCart },
  { href: `${base}/chores`, label: "Chores", icon: ListChecks },
] as const

function BottomNav() {
  const pathname = usePathname()
  const { state, setAskOpen } = useStore()
  const [cheering, cheer] = useCheer()

  // The nav dino hops whenever something good happens anywhere in the Group.
  useEffect(() => {
    if (state.cheers > 0) cheer()
  }, [state.cheers, cheer])

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:border-x"
    >
      <ul className="grid h-18 grid-cols-5 items-stretch">
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
          const active = "exact" in tab ? pathname === tab.href : pathname.startsWith(tab.href)
          const Icon = tab.icon
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
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-primary/18 text-foreground"
                  )}
                >
                  <Icon className="size-5" aria-hidden />
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
