import type { Metadata } from "next"

import { DesignSystem } from "./design-system"

export const metadata: Metadata = { title: "Design system" }

export default function DesignPage() {
  return <DesignSystem />
}
