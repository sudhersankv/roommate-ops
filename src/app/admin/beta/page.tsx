import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { RoomieAvatar } from "@/components/app/roomie-avatar"
import { currentOperator } from "@/lib/operator"
import { listBetaRequests } from "@/services/beta"
import { BetaList } from "./list"

export const metadata: Metadata = { title: "Beta requests", robots: { index: false, follow: false, nocache: true } }
export const dynamic = "force-dynamic"

/** The operator's list of WhatsApp beta requests from the landing page, newest first, with a status per request. */
export default async function BetaAdminPage() {
  const op = await currentOperator()
  if (!op) notFound()
  const rows = await listBetaRequests(op)
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center gap-3">
        <RoomieAvatar size={40} />
        <div>
          <h1 className="type-title m-0">Beta requests</h1>
          <p className="type-caption text-muted-foreground">
            {rows.length === 0 ? "None yet." : `${rows.length} from the landing page, ${rows.filter((r) => r.status === "new").length} new.`} Only operators see this page.
          </p>
        </div>
      </header>
      <BetaList
        rows={rows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          name: r.name,
          email: r.email,
          groupSize: r.groupSize,
          purpose: r.purpose,
          phone: r.phone,
          notes: r.notes,
          status: r.status,
        }))}
      />
    </main>
  )
}
