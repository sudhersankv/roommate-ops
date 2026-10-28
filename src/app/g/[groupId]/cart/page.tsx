import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { cartPageView } from "../_components/data"
import { CartScreen } from "../_components/screens/cart"

export const metadata: Metadata = { title: "Cart" }

export default async function CartPage({ params, searchParams }: { params: Promise<{ groupId: string }>; searchParams: Promise<{ recipe?: string }> }) {
  const [{ groupId }, { recipe }] = await Promise.all([params, searchParams])
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  return <CartScreen view={await cartPageView(s)} openRecipeId={recipe ?? null} />
}
