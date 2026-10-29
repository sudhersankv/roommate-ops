"use server"

// The dashboard's writes. Each one re-reads the session (never trusts the client), calls a service as the signed-in
// Member, and revalidates the Group's pages. Permission refusals come back as { ok: false, status: 403 }.
import { revalidatePath } from "next/cache"

import type { PaymentApp } from "@/db/schema"
import { InstacartUnavailableError } from "@/integrations/instacart"
import { memberSession } from "@/lib/session"
import { cart, chores, groups, isNotAllowed, members, money, pantry, recipes, reminders, schedule, splitwise, toolkits, upkeep, type Ctx } from "@/services"
import type { SettingsPatch } from "@/services/groups"
import type { ToolkitId } from "@/toolkits/types"
import type { ActionResult } from "./_components/group-context"
import type { RecipeDraftView } from "./_components/types"

async function act<T>(groupId: string, fn: (ctx: Ctx) => Promise<T>): Promise<ActionResult<T>> {
  const session = await memberSession(groupId)
  if (!session) return { ok: false, error: "Sign in again to do that.", status: 401 }
  try {
    const data = await fn(session.ctx)
    revalidatePath(`/g/${groupId}`, "layout")
    return { ok: true, data }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (!isNotAllowed(e) && !(e instanceof toolkits.ToolkitUnavailableError)) console.error("[action]", e)
    return { ok: false, error: message, status: isNotAllowed(e) ? 403 : 400 }
  }
}

/** What the drawer sends: the intent per method (percents, shares, exact cents typed per person), never derived cents. */
export type ExpenseForm = Pick<
  money.ExpenseInput,
  "cents" | "description" | "method" | "splitAmong" | "splits" | "percents" | "shares" | "payers" | "category" | "note" | "occurredOn" | "recurring" | "receiptUrl"
>

const clean = (input: ExpenseForm): ExpenseForm => ({
  cents: input.cents,
  description: input.description,
  method: input.method,
  ...(input.method === "equal" ? { splitAmong: input.splitAmong } : {}),
  ...(input.method === "exact" ? { splits: input.splits } : {}),
  ...(input.method === "percent" ? { percents: input.percents } : {}),
  ...(input.method === "shares" ? { shares: input.shares } : {}),
  payers: input.payers,
  category: input.category,
  note: input.note ?? null,
  occurredOn: input.occurredOn,
  recurring: input.recurring ?? null,
  // Only our own uploads can be attached from the dashboard.
  receiptUrl: input.receiptUrl && /^\/uploads\/[a-z0-9-]+\/[a-z0-9-]+\.[a-z]+$/i.test(input.receiptUrl) ? input.receiptUrl : null,
})

export async function addExpense(groupId: string, input: ExpenseForm) {
  return act(groupId, async (ctx) => (await money.logExpense(ctx, { ...clean(input), source: "ui" })).id)
}

export async function updateExpense(groupId: string, expenseId: string, input: ExpenseForm) {
  return act(groupId, async (ctx) => {
    const { receiptUrl, ...rest } = clean(input)
    return (await money.updateExpense(ctx, { expenseId, ...rest, ...(receiptUrl ? { receiptUrl } : {}) })).id
  })
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

export async function addCartItem(groupId: string, input: { name: string; qty?: string; shared: boolean }) {
  return act(groupId, async (ctx) => (await cart.addItems(ctx, { items: [{ name: input.name, qty: input.qty }], shared: input.shared }))[0].id)
}

export async function removeCartItem(groupId: string, itemId: string) {
  return act(groupId, (ctx) => cart.removeItemById(ctx, { id: itemId }))
}

export async function purchaseCart(groupId: string, totalCents: number) {
  return act(groupId, async (ctx) => (await cart.markPurchased(ctx, { totalCents })).id)
}

/** The Instacart shopping list for the open Cart; `url` is null (with `unavailable`) when Instacart can't be reached. */
export async function checkoutCart(groupId: string) {
  return act(groupId, async (ctx) => {
    const c = await cart.checkout(ctx)
    return { url: c.url, unavailable: c.unavailable ?? null, itemCount: c.itemCount }
  })
}

/* ---------- Recipes and the Pantry ---------- */

export async function draftRecipe(groupId: string, input: { request: string; servings?: number }): Promise<ActionResult<RecipeDraftView>> {
  return act(groupId, async (ctx) => {
    const { draft, have, need } = await recipes.draftRecipe(ctx, input)
    return { ...draft, have: have.map((i) => i.name), need: need.map((i) => i.name) }
  })
}

/** Save a drafted Recipe, and optionally put its missing ingredients in the Cart. Returns the Recipe id. */
export async function saveRecipe(groupId: string, draft: RecipeDraftView, opts: { addToCart?: boolean } = {}) {
  return act(groupId, async (ctx) => {
    const saved = await recipes.saveRecipe(ctx, { title: draft.title, servings: draft.servings, cookingTimeMinutes: draft.cookingTimeMinutes, ingredients: draft.ingredients, steps: draft.steps, source: "roomie" })
    const added = opts.addToCart ? (await recipes.addRecipeToCart(ctx, saved.id)).added.length : 0
    return { id: saved.id, added }
  })
}

export async function addRecipeToCart(groupId: string, recipeId: string, skip: string[] = []) {
  return act(groupId, async (ctx) => (await recipes.addRecipeToCart(ctx, recipeId, { skip })).added.length)
}

export async function recipeInstacartLink(groupId: string, recipeId: string) {
  return act(groupId, async (ctx) => {
    try {
      return { url: (await recipes.recipeLink(ctx, recipeId)).url as string | null, unavailable: null as string | null }
    } catch (e) {
      if (e instanceof InstacartUnavailableError) return { url: null, unavailable: e.message }
      throw e
    }
  })
}

export async function updatePantry(groupId: string, change: { add?: string[]; remove?: string[] }) {
  return act(groupId, (ctx) => pantry.updatePantry(ctx, change))
}

/* ---------- Chores, Upkeep, Reminders ---------- */

export async function markChoreDone(groupId: string, choreId: string) {
  return act(groupId, (ctx) => chores.logChore(ctx, { choreId }))
}

export async function skipChore(groupId: string, choreId: string) {
  return act(groupId, (ctx) => chores.skipChore(ctx, { choreId }))
}

/** `rotation`: member ids in turn order; empty = everyone, least recent first. */
export async function addChore(groupId: string, input: { name: string; everyDays: number; rotation: string[] }) {
  return act(groupId, (ctx) => chores.addChore(ctx, input))
}

export async function removeChore(groupId: string, choreId: string) {
  return act(groupId, (ctx) => chores.removeChore(ctx, { choreId }))
}

export async function markUpkeepDone(groupId: string, itemId: string) {
  return act(groupId, (ctx) => upkeep.markDone(ctx, { id: itemId }))
}

export async function addUpkeep(groupId: string, input: { item: string; everyDays: number }) {
  return act(groupId, (ctx) => upkeep.addMaintenance(ctx, input))
}

export async function addUpkeepDefaults(groupId: string) {
  return act(groupId, (ctx) => upkeep.addDefaults(ctx))
}

export async function removeUpkeep(groupId: string, itemId: string) {
  return act(groupId, (ctx) => upkeep.removeMaintenance(ctx, { id: itemId }))
}

export async function cancelReminder(groupId: string, reminderId: string) {
  return act(groupId, (ctx) => reminders.cancelReminder(ctx, { reminderId }))
}

export async function updateSchedule(groupId: string, patch: Partial<schedule.Schedule>) {
  return act(groupId, (ctx) => schedule.updateSchedule(ctx, patch))
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

/** Marketplace and Settings switches. Switching one on runs its hook, records Activity and posts one line in the Chat. */
export async function setToolkit(groupId: string, toolkit: ToolkitId, enabled: boolean) {
  return act(groupId, async (ctx) => {
    const res = await toolkits.setToolkit(ctx, { toolkit, enabled })
    return { name: res.name, enabled: res.enabled, changed: res.changed, tryThis: res.tryThis ?? null }
  })
}

export async function deleteGroupData(groupId: string) {
  return act(groupId, (ctx) => groups.deleteGroupData(ctx))
}

export async function setSimplifyDebts(groupId: string, on: boolean) {
  return act(groupId, (ctx) => groups.setSimplifyDebts(ctx, { on }))
}

/* ---------- Splitwise (Admins; services/splitwise.ts checks) ---------- */

/** "Not connected" is a normal answer here, not a crash: it comes back as the error text. */
async function sw<T>(groupId: string, fn: (ctx: Ctx) => Promise<T>) {
  return act(groupId, async (ctx) => {
    try {
      return await fn(ctx)
    } catch (e) {
      if (e instanceof splitwise.SplitwiseNotConnectedError) throw new Error(e.message)
      throw e
    }
  })
}

export async function connectSplitwise(groupId: string) {
  return sw(groupId, (ctx) => splitwise.connectSplitwise(ctx))
}

export async function listSplitwiseGroups(groupId: string) {
  return sw(groupId, (ctx) => splitwise.listSplitwiseGroups(ctx))
}

export async function importSplitwise(groupId: string, splitwiseGroupId: string) {
  return sw(groupId, (ctx) => splitwise.importSplitwiseGroup(ctx, { splitwiseGroupId }))
}

export async function exportSplitwise(groupId: string, splitwiseGroupId?: string) {
  return sw(groupId, (ctx) => splitwise.exportToSplitwise(ctx, { splitwiseGroupId }))
}

export async function setSplitwiseMirror(groupId: string, on: boolean, splitwiseGroupId?: string) {
  return sw(groupId, (ctx) => splitwise.setSplitwiseMirror(ctx, { on, splitwiseGroupId }))
}

export async function disconnectSplitwise(groupId: string) {
  return sw(groupId, (ctx) => splitwise.disconnectSplitwise(ctx))
}
