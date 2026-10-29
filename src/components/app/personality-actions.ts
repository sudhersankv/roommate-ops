"use server"

// The Personality section's writes, kept next to it so the section can be mounted anywhere in Settings. Same rules
// as g/[groupId]/actions.ts: re-read the session, call the service as the signed-in Member (it checks Admin), and
// revalidate. Refusals come back as { ok: false, status: 403 }.
import { revalidatePath } from "next/cache"

import type { Personality, PersonalityPatch } from "@/lib/personality"
import { memberSession } from "@/lib/session"
import { isNotAllowed, personality } from "@/services"

export type PersonalityResult = { ok: true; data: Personality } | { ok: false; error: string; status: number }

async function act(groupId: string, fn: (ctx: { groupId: string; memberId: string; source: "ui" }) => Promise<Personality>): Promise<PersonalityResult> {
  const session = await memberSession(groupId)
  if (!session) return { ok: false, error: "Sign in again to do that.", status: 401 }
  try {
    const data = await fn({ groupId, memberId: session.member.id, source: "ui" })
    revalidatePath(`/g/${groupId}`, "layout")
    return { ok: true, data }
  } catch (e) {
    if (!isNotAllowed(e)) console.error("[personality action]", e)
    return { ok: false, error: e instanceof Error ? e.message : String(e), status: isNotAllowed(e) ? 403 : 400 }
  }
}

export async function savePersonality(groupId: string, patch: PersonalityPatch) {
  return act(groupId, (ctx) => personality.updatePersonality(ctx, patch))
}

export async function resetLearnedStyle(groupId: string) {
  return act(groupId, (ctx) => personality.resetLearned(ctx))
}
