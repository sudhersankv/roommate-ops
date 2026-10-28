// Plain shapes the server pages hand to the client screens (dates as "YYYY-MM-DD" in the Group's time zone).
import type { Category } from "@/components/app/categories"
import type { Recurrence, SplitMethod } from "@/db/enums"

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
  receiptUrl: string | null
  inSplitwise: boolean
  source: string
  canChange: boolean
}

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

export type CartItemView = { id: string; name: string; qty?: string; addedBy: string; shared: boolean; estCents: number }

export type ChoreView = {
  id: string
  name: string
  cadence: string
  turn: string | null
  due: string
  streak: number
  lastDone?: { by: string; date: string }
}

export type UpkeepView = { id: string; name: string; every: string; due: string; lastDone?: string }
