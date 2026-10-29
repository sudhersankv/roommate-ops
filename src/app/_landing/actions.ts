"use server"

import { headers } from "next/headers"
import { after } from "next/server"

import { telegramChannel } from "@/channels/telegram-boot"
import { submitBetaRequest, type BetaField } from "@/services/beta"
import { voteForTrick } from "@/services/trick-votes"

export type BetaFormState =
  | { status: "idle" }
  | { status: "ok" }
  | { status: "error"; message?: string; errors?: Partial<Record<BetaField, string>>; values: Record<string, string> }

const clientIp = (h: Headers) => h.get("fly-client-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "unknown"

export type TrickVoteState = { status: "ok"; counted: boolean } | { status: "error"; message: string }

/** "I want this" on a coming-soon Trick card. Limits and storing are the service's. */
export async function voteTrick(trickId: string): Promise<TrickVoteState> {
  const res = await voteForTrick(trickId, { ip: clientIp(await headers()) })
  return res.ok ? { status: "ok", counted: res.counted } : { status: "error", message: res.message }
}

/** The landing page's WhatsApp beta form. Everything (validation, limits, storing, telling the operator) is the service's. */
export async function requestBeta(_prev: BetaFormState, form: FormData): Promise<BetaFormState> {
  const h = await headers()
  const ip = clientIp(h)
  const values: Record<string, string> = {}
  for (const [k, v] of form.entries()) if (typeof v === "string") values[k] = v

  const tg = telegramChannel()
  const res = await submitBetaRequest(
    values,
    { ip, userAgent: h.get("user-agent") },
    { telegram: tg ? (id, out) => tg.sendPrivate(id, out) : null, later: (task) => after(task) },
  )
  if (res.ok) return { status: "ok" }
  delete values.website
  return res.reason === "invalid" ? { status: "error", errors: res.errors, values } : { status: "error", message: res.message, values }
}
