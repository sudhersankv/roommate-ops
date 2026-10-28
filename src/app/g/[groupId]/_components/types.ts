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

export type CartPageView = {
  items: CartItemView[]
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
  turn: string | null
  due: string
  streak: number
  lastDone?: { by: string; date: string }
}

export type UpkeepView = { id: string; name: string; every: string; due: string; lastDone?: string }
