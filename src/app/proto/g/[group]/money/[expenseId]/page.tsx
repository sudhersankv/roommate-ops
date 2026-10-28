import type { Metadata } from "next"

import { expenses } from "../../../../_data"
import { ExpenseDetailScreen } from "../../../../_components/screens/expense-detail"

type Props = { params: Promise<{ group: string; expenseId: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { expenseId } = await params
  return { title: expenses.find((e) => e.id === expenseId)?.description ?? "Expense" }
}

export default async function ExpensePage({ params }: Props) {
  const { expenseId } = await params
  return <ExpenseDetailScreen id={expenseId} />
}
