"use client"

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react"

import { CurrencyContext } from "@/components/app/money-bits"
import { dateLabels } from "@/lib/dates"
import type { PaymentApp } from "@/db/schema"
import type { ToolkitId } from "@/toolkits/types"

// What every screen of a Group needs, from the server (layout.tsx): the Group, the signed-in Member, the people in
// it and today's date in the Group's time zone. Plus two bits of client state: the Ask Roomie drawer and the cheer
// counter that makes the dinos hop.

export type MemberView = {
  id: string
  name: string
  role: "admin" | "member"
  status: "pending" | "active" | "removed"
  joined: string
  handles: Partial<Record<PaymentApp, string>>
  hasAccount: boolean
  /** Their dashboard seat (ADR 0014): who's connected to it (Google name, avatar; the email for Admins only), or open,
   * or a Pending Join link sign-in and the seat it asked for. */
  seat: { state: "connected" | "open" | "pending"; accountName: string | null; accountImage: string | null; accountEmail: string | null; wantsSeat: string | null }
}

/** A tab or menu entry contributed by a Toolkit's manifest (`dashboard.nav`). The icon is rendered on the server. */
export type NavItemView = { toolkit: string; label: string; href: string; icon: ReactNode }

/** A Trick that isn't learned here (or can't be yet): a greyed slot in the More drawer. */
export type TrickSlotView = { id: string; name: string; icon: ReactNode }

/** A route prefix a Toolkit owns (`dashboard.pages`): while every owner is off, the page shows the off state. */
export type OwnedPageView = { prefix: string; owners: { id: string; name: string; summary: string; enabled: boolean; icon: ReactNode }[] }

export type GroupView = {
  group: {
    id: string
    name: string
    currency: string
    timezone: string
    chattiness: "quiet" | "normal" | "chatty"
    purpose: string | null
    simplifyDebts: boolean
    onboarded: boolean
    joinPolicy: "free" | "approve_all"
  }
  /** The Group's Join link (active Members only). */
  joinUrl: string | null
  me: MemberView
  groups: { id: string; name: string }[]
  members: MemberView[]
  toolkits: Record<ToolkitId, boolean>
  /** Names of the enabled Toolkits, in marketplace order. */
  toolkitNames: string[]
  /** Dock tabs between Home and More (at most NAV_TABS learned Tricks, one per page). */
  nav: NavItemView[]
  /** The More drawer: every learned Trick, then greyed slots for the ones not learned yet and the coming-soon ones. */
  drawer: { learned: NavItemView[]; notYet: TrickSlotView[]; soon: TrickSlotView[] }
  ownedPages: OwnedPageView[]
  today: string
  dev: boolean
}

function useCreate(view: GroupView) {
  const [askOpen, setAskOpen] = useState(false)
  const [cheers, setCheers] = useState(0)
  const cheer = useCallback(() => setCheers((n) => n + 1), [])
  const dates = useMemo(() => dateLabels(view.today), [view.today])
  const base = `/g/${view.group.id}`
  const isAdmin = view.me.role === "admin" && view.me.status === "active"
  const name = useCallback(
    (id: string) => (id === view.me.id ? "You" : (view.members.find((m) => m.id === id)?.name ?? "Someone")),
    [view.me.id, view.members]
  )
  const active = useMemo(() => view.members.filter((m) => m.status === "active"), [view.members])
  return { ...view, base, isAdmin, active, name, dates, askOpen, setAskOpen, cheers, cheer }
}

type Store = ReturnType<typeof useCreate>

const GroupContext = createContext<Store | null>(null)

export function GroupProvider({ view, children }: { view: GroupView; children: ReactNode }) {
  const store = useCreate(view)
  return (
    <GroupContext value={store}>
      <CurrencyContext value={view.group.currency}>{children}</CurrencyContext>
    </GroupContext>
  )
}

export function useGroup() {
  const store = use(GroupContext)
  if (!store) throw new Error("useGroup must be used inside GroupProvider")
  return store
}

/** Run a server action result through a toast on failure. Returns true when it worked. */
export type ActionResult<T = unknown> = { ok: true; data?: T } | { ok: false; error: string; status: number }
