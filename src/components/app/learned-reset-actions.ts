"use server"

// The one write behind Settings -> "Reset what it's learned" (ADR 0020 keeps it for Admins). Same rules as
// g/[groupId]/actions.ts: re-read the session, call the service as the signed-in Member (it checks Admin), revalidate.
import { revalidatePath } from "next/cache"

import { memberSession } from "@/lib/session"
import { isNotAllowed, personality } from "@/services"

export type ResetLearnedResult = { ok: true; messagesSeen: number } | { ok: false; error: string; status: number }

export async function resetLearnedStyle(groupId: string): Promise<ResetLearnedResult> {
  const session = await memberSession(groupId)
  if (!session) return { ok: false, error: "Sign in again to do that.", status: 401 }
  try {
    const p = await personality.resetLearned(session.ctx)
    revalidatePath(`/g/${groupId}`, "layout")
    return { ok: true, messagesSeen: p.learned.messagesSeen }
  } catch (e) {
    if (!isNotAllowed(e)) console.error("[learned reset]", e)
    return { ok: false, error: e instanceof Error ? e.message : String(e), status: isNotAllowed(e) ? 403 : 400 }
  }
}
