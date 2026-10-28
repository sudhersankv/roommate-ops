import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { DesignSystem } from "./design-system"

export const metadata: Metadata = { title: "Design system" }

// Dev only, unless SHOW_DESIGN_PAGE=1.
export default function DesignPage() {
  if (process.env.NODE_ENV === "production" && process.env.SHOW_DESIGN_PAGE !== "1") notFound()
  return <DesignSystem />
}
