"use server"

import { revalidatePath } from "next/cache"

import { BETA_STATUSES, type BetaStatus } from "@/db/enums"
import { currentOperator } from "@/lib/operator"
import { setBetaStatus } from "@/services/beta"

/** /admin/beta's status switch. Operators only (anyone else gets the same answer as a missing request). */
export async function changeBetaStatus(id: string, status: BetaStatus): Promise<{ ok: boolean; error?: string }> {
  const op = await currentOperator()
  if (!op) return { ok: false, error: "Not found." }
  if (!(BETA_STATUSES as readonly string[]).includes(status)) return { ok: false, error: "Unknown status." }
  const row = await setBetaStatus(op, id, status)
  if (!row) return { ok: false, error: "That request is gone." }
  revalidatePath("/admin/beta")
  return { ok: true }
}
