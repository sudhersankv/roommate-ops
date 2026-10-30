"use client"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { authClient } from "@/lib/auth/client"

/** A plain "Sign out" link for places that aren't the dashboard (the landing footer). Lands on `next` afterwards. */
export function SignOutLink({ className, next = "/" }: { className?: string; next?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      className={className}
      onClick={async () => {
        setBusy(true)
        await authClient.signOut().catch(() => {})
        router.push(next)
        router.refresh()
      }}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  )
}
