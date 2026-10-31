import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { activityView, balancesView, expensesView, rentCardView } from "../_components/data"
import { MoneyScreen, type MoneyTab } from "../_components/screens/money"

export const metadata: Metadata = { title: "Money" }

const tabs: MoneyTab[] = ["balances", "expenses", "activity"]

export default async function MoneyPage({ params, searchParams }: { params: Promise<{ groupId: string }>; searchParams: Promise<{ tab?: string }> }) {
  const [{ groupId }, { tab }] = await Promise.all([params, searchParams])
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const initialTab = tabs.find((t) => t === tab) ?? "balances"
  const [money, expenses, activity, rent] = await Promise.all([balancesView(s), expensesView(s), activityView(s), rentCardView(s)])
  return <MoneyScreen key={initialTab} initialTab={initialTab} {...money} expenses={expenses} activity={activity} rent={rent} />
}
