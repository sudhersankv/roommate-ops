import { cn } from "cn"
import { Car, Popcorn, ShoppingBasket, SprayCan, UtensilsCrossed, Zap, type LucideIcon } from "lucide-react"

import type { Category } from "../_data"
import { formatMoney } from "../_lib/money"

export const categories: { value: Category; label: string; icon: LucideIcon }[] = [
  { value: "groceries", label: "Groceries", icon: ShoppingBasket },
  { value: "utilities", label: "Utilities", icon: Zap },
  { value: "dining", label: "Eating out", icon: UtensilsCrossed },
  { value: "household", label: "Household", icon: SprayCan },
  { value: "fun", label: "Fun", icon: Popcorn },
  { value: "transport", label: "Getting around", icon: Car },
]

export const categoryOf = (c: Category) => categories.find((x) => x.value === c) ?? categories[0]

export function CategoryIcon({ category, className }: { category: Category; className?: string }) {
  const Icon = categoryOf(category).icon
  return (
    <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-foreground", className)} aria-hidden>
      <Icon className="size-5" />
    </span>
  )
}

/** A money amount in tabular figures. `tone` colors it as owed (green) or owe (amber). */
export function Amount({
  cents,
  tone = "plain",
  sign = false,
  className,
}: {
  cents: number
  tone?: "plain" | "owed" | "owe" | "auto"
  sign?: boolean
  className?: string
}) {
  const t = tone === "auto" ? (cents > 0 ? "owed" : cents < 0 ? "owe" : "plain") : tone
  return (
    <span className={cn("money", t === "owed" && "text-owed", t === "owe" && "text-owe", className)}>
      {formatMoney(tone === "auto" && !sign ? Math.abs(cents) : cents, "USD", { sign })}
    </span>
  )
}
