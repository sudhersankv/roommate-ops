import type { Metadata } from "next"

import { currentMember } from "@/lib/session"
import { cartView } from "../_components/data"
import { CartScreen } from "../_components/screens/cart"

export const metadata: Metadata = { title: "Cart" }

export default async function CartPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params
  const s = await currentMember(groupId)
  if (s.member.status !== "active") return null
  return <CartScreen items={await cartView(s)} />
}
