"use client"

import { createContext, use } from "react"
import { cn } from "cn"

import { formatMoney } from "@/lib/money"
import { categoryOf, type Category } from "./categories"

export { categories, categoryOf, type Category } from "./categories"

/** The Group's currency for every Amount under it. */
export const CurrencyContext = createContext("USD")

export function useFormatMoney() {
  const currency = use(CurrencyContext)
  return (cents: number, opts: { sign?: boolean } = {}) => formatMoney(cents, currency, opts)
}

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
  const money = useFormatMoney()
  const t = tone === "auto" ? (cents > 0 ? "owed" : cents < 0 ? "owe" : "plain") : tone
  return (
    <span className={cn("money", t === "owed" && "text-owed", t === "owe" && "text-owe", className)}>
      {money(tone === "auto" && !sign ? Math.abs(cents) : cents, { sign })}
    </span>
  )
}
