import type { Metadata } from "next"

import { MoneyScreen } from "../../../_components/screens/money"

export const metadata: Metadata = { title: "Money" }

const tabs = ["balances", "expenses", "activity"] as const

export default async function MoneyPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams
  const initialTab = tabs.find((t) => t === tab) ?? "balances"
  return <MoneyScreen key={initialTab} initialTab={initialTab} />
}
