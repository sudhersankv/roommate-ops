"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { currentAccount } from "@/lib/session"
import { joins } from "@/services"

export type PickState = { status: "idle" } | { status: "pending"; groupId: string; name: string } | { status: "error"; message: string }

const clientIp = (h: Headers) => h.get("fly-client-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown"

/**
 * A pick on the seat picker (ADR 0014). The signed-in Account comes from the session, never the form; the code and
 * seat are only what the person chose, and services/joins.ts checks both (and the rate limits) again.
 */
export async function pickSeat(_prev: PickState, form: FormData): Promise<PickState> {
  const account = await currentAccount()
  if (!account) return { status: "error", message: "Sign in again, then pick your name." }
  const code = String(form.get("code") ?? "")
  const seat = String(form.get("seat") ?? "")
  if (!seat) return { status: "error", message: "Pick your name first." }
  let result: Awaited<ReturnType<typeof joins.claimSeat>>
  try {
    result = await joins.claimSeat(code, account, seat === "none" ? null : seat, { ip: clientIp(await headers()) })
  } catch (e) {
    if (e instanceof joins.JoinError) return { status: "error", message: e.message }
    console.error("[join] pick failed", e)
    return { status: "error", message: "That didn't go through. Try again in a minute." }
  }
  if (result.kind !== "pending") redirect(`/g/${result.groupId}`)
  return { status: "pending", groupId: result.groupId, name: result.memberName }
}
