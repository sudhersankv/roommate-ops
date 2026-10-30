"use server"

import { revalidatePath } from "next/cache"

import { currentOperator } from "@/lib/operator"
import { leaveGroupChat, setGroupPaused } from "@/services/operator-groups"

export type GroupAction = "pause" | "resume" | "leave"

/** /admin/groups: pause, resume, or leave a Group's Chat. Operators only (anyone else: the same answer as a missing Group). */
export async function groupAction(groupId: string, action: GroupAction): Promise<{ ok: boolean; error?: string }> {
  const op = await currentOperator()
  if (!op) return { ok: false, error: "Not found." }
  if (!["pause", "resume", "leave"].includes(action)) return { ok: false, error: "Unknown action." }
  console.log(`[admin] ${op.email}: ${action} ${groupId}`)
  try {
    const done = action === "leave" ? await leaveGroupChat(op, groupId) : await setGroupPaused(op, groupId, action === "pause")
    if (!done) return { ok: false, error: "That group is gone." }
  } catch (e) {
    console.error(`[admin] ${action} ${groupId} failed`, e)
    return { ok: false, error: e instanceof Error ? e.message : "Something went wrong." }
  }
  revalidatePath("/admin/groups")
  return { ok: true }
}
