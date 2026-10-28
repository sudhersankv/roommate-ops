"use client"

import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from "react"

import * as data from "../_data"
import type { ActivityEntry, CartItem, Chore, Expense, Member, Narration, Settlement, Upkeep } from "../_data"
import { addDays, TODAY } from "./dates"
import { balances, computeShares, formatMoney, settlePlan, type Share, type Transfer } from "./money"

// Local state only: the prototype has no server. Everything lives in this provider for the Group's routes.

type State = {
  group: typeof data.group
  members: Member[]
  expenses: Expense[]
  settlements: Settlement[]
  cart: CartItem[]
  chores: Chore[]
  upkeep: Upkeep[]
  narration: Narration[]
  activity: ActivityEntry[]
  toolkits: Record<string, boolean>
  /** Bumps whenever something deserves a dino hop. */
  cheers: number
  askOpen: boolean
}

const initial: State = {
  group: data.group,
  members: data.members,
  expenses: data.expenses,
  settlements: data.settlements,
  cart: data.cart,
  chores: data.chores,
  upkeep: data.upkeep,
  narration: data.narration,
  activity: data.activity,
  toolkits: { splitting: true, groceries: true, chores: true, upkeep: true },
  cheers: 0,
  askOpen: false,
}

type Store = ReturnType<typeof useCreateStore>

const StoreContext = createContext<Store | null>(null)

function useCreateStore() {
  const [state, setState] = useState(initial)
  const seq = useRef(100)
  const nextId = useCallback((prefix: string) => `${prefix}${++seq.current}`, [])

  const actions = useMemo(() => {
    const log = (s: State, entry: Omit<ActivityEntry, "id">, say?: Omit<Narration, "id">): State => ({
      ...s,
      activity: [{ id: nextId("a"), ...entry }, ...s.activity],
      narration: say ? [{ id: nextId("n"), ...say }, ...s.narration] : s.narration,
    })

    return {
      saveExpense(expense: Omit<Expense, "id"> & { id?: string }) {
        const id = expense.id ?? nextId("e")
        setState((s) => {
          const exists = s.expenses.some((e) => e.id === id)
          const full: Expense = { ...expense, id }
          const next = exists ? s.expenses.map((e) => (e.id === id ? full : e)) : [full, ...s.expenses]
          return log(
            { ...s, expenses: next },
            { date: TODAY, actor: data.ME, text: `${exists ? "changed" : "added"} ${full.description}`, href: `/proto/g/apt-4b/money/${id}` },
            exists
              ? undefined
              : { date: TODAY, text: `Logged your ${formatMoney(full.cents)} for ${full.description.toLowerCase()}.`, href: `/proto/g/apt-4b/money/${id}` }
          )
        })
        return id
      },
      /** Deletes and returns an undo function that puts the same Expense back. */
      deleteExpense(expense: Expense) {
        setState((s) =>
          log({ ...s, expenses: s.expenses.filter((e) => e.id !== expense.id) }, { date: TODAY, actor: data.ME, text: `deleted ${expense.description}` })
        )
        return () =>
          setState((s) =>
            s.expenses.some((e) => e.id === expense.id)
              ? s
              : log({ ...s, expenses: [expense, ...s.expenses] }, { date: TODAY, actor: data.ME, text: `restored ${expense.description}` })
          )
      },
      recordSettlement(t: Transfer, via: Settlement["via"]) {
        setState((s) => {
          const from = s.members.find((m) => m.id === t.from)?.name
          const to = s.members.find((m) => m.id === t.to)?.name
          return log(
            { ...s, settlements: [{ id: nextId("s"), ...t, date: TODAY, via }, ...s.settlements], cheers: s.cheers + 1 },
            { date: TODAY, actor: data.ME, text: `recorded a ${formatMoney(t.cents)} settlement from ${from} to ${to}` },
            { date: TODAY, text: `${from} and ${to} settled ${formatMoney(t.cents)}. Love to see it.`, href: "/proto/g/apt-4b/money" }
          )
        })
      },
      addCartItem(item: Omit<CartItem, "id">) {
        setState((s) => ({ ...s, cart: [...s.cart, { ...item, id: nextId("c") }] }))
      },
      removeCartItem(id: string) {
        setState((s) => ({ ...s, cart: s.cart.filter((c) => c.id !== id) }))
      },
      addIngredients(items: Omit<CartItem, "id">[]) {
        setState((s) => ({ ...s, cart: [...s.cart, ...items.map((i) => ({ ...i, id: nextId("c") }))] }))
      },
      checkoutCart(expense: Omit<Expense, "id">) {
        const id = nextId("e")
        setState((s) =>
          log(
            { ...s, expenses: [{ ...expense, id }, ...s.expenses], cart: [] },
            { date: TODAY, actor: data.ME, text: `added ${expense.description}`, href: `/proto/g/apt-4b/money/${id}` },
            { date: TODAY, text: `You paid ${formatMoney(expense.cents)} for groceries. I split it by who wanted what.`, href: `/proto/g/apt-4b/money/${id}` }
          )
        )
        return id
      },
      markChoreDone(id: string) {
        setState((s) => {
          const chore = s.chores.find((c) => c.id === id)
          if (!chore) return s
          const at = chore.rotation.indexOf(chore.turn)
          const nextTurn = chore.rotation[(at + 1) % chore.rotation.length]
          const done: Chore = { ...chore, streak: chore.streak + 1, lastDone: { by: data.ME, date: TODAY }, turn: nextTurn, due: addDays(chore.due, chore.cadence === "Every day" ? 1 : 2) }
          return log(
            { ...s, chores: s.chores.map((c) => (c.id === id ? done : c)), cheers: s.cheers + 1 },
            { date: TODAY, actor: data.ME, text: `marked ${chore.name} done`, href: "/proto/g/apt-4b/chores" }
          )
        })
      },
      markUpkeepDone(id: string) {
        setState((s) => ({
          ...s,
          upkeep: s.upkeep.map((u) => (u.id === id ? { ...u, lastDone: TODAY, due: addDays(TODAY, u.everyDays) } : u)),
          cheers: s.cheers + 1,
        }))
      },
      setMemberStatus(id: string, decision: "approve" | "decline") {
        setState((s) => {
          const m = s.members.find((x) => x.id === id)
          if (!m) return s
          const members = decision === "approve" ? s.members.map((x) => (x.id === id ? { ...x, status: "active" as const } : x)) : s.members.filter((x) => x.id !== id)
          return log({ ...s, members }, { date: TODAY, actor: data.ME, text: `${decision === "approve" ? "approved" : "declined"} ${m.name}`, href: "/proto/g/apt-4b/members" })
        })
      },
      setToolkit(id: string, on: boolean) {
        setState((s) => ({ ...s, toolkits: { ...s.toolkits, [id]: on } }))
      },
      setGroup(patch: Partial<State["group"]>) {
        setState((s) => ({ ...s, group: { ...s.group, ...patch } }))
      },
      setAskOpen(open: boolean) {
        setState((s) => ({ ...s, askOpen: open }))
      },
      cheer() {
        setState((s) => ({ ...s, cheers: s.cheers + 1 }))
      },
      resetGroupData() {
        setState((s) => ({ ...initial, members: s.members.filter((m) => m.id === data.ME), expenses: [], settlements: [], cart: [], narration: [], activity: [], group: s.group, toolkits: s.toolkits }))
      },
    }
  }, [nextId])

  return { state, ...actions }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const store = useCreateStore()
  return <StoreContext value={store}>{children}</StoreContext>
}

export function useStore() {
  const store = use(StoreContext)
  if (!store) throw new Error("useStore must be used inside StoreProvider")
  return store
}

export type ExpenseView = Expense & { shares: Share[]; yourShare: number; youPaid: number }

/** Shares, Balances and the Settle plan, all computed from the raw Expenses (ADR 0007). */
export function useMoney() {
  const { state } = useStore()
  return useMemo(() => {
    const active = state.members.filter((m) => m.status === "active")
    const ids = active.map((m) => m.id)
    const views: ExpenseView[] = state.expenses
      .map((e) => {
        const r = computeShares(e.cents, e.split)
        const shares = r.shares
        return {
          ...e,
          shares,
          yourShare: shares.find((s) => s.memberId === data.ME)?.cents ?? 0,
          youPaid: e.payers.find((p) => p.memberId === data.ME)?.cents ?? 0,
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, undefined, { numeric: true }))
    const bal = balances(ids, views, state.settlements)
    const plan = settlePlan(bal, ids)
    return { expenses: views, balances: bal, plan, you: bal[data.ME] ?? 0, active }
  }, [state.expenses, state.settlements, state.members])
}

export function useMemberName() {
  const { state } = useStore()
  return useCallback(
    (id: string) => (id === data.ME ? "You" : (state.members.find((m) => m.id === id)?.name ?? "Someone")),
    [state.members]
  )
}
