// Server-side: services -> the plain shapes the screens render. No business rules here; the numbers come from
// services (balances, settle plan, shares, chores) and are only reshaped and dated in the Group's time zone.
import { localDay } from "@/lib/dates"
import type { GroupSession } from "@/lib/session"
import { instacartAvailability } from "@/integrations/instacart"
import { activity, cart, chatlog, chores, groups, members, money, pantry, recipes, reminders, schedule, splitwise, upkeep } from "@/services"
import { canChangeExpense } from "@/services/authz"
import { guessCategory } from "@/services/categories"
import type { Expense } from "@/services/money"
import { haveNeed } from "@/services/recipe-math"
import type { Recipe } from "@/services/recipes"
import { TOOLKIT_IDS, type ToolkitId } from "@/toolkits/types"
import type { GroupView, MemberView } from "./group-context"
import type { ActivityView, CartItemView, CartPageView, ChoreView, ExpenseView, NarrationView, RecipeView, ReminderView, ScheduleView, SplitwiseView, Transfer, UpkeepView } from "./types"

export async function groupView(s: GroupSession): Promise<GroupView> {
  const [people, toolkits] = await Promise.all([members.listMembersWithHandles({ groupId: s.group.id }), groups.listToolkits({ groupId: s.group.id })])
  const tz = s.group.timezone
  const view = (m: (typeof people)[number]): MemberView => ({
    id: m.id,
    name: m.displayName,
    role: m.role,
    status: m.status,
    joined: localDay(m.joinedAt, tz),
    handles: m.handles,
    hasAccount: !!m.accountId,
  })
  const me = people.find((m) => m.id === s.member.id)
  return {
    group: {
      id: s.group.id,
      name: s.group.name,
      currency: s.group.currency,
      timezone: tz,
      chattiness: s.group.chattiness,
      purpose: s.group.purpose,
      simplifyDebts: s.group.simplifyDebts,
      onboarded: !!s.group.onboardedAt,
    },
    me: me ? view(me) : { id: s.member.id, name: s.member.displayName, role: s.member.role, status: s.member.status, joined: localDay(s.member.joinedAt, tz), handles: {}, hasAccount: true },
    groups: s.groups,
    members: people.map(view),
    toolkits: Object.fromEntries(TOOLKIT_IDS.map((id) => [id, toolkits.find((t) => t.id === id)?.enabled ?? true])) as Record<ToolkitId, boolean>,
    today: localDay(new Date(), tz),
    dev: process.env.NODE_ENV !== "production",
  }
}

export async function balancesView(s: GroupSession) {
  const [balances, plan] = await Promise.all([money.getBalances(s.ctx), money.getSettlePlan(s.ctx)])
  return {
    you: balances.find((b) => b.memberId === s.member.id)?.cents ?? 0,
    balances: Object.fromEntries(balances.map((b) => [b.memberId, b.cents])) as Record<string, number>,
    plan: plan.map((t): Transfer => ({ from: t.fromId, to: t.toId, cents: t.cents })),
  }
}

/** Our own uploads render from this server, whatever APP_URL says. */
const localPath = (url: string | null | undefined) => {
  if (!url) return null
  const m = /\/uploads\/[a-z0-9-]+\/[a-z0-9-]+\.[a-z]+$/i.exec(url)
  return m ? m[0] : url
}

export function expenseView(s: GroupSession, e: Expense): ExpenseView {
  const shares = (e.splits ?? []).map((x) => ({ memberId: x.memberId, cents: x.cents, weight: x.weight ?? null }))
  const payers = (e.payers ?? []).map((p) => ({ memberId: p.memberId, cents: p.cents }))
  const participantIds = shares.map((x) => x.memberId)
  return {
    id: e.id,
    description: e.description,
    category: e.category ?? guessCategory(e.description, e.source),
    date: e.occurredOn ?? localDay(e.createdAt, s.group.timezone),
    cents: e.cents,
    method: e.method ?? "equal",
    payers,
    shares,
    yourShare: shares.find((x) => x.memberId === s.member.id)?.cents ?? 0,
    youPaid: payers.find((p) => p.memberId === s.member.id)?.cents ?? 0,
    addedBy: e.createdBy ?? null,
    note: e.note ?? null,
    recurring: e.recurring ?? null,
    repeated: !!e.recurringParentId,
    receiptUrl: localPath(e.receiptUrl),
    inSplitwise: !!e.splitwiseId,
    source: e.source ?? "chat",
    canChange: payers.some((p) => canChangeExpense(s.member, { createdBy: e.createdBy ?? null, payerId: p.memberId, participantIds })),
  }
}

export async function splitwiseView(s: GroupSession): Promise<SplitwiseView> {
  const st = await splitwise.splitwiseState(s.ctx)
  return {
    ready: st.availability.ready,
    hint: st.availability.hint ?? null,
    fake: st.availability.kind === "fake",
    connected: st.connected,
    connectedBy: st.connectedByName,
    group: st.splitwiseGroup,
    mirror: st.mode === "mirror",
    lastSynced: st.lastSyncedAt ? localDay(st.lastSyncedAt, s.group.timezone) : null,
    pendingPushes: st.pendingPushes,
  }
}

export async function expensesView(s: GroupSession): Promise<ExpenseView[]> {
  return (await money.listExpenses(s.ctx, 100)).map((e) => expenseView(s, e))
}

const refHref = (base: string, table: string | null, id: string | null) =>
  table === "expenses" && id
    ? `${base}/money/${id}`
    : table === "members"
      ? `${base}/members`
      : table === "chores"
        ? `${base}/chores`
        : table === "maintenance"
          ? `${base}/chores?tab=upkeep`
          : table === "reminders"
            ? `${base}/chores?tab=reminders`
            : undefined

export async function activityView(s: GroupSession): Promise<ActivityView[]> {
  const base = `/g/${s.group.id}`
  return (await activity.listActivity(s.ctx, 60)).map((a) => ({
    id: a.id,
    date: localDay(a.createdAt, s.group.timezone),
    actor: a.actorMemberId ?? "roomie",
    actorName: a.actorName,
    text: a.summary,
    href: refHref(base, a.refTable, a.refId),
  }))
}

/** What Roomie said in the Chat lately, for Home. */
export async function narrationView(s: GroupSession): Promise<NarrationView[]> {
  return (await chatlog.roomieLines(s.group.id, 6)).map((l) => ({ id: l.id, date: localDay(l.createdAt, s.group.timezone), text: l.text }))
}

export async function cartView(s: GroupSession): Promise<CartItemView[]> {
  return (await cart.listOpenItems(s.ctx)).map((i) => ({
    id: i.id,
    name: i.name,
    qty: i.qty && i.qty !== "1" ? i.qty : undefined,
    addedBy: i.addedBy ?? "",
    shared: i.shared,
    estCents: i.estCents ?? 0,
    recipeId: i.recipeId ?? null,
    recipeTitle: i.recipeTitle ?? null,
    canRemove: cart.canRemoveItem(s.member, { addedBy: i.addedBy ?? "" }),
  }))
}

function recipeView(r: Recipe, pantryList: string[], items: CartItemView[]): RecipeView {
  const { have } = haveNeed(r.ingredients, pantryList)
  const haveSet = new Set(have)
  return {
    id: r.id,
    title: r.title,
    servings: r.servings,
    cookingTimeMinutes: r.cookingTimeMinutes,
    plannedFor: r.plannedFor,
    ingredients: r.ingredients.map((i) => ({ name: i.name, text: i.display_text, quantity: i.quantity, unit: i.unit, have: haveSet.has(i) })),
    steps: r.steps,
    createdBy: r.createdBy,
    inCart: items.filter((c) => c.recipeId === r.id).length,
  }
}

export async function cartPageView(s: GroupSession): Promise<CartPageView> {
  const [items, list, pantryList, people, ic] = await Promise.all([cartView(s), recipes.listRecipes(s.ctx, 12), pantry.getPantry(s.ctx), members.listMembers(s.ctx), instacartAvailability()])
  return {
    items,
    recipes: list.map((r) => recipeView(r, pantryList, items)),
    pantry: pantryList,
    splitMemberIds: people.map((m) => m.id),
    instacart: { ready: ic.ready, hint: ic.hint ?? null },
  }
}

/** The next planned Recipe from today on, for Home ("Tacos for 5 is Friday"). */
export async function nextRecipeView(s: GroupSession): Promise<{ title: string; plannedFor: string } | null> {
  const [next] = await recipes.upcomingRecipes(s.ctx, localDay(new Date(), s.group.timezone))
  return next ? { title: next.title, plannedFor: next.plannedFor! } : null
}

const every = (days: number) =>
  days === 1 ? "Every day" : days === 7 ? "Every week" : days === 14 ? "Every 2 weeks" : days % 30 === 0 ? (days === 30 ? "Every month" : `Every ${days / 30} months`) : days === 365 ? "Every year" : `Every ${days} days`

export async function choresView(s: GroupSession): Promise<{ chores: ChoreView[]; upkeep: UpkeepView[] }> {
  const tz = s.group.timezone
  const [status, items] = await Promise.all([chores.choreStatus(s.ctx), upkeep.listMaintenance(s.ctx)])
  return {
    chores: status
      .map((c) => ({
        id: c.choreId,
        name: c.name,
        cadence: every(c.everyDays),
        everyDays: c.everyDays,
        turn: c.whoseTurnId,
        rotation: c.rotation,
        order: c.order.map((p) => p.id),
        due: c.dueDay,
        state: c.state,
        streak: c.streak,
        streaks: c.streaks,
        lastDone: c.lastDoneById && c.lastDoneDay ? { by: c.lastDoneById, date: c.lastDoneDay } : undefined,
      }))
      .sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name)),
    upkeep: items.map((m) => ({
      id: m.id,
      name: m.item,
      every: every(m.everyDays),
      everyDays: m.everyDays,
      due: m.dueDay,
      status: m.status,
      lastDone: m.lastDone ? localDay(m.lastDone, tz) : undefined,
    })),
  }
}

/** Upcoming reminders the signed-in Member may see (the Group's, theirs, the ones they set). */
export async function remindersView(s: GroupSession): Promise<ReminderView[]> {
  const tz = s.group.timezone
  return (await reminders.listReminders(s.ctx, { viewerId: s.member.id })).map((r) => ({
    id: r.id,
    text: r.text,
    when: reminders.whenLabel({ dueAt: r.dueAt, recurring: null }, tz),
    day: localDay(r.dueAt, tz),
    for: r.memberId,
    setBy: r.createdBy,
    repeat: r.recurring,
    canCancel: reminders.canCancel(s.member, r),
  }))
}

export async function scheduleView(s: GroupSession): Promise<ScheduleView> {
  return schedule.getSchedule(s.ctx)
}
