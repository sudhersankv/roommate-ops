"use server"

// The dashboard's writes. Each one re-reads the session (never trusts the client), calls a service as the signed-in
// Member, and revalidates the Group's pages. Permission refusals come back as { ok: false, status: 403 }.
import { revalidatePath } from "next/cache"

import type { PaymentApp } from "@/db/schema"
import { memberSession } from "@/lib/session"
import { cart, chores, groups, isNotAllowed, members, money, upkeep, type Ctx } from "@/services"
import type { SettingsPatch } from "@/services/groups"
import type { ToolkitId } from "@/toolkits/types"
import type { ActionResult } from "./_components/group-context"

async function act<T>(groupId: string, fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  const session = await memberSession(groupId)
  if (!session) return { ok: false, error: "Sign in again to do that.", status: 401 }
  try {
    const data = await fn(session.ctx)
    revalidatePath(`/g/${groupId}`, "layout")
    return { ok: true, data }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!isNotAllowed(e)) console.error("[action]", e)
    return { ok: false, error: message, status: isNotAllowed(e) ? 403 : 400 }
  }
}

type ExpenseForm = { cents: number; description: string; payerId: string; splitAmong: string[] }

export async function addExpense(groupId: string, input: ExpenseForm) {
  return act(groupId, async (ctx) => (await money.logExpense(ctx, { ...input, source: "ui" })).id)
}

export async function updateExpense(groupId: string, expenseId: string, input: ExpenseForm) {
  return act(groupId, async (ctx) => (await money.updateExpense(ctx, { expenseId, ...input })).id)
}

export async function deleteExpense(groupId: string, expenseId: string) {
  return act(groupId, (ctx) => money.deleteExpense(ctx, { expenseId }))
}

export async function restoreExpense(groupId: string, expenseId: string) {
  return act(groupId, (ctx) => money.restoreExpense(ctx, { expenseId }))
}

export async function recordSettlement(groupId: string, input: { fromId: string; toId: string; cents: number }) {
  return act(groupId, (ctx) => money.settleUp(ctx, input))
}

export async function addCartItem(groupId: string, input: { name: string; shared: boolean }) {
  return act(groupId, async (ctx) => (await cart.addItems(ctx, { items: [{ name: input.name }], shared: input.shared }))[0])
}

export async function removeCartItem(groupId: string, itemId: string) {
  return act(groupId, (ctx) => cart.removeItemById(ctx, { id: itemId }))
}

export async function purchaseCart(groupId: string, totalCents: number) {
  return act(groupId, async (ctx) => (await cart.markPurchased(ctx, { totalCents })).id)
}

export async function markChoreDone(groupId: string, choreId: string) {
  return act(groupId, (ctx) => chores.logChore(ctx, { choreId }))
}

export async function markUpkeepDone(groupId: string, itemId: string) {
  return act(groupId, (ctx) => upkeep.markDone(ctx, { item: "", id: itemId }))
}

export async function decideMember(groupId: string, memberId: string, decision: "approve" | "decline" | "promote") {
  return act(groupId, async (ctx) => {
    const fn = decision === "approve" ? members.approveMember : decision === "decline" ? members.declineMember : members.promoteMember
    return (await fn(ctx, { memberId })).displayName
  })
}

export async function setPaymentHandles(groupId: string, handles: Partial<Record<PaymentApp, string>>) {
  return act(groupId, async (ctx) => (await members.setPaymentHandles(ctx, handles)).handles ?? {})
}

export async function updateSettings(groupId: string, patch: SettingsPatch) {
  return act(groupId, async (ctx) => (await groups.updateGroupSettings(ctx, patch)).group.name)
}

export async function setToolkit(groupId: string, toolkit: ToolkitId, enabled: boolean) {
  return act(groupId, (ctx) => groups.setToolkit(ctx, { toolkit, enabled }))
}

export async function deleteGroupData(groupId: string) {
  return act(groupId, (ctx) => groups.deleteGroupData(ctx))
}
