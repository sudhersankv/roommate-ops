import type { Metadata } from "next"
import { notFound } from "next/navigation"

import { RoomieAvatar } from "@/components/app/roomie-avatar"
import { currentOperator } from "@/lib/operator"
import { WhatsAppPanel } from "./panel"

export const metadata: Metadata = { title: "WhatsApp", robots: { index: false, follow: false, nocache: true } }
export const dynamic = "force-dynamic"

/** The operator's page for Roomie's WhatsApp number: link it (QR or pairing code), see who it is, log it out. */
export default async function WhatsAppAdminPage() {
  if (!(await currentOperator())) notFound()
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-6 py-10">
      <header className="flex items-center gap-3">
        <RoomieAvatar size={40} />
        <div>
          <h1 className="type-title m-0">WhatsApp</h1>
          <p className="type-caption text-muted-foreground">Roomie&apos;s number on this server. Only operators see this page.</p>
        </div>
      </header>
      <WhatsAppPanel />
    </main>
  )
}
