"use server"

// The dashboard's writes. Each one re-reads the session (never trusts the client), calls a service as the signed-in
// Member, and revalidates the Group's pages. Permission refusals come back as { ok: false, status: 403 }.
import { revalidatePath } from "next/cache"

import type { JoinPolicy, PaymentApp } from "@/db/schema"
import { InstacartUnavailableError } from "@/integrations/instacart"
import { memberSession } from "@/lib/session"
import { parseInZone } from "@/lib/time"
import { cart, chores, dock, groups, isNotAllowed, joins, members, money, pantry, recipes, reminders, schedule, splitwise, toolkits, upkeep, type Ctx } from "@/services"
import type { SettingsPatch } from "@/services/groups"
import { releaseInbox, removeSender, sendForMember } from "@/services/lease-inbox-toolkit"
import { setRent, type RentInput } from "@/services/rent"
import { mute as muteRestock, restockAddListed } from "@/services/restock"
import { updateNudgeSettings, type NudgeSettings } from "@/services/settle-nudge"
import * as usuals from "@/services/usuals"
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
  // Only our own Documents can be attached from the dashboard (/api/docs/<id>, ADR 0018); the service checks the Group.
  receiptUrl: input.receiptUrl && /^\/api\/docs\/[0-9a-f-]{36}$/i.test(input.receiptUrl) ? input.receiptUrl : null,
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

/** The Add box: the same add path as cart_add (usuals, one question for something unclear). */
export async function addCartItem(groupId: string, input: { name: string; qty?: string; shared: boolean }) {
  return act(groupId, async (ctx) => {
    const r = await cart.addAsSaid(ctx, { items: [{ name: input.name, qty: input.qty }], shared: input.shared })
    return { id: r.added[0]?.id ?? null, usual: r.usedUsual[0] ?? null, question: r.needsClarification[0] ?? null }
  })
}

/** Edit a usual on the Cart page: a row is changed; one derived from history (no id) is pinned as a row. */
export async function updateUsual(groupId: string, input: { id: string | null; name: string; qty: string; scope: "mine" | "shared" }) {
  return act(groupId, async (ctx) =>
    (input.id ? await usuals.updateUsual(ctx, { id: input.id, name: input.name, qty: input.qty }) : await usuals.pinUsual(ctx, { name: input.name, qty: input.qty, shared: input.scope === "shared" })).id
  )
}

export async function removeUsual(groupId: string, id: string) {
  return act(groupId, (ctx) => usuals.removeUsual(ctx, { id }))
}

export async function removeCartItem(groupId: string, itemId: string) {
  return act(groupId, (ctx) => cart.removeItemById(ctx, { id: itemId }))
}

/** "Probably low" -> Add: that one item into the Cart, shared or as the viewer's own (what restock listed). */
export async function addProbablyLow(groupId: string, item: string, scope: "shared" | "mine") {
  return act(groupId, (ctx) => restockAddListed(ctx, scope === "mine" ? "mine" : "shared", { only: [item] }))
}

/** "Probably low" -> Mute: "we don't buy that anymore". */
export async function muteProbablyLow(groupId: string, item: string) {
  return act(groupId, async (ctx) => (await muteRestock(ctx, item)).item)
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

export async function skipUpkeep(groupId: string, itemId: string) {
  return act(groupId, (ctx) => upkeep.skipUpkeep(ctx, { id: itemId }))
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

/** `at` is the Group's local wall-clock ("2026-11-03T20:00"); `justMe` sends it to the signed-in Member privately. */
export async function addReminder(groupId: string, input: { text: string; at: string; justMe: boolean; repeat: "daily" | "weekly" | "monthly" | null }) {
  return act(groupId, async (ctx) => {
    const tz = await schedule.groupTimezone(ctx.groupId)
    const r = await reminders.setReminder(ctx, { text: input.text, dueAt: parseInZone(input.at, tz), memberId: input.justMe ? ctx.memberId : undefined, recurring: input.repeat })
    return { text: r.text, when: r.when }
  })
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

/* ---------- Joining (ADR 0014; services/joins.ts checks the Admin) ---------- */

export async function rotateJoinLink(groupId: string) {
  return act(groupId, async (ctx) => (await joins.rotateJoinCode(ctx)).url)
}

export async function setJoinPolicy(groupId: string, policy: JoinPolicy) {
  return act(groupId, (ctx) => joins.setJoinPolicy(ctx, { policy }))
}

export async function revokeSeat(groupId: string, memberId: string) {
  return act(groupId, async (ctx) => (await joins.revokeSeat(ctx, { memberId })).displayName)
}

export async function reassignSeat(groupId: string, fromMemberId: string, toMemberId: string) {
  return act(groupId, async (ctx) => (await joins.reassignSeat(ctx, { fromMemberId, toMemberId })).displayName)
}

export async function setPaymentHandles(groupId: string, handles: Partial<Record<PaymentApp, string>>) {
  return act(groupId, async (ctx) => (await members.setPaymentHandles(ctx, handles)).handles ?? {})
}

/** Your own dock's two Tricks, left then right (the More drawer's edit mode); [] = back to the default. */
export async function saveDock(groupId: string, tricks: string[]) {
  return act(groupId, async (ctx) => (await dock.setDock(ctx, { tricks: Array.isArray(tricks) ? tricks.map(String) : [] })).dock)
}

export async function updateSettings(groupId: string, patch: SettingsPatch) {
  return act(groupId, async (ctx) => (await groups.updateGroupSettings(ctx, patch)).group.name)
}

/** Marketplace and Settings switches. Switching one on runs its hook, records Activity and posts one line in the Chat. */
export async function setToolkit(groupId: string, toolkit: ToolkitId, enabled: boolean) {
  return act(groupId, async (ctx) => {
    const res = await toolkits.setToolkit(ctx, { toolkit, enabled })
    return { name: res.name, enabled: res.enabled, changed: res.changed }
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

/** The Rent card's form: the amount, the due day, who pays the landlord, and evenly or per-person amounts (as typed). */
export type RentForm = Pick<RentInput, "cents" | "dueDay" | "payerId"> & { method: "equal" | "exact"; splits?: { memberId: string; cents: number }[] }

export async function saveRent(groupId: string, input: RentForm) {
  return act(groupId, async (ctx) => {
    const rent = await setRent(ctx, {
      cents: input.cents,
      dueDay: input.dueDay,
      payerId: input.payerId,
      method: input.method,
      ...(input.method === "exact" ? { splits: input.splits } : {}),
    })
    return rent.expenseId
  })
}

export async function updateNudges(groupId: string, patch: Partial<NudgeSettings>) {
  return act(groupId, (ctx) => updateNudgeSettings(ctx, patch))
}

/* ---------- Lease Inbox (#27) ---------- */

/**
 * The Inbox page's reply box: the same send rule and signature as the chat (sendForMember). A complex draft comes back
 * as `{ sent: false, ask, confirmToken }` and the screen shows the questions as a confirm step; "Send anyway" sends
 * the token back, which releases only the send the service held for this Member and this exact draft.
 */
export async function replyToLandlord(groupId: string, input: { threadId: string; body: string; confirmToken?: string }) {
  return act(groupId, async (ctx) => {
    const body = input.body.trim()
    if (!body) throw new Error("Write something to send.")
    const approval = typeof input.confirmToken === "string" && input.confirmToken ? { token: input.confirmToken } : undefined
    const r = await sendForMember({ ...ctx, source: "ui" }, { intent: "reply", threadId: input.threadId, body, instruction: body, summary: `replied: ${body.length > 60 ? `${body.slice(0, 57)}...` : body}`, approval })
    return r.sent ? { sent: true as const, line: r.line } : { sent: false as const, ask: r.ask, confirmToken: r.confirmToken ?? null }
  })
}

export async function removeLandlordSender(groupId: string, value: string) {
  return act(groupId, (ctx) => removeSender(ctx, value))
}

export async function releaseLeaseInbox(groupId: string) {
  return act(groupId, (ctx) => releaseInbox(ctx))
}