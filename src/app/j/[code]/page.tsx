import type { Metadata } from "next"
import { notFound, redirect } from "next/navigation"

import { signInPath } from "@/lib/auth/oauth-paths"
import { currentAccount } from "@/lib/session"
import { joins } from "@/services"
import { SeatPicker } from "./seat-picker"

// The code is a shared secret: never indexed, never sent on as a Referer.
export const metadata: Metadata = { title: "Join your group", robots: { index: false, follow: false }, referrer: "no-referrer" }
export const dynamic = "force-dynamic"

/**
 * A Group's Join link (ADR 0014, docs/joining.md). Signed out: sign in with Google first (nothing about the Group is
 * shown before that). Signed in: "Which one are you?" over the open seats; an Account already in the Group goes
 * straight to it. A rotated or unknown code is a 404.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  if (!joins.isJoinCode(code)) notFound()
  const account = await currentAccount()
  if (!account) redirect(signInPath(`/j/${code}`))
  const picker = await joins.pickerFor(code, account.id)
  if (!picker) notFound()
  if (picker.mine && picker.mine.status !== "removed") redirect(`/g/${picker.group.id}`)
  return <SeatPicker code={code} group={picker.group} seats={picker.seats} adminsOpen={picker.adminsOpen} declined={!!picker.mine} email={account.email} />
}
