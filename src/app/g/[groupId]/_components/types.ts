// Plain shapes the server pages hand to the client screens (dates as "YYYY-MM-DD" in the Group's time zone).
import type { Category } from "@/components/app/categories"

export type Transfer = { from: string; to: string; cents: number }

export type ExpenseView = {
  id: string
  description: string
  category: Category
  date: string
  cents: number
  payers: { memberId: string; cents: number }[]
  shares: { memberId: string; cents: number }[]
  yourShare: number
  youPaid: number
  addedBy: string | null
  /** Shares aren't one equal split (a Cart purchase, or step 5's exact/percent splits). */
  uneven: boolean
  canChange: boolean
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
