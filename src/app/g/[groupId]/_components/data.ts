// Server-side: services -> the plain shapes the screens render. No business rules here; the numbers come from
// services (balances, settle plan, shares, chores) and are only reshaped and dated in the Group's time zone.
import { categoryFor } from "@/components/app/categories"
import { localDay } from "@/lib/dates"
import type { GroupSession } from "@/lib/session"
import { activity, cart, chatlog, chores, groups, members, money, upkeep } from "@/services"
import { canChangeExpense } from "@/services/authz"
import type { Expense } from "@/services/money"
import { TOOLKIT_IDS, type ToolkitId } from "@/toolkits/types"
import type { GroupView, MemberView } from "./group-context"
import type { ActivityView, CartItemView, ChoreView, ExpenseView, NarrationView, Transfer, UpkeepView } from "./types"

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

export function expenseView(s: GroupSession, e: Expense): ExpenseView {
  const shares = (e.splits ?? []).map((x) => ({ memberId: x.memberId, cents: x.cents }))
  const payerId = e.payerId ?? ""
  const min = Math.min(...shares.map((x) => x.cents))
  return {
    id: e.id,
    description: e.description,
    category: categoryFor(e.description, e.source),
    date: localDay(e.createdAt, s.group.timezone),
    cents: e.cents,
    payers: [{ memberId: payerId, cents: e.cents }],
    shares,
    yourShare: shares.find((x) => x.memberId === s.member.id)?.cents ?? 0,
    youPaid: payerId === s.member.id ? e.cents : 0,
    addedBy: e.createdBy ?? null,
    uneven: shares.some((x) => x.cents - min > 1),
    canChange: canChangeExpense(s.member, { createdBy: e.createdBy ?? null, payerId, participantIds: shares.map((x) => x.memberId) }),
  }
}

export async function expensesView(s: GroupSession): Promise<ExpenseView[]> {
  return (await money.listExpenses(s.ctx, 100)).map((e) => expenseView(s, e))
}

const refHref = (base: string, table: string | null, id: string | null) =>
  table === "expenses" && id ? `${base}/money/${id}` : table === "members" ? `${base}/members` : table === "chores" ? `${base}/chores` : undefined

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
  }))
}

const every = (days: number) =>
  days === 1 ? "Every day" : days === 7 ? "Every week" : days === 14 ? "Every 2 weeks" : days % 30 === 0 ? (days === 30 ? "Every month" : `Every ${days / 30} months`) : days === 365 ? "Every year" : `Every ${days} days`

export async function choresView(s: GroupSession): Promise<{ chores: ChoreView[]; upkeep: UpkeepView[] }> {
  const tz = s.group.timezone
  const today = localDay(new Date(), tz)
  const [status, items] = await Promise.all([chores.choreStatus(s.ctx), upkeep.listMaintenance(s.ctx)])
  return {
    chores: status
      .map((c) => ({
        id: c.choreId,
        name: c.name,
        cadence: every(c.everyDays),
        turn: c.whoseTurnId,
        due: c.dueAt ? localDay(c.dueAt, tz) : today,
        streak: c.streak,
        lastDone: c.lastDoneById && c.lastDoneAt ? { by: c.lastDoneById, date: localDay(c.lastDoneAt, tz) } : undefined,
      }))
      .sort((a, b) => a.due.localeCompare(b.due) || a.name.localeCompare(b.name)),
    upkeep: items.map((m) => ({
      id: m.id,
      name: m.item,
      every: every(m.everyDays),
      due: m.nextDue ? localDay(m.nextDue, tz) : today,
      lastDone: m.lastDone ? localDay(m.lastDone, tz) : undefined,
    })),
  }
}
