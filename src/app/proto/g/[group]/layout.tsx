import type { ReactNode } from "react"
import { notFound } from "next/navigation"

import { group } from "../../_data"
import { AppShell } from "../../_components/shell"
import { StoreProvider } from "../../_lib/store"

export default async function GroupLayout({ children, params }: { children: ReactNode; params: Promise<{ group: string }> }) {
  const { group: slug } = await params
  if (slug !== group.slug) notFound()
  return (
    <StoreProvider>
      <AppShell>{children}</AppShell>
    </StoreProvider>
  )
}
