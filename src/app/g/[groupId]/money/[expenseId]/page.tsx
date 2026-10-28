import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { money } from "@/services"
import { expenseView } from "../../_components/data"
import { ExpenseDetailScreen } from "../../_components/screens/expense-detail"

type Props = { params: Promise<{ groupId: string; expenseId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { groupId, expenseId } = await params
  const s = await currentMember(groupId)
  return { title: (await money.getExpense(s.ctx, expenseId))?.description ?? "Expense" }
}

export default async function ExpensePage({ params }: Props) {
  const { groupId, expenseId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  const e = await money.getExpense(s.ctx, expenseId)
  return <ExpenseDetailScreen expense={e && !e.deletedAt ? expenseView(s, e) : null} />
}
