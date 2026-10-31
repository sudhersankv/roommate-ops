// Plain shapes the server pages hand to the client screens (dates as "YYYY-MM-DD" in the Group's time zone).
import type { Category } from "@/components/app/categories"
import type { ReactNode } from "react"
import type { Recurrence, SplitMethod } from "@/db/enums"
import type { ToolkitStatus } from "@/toolkits/types"

export type Transfer = { from: string; to: string; cents: number }

export type ExpenseView = {
  id: string
  description: string
  category: Category
  /** The day it happened (the Expense's date, not when it was typed in). */
  date: string
  cents: number
  method: SplitMethod
  /** Biggest first; the first one is the primary Payer. */
  payers: { memberId: string; cents: number }[]
  /** `weight` is the percent or number of shares for those methods. */
  shares: { memberId: string; cents: number; weight: number | null }[]
  yourShare: number
  youPaid: number
  addedBy: string | null
  note: string | null
  recurring: Recurrence | null
  /** A copy the scheduler made of a recurring Expense. */
  repeated: boolean
  /** The Group's rent (the recurring rent parent). */
  rent: boolean
  /** A bill whose amount is asked of its Payer on each due day; its own cents mean nothing. */
  variable: boolean
  receiptUrl: string | null
  inSplitwise: boolean
  source: string
  canChange: boolean
}

/** Money's Rent card (#25): the rent, or null for the empty state that offers setup. */
export type RentCardView = {
  rent: {
    cents: number
    /** Day of the month, 1-28. */
    dueDay: number
    /** The next due day ("2026-11-01"). */
    nextDue: string
    payerId: string
    method: SplitMethod
    shares: { memberId: string; cents: number }[]
  } | null
  /** The Payer or an Admin (any active Member can set it up when there's none). */
  canEdit: boolean
}

/** Settings' Nudges card: the private Settle nudge (Admins, ADR 0021). */
export type NudgeSettingsView = { thresholdCents: number; everyDays: number; enabled: boolean }

export type SplitwiseView = {
  /** Composio works (or the fake is on); otherwise the card is disabled with `hint`. */
  ready: boolean
  hint: string | null
  fake: boolean
  connected: boolean
  connectedBy: string | null
  group: { id: string; name: string } | null
  mirror: boolean
  lastSynced: string | null
  pendingPushes: number
}

/** A receipt read on the server (POST /api/receipts), to prefill the add-expense drawer. */
export type ReceiptDraft = {
  receiptUrl: string
  merchant: string
  date: string | null
  totalCents: number
  printedTotalCents: number | null
  mismatch: boolean
  items: { name: string; cents: number }[]
  taxCents: number
  tipCents: number
}

export type ActivityView = { id: string; date: string; actor: string | "roomie"; actorName: string; text: string; href?: string }

export type NarrationView = { id: string; date: string; text: string; href?: string }

export type CartItemView = {
  id: string
  name: string
  qty?: string
  addedBy: string
  shared: boolean
  estCents: number
  /** The Recipe it came from ("From Tacos for 5"). */
  recipeId: string | null
  recipeTitle: string | null
  /** Whoever added it, or an Admin (services/cart.ts enforces it). */
  canRemove: boolean
}

export type IngredientView = { name: string; text: string; quantity: number; unit: string; have: boolean }

export type RecipeView = {
  id: string
  title: string
  servings: number
  cookingTimeMinutes: number | null
  /** "YYYY-MM-DD" in the Group's time zone. */
  plannedFor: string | null
  ingredients: IngredientView[]
  steps: string[]
  createdBy: string | null
  /** Open Cart items that came from it. */
  inCart: number
}

/** A Recipe Roomie wrote on the "New recipe" sheet, not saved yet. */
export type RecipeDraftView = {
  title: string
  servings: number
  cookingTimeMinutes: number | null
  ingredients: { name: string; quantity: number; unit: string; display_text: string }[]
  steps: string[]
  have: string[]
  need: string[]
}

/** One "Probably low" row on the Cart page (services/restock.ts probablyLowView): shared, or the viewer's own. */
export type ProbablyLowView = {
  item: string
  /** "last bought 9 days ago" */
  when: string
  scope: "shared" | "mine"
}

export type CartPageView = {
  items: CartItemView[]
  /** Empty: the section is hidden. */
  probablyLow: ProbablyLowView[]
  recipes: RecipeView[]
  pantry: string[]
  /** Active Members in the order services/cart.ts splits with, so the "I paid" preview matches to the cent. */
  splitMemberIds: string[]
  instacart: { ready: boolean; hint: string | null }
}

export type ChoreView = {
  id: string
  name: string
  cadence: string
  everyDays: number
  /** Whose turn it is (member id). */
  turn: string | null
  /** The saved Rotation (member ids), null = everyone, least recent first. */
  rotation: string[] | null
  /** Who's in the turn order now, in order. */
  order: string[]
  due: string
  state: "overdue" | "due" | "ok"
  /** The last doer's streak. */
  streak: number
  /** memberId -> on-time turns in a row. */
  streaks: Record<string, number>
  lastDone?: { by: string; date: string }
}

export type UpkeepView = { id: string; name: string; every: string; everyDays: number; due: string; status: "overdue" | "due-soon" | "ok"; lastDone?: string }

export type ReminderView = {
  id: string
  text: string
  /** "Tue Nov 3, 8:00 PM" in the Group's time zone. */
  when: string
  /** "8:00 PM" in the Group's time zone. */
  time: string
  day: string
  /** Member id, null = everyone. */
  for: string | null
  setBy: string | null
  repeat: "daily" | "weekly" | "monthly" | null
  canCancel: boolean
}

export type ScheduleView = { nudgeHour: number | null; reportWeekday: number; reportHour: number }

/**
 * One row of Home's Today strip: a Trick's line from the morning Bundle (`trick` = its id, for the accent dot), or one
 * of today's Reminders (`trick` null: core's).
 */
export type TodayRowView = { id: string; text: string; trick: string | null; accent: string | null; href: string | null }

/** A Document for Home's "Recent documents" strip (filled by the Documents slot once core has `documentsView`). */
export type RecentDocumentView = {
  id: string
  /** "lease", "notice", "receipt", ... as core's Documents name them. */
  kind: string
  title: string
  /** The day it was kept, "YYYY-MM-DD" in the Group's time zone (lib/dates localDay). */
  createdAt: string
  href: string
}

/** One Trick's card on the Tricks page and its detail sheet, from the Toolkit's manifest and this Group's state. */
export type ToolkitCardView = {
  id: string
  name: string
  summary: string
  longDescription: string
  /** Rendered on the server (components/app/toolkit-icon.tsx). */
  icon: ReactNode
  status: ToolkitStatus
  enabled: boolean
  /** What it can do, in plain words (one per tool). */
  abilities: string[]
  /** Things to say in the chat (the Gate's examples). */
  examples: string[]
  requirements: { label: string; ok: boolean; detail?: string; blocking: boolean }[]
  /** Its dashboard page, when it has one. */
  href: string | null
  /** Unmet requirements that keep it from going on. */
  blocked: string[]
}

/* ---------- Lease Inbox (#27) ---------- */

export type InboxTab = "notices" | "rent" | "work-orders" | "other" | "new-senders"

/** One email or one thing Roomie sent, in a thread on the Inbox page. */
export type InboxItemView = {
  id: string
  direction: "in" | "out"
  from: string
  subject: string
  summary: string | null
  text: string
  at: string
  when: string
  documents: { id: string; href: string }[]
}

/** A thread on the Inbox page: its newest email decides the tab; `canReply` = the landlord wrote in it. */
export type InboxThreadView = {
  threadId: string
  tab: InboxTab
  subject: string
  from: string
  summary: string | null
  when: string
  at: string
  canReply: boolean
  workOrder: { title: string; status: string; scheduledFor: string | null; reportedBy: string | null } | null
  items: InboxItemView[]
}

export type InboxView = {
  address: string | null
  senders: { value: string; source: string }[]
  threads: InboxThreadView[]
  counts: Record<InboxTab, number>
}