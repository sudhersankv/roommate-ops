import { Car, HeartPulse, House, Plane, Popcorn, ReceiptText, ShoppingBasket, SprayCan, UtensilsCrossed, Zap, type LucideIcon } from "lucide-react"

import type { ExpenseCategory } from "@/db/enums"

export type Category = ExpenseCategory

export const categories: { value: Category; label: string; icon: LucideIcon }[] = [
  { value: "food", label: "Eating out", icon: UtensilsCrossed },
  { value: "groceries", label: "Groceries", icon: ShoppingBasket },
  { value: "rent", label: "Rent", icon: House },
  { value: "utilities", label: "Utilities", icon: Zap },
  { value: "household", label: "Around the house", icon: SprayCan },
  { value: "transport", label: "Getting around", icon: Car },
  { value: "entertainment", label: "Fun", icon: Popcorn },
  { value: "travel", label: "Travel", icon: Plane },
  { value: "health", label: "Health", icon: HeartPulse },
  { value: "other", label: "Other", icon: ReceiptText },
]

export const categoryOf = (c: Category) => categories.find((x) => x.value === c) ?? categories[categories.length - 1]
