import type { Metadata } from "next"

import { CartScreen } from "../../../_components/screens/cart"

export const metadata: Metadata = { title: "Cart" }

export default function CartPage() {
  return <CartScreen />
}
