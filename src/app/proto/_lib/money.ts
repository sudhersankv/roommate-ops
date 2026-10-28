// Money is integer cents (ADR 0007). Every split, balance and settle plan is computed here, never by hand.

export type MemberId = string

export type SplitMethod = "equal" | "exact" | "percent" | "shares"

/** What the person asked for. `values` is per member: ignored for equal, cents for exact, percent (0-100) or share weights. */
export type SplitInput = {
  method: SplitMethod
  members: MemberId[]
  values?: Record<MemberId, number>
}

export type Payer = { memberId: MemberId; cents: number }
export type Share = { memberId: MemberId; cents: number }

/** Splits `total` by integer weights. Leftover cents go to the largest remainders, ties to the earlier member. */
export function splitByWeights(total: number, members: MemberId[], weights: number[]): Share[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (members.length === 0 || sum <= 0) return []
  const exact = weights.map((w) => (total * w) / sum)
  const base = exact.map((x) => Math.floor(x))
  let left = total - base.reduce((a, b) => a + b, 0)
  const order = exact
    .map((x, i) => ({ i, r: x - Math.floor(x) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    base[i] += 1
    left -= 1
  }
  return members.map((memberId, i) => ({ memberId, cents: base[i] }))
}

export type SplitCheck =
  | { ok: true; shares: Share[] }
  | { ok: false; shares: Share[]; remaining: number; unit: "cents" | "percent" | "none" }

/** Turns a split request into Shares, or says how far off the inputs are (remaining > 0 means "still to assign"). */
export function computeShares(total: number, split: SplitInput): SplitCheck {
  const { method, members } = split
  const values = split.values ?? {}
  if (members.length === 0) return { ok: false, shares: [], remaining: total, unit: "none" }

  if (method === "equal") {
    return { ok: true, shares: splitByWeights(total, members, members.map(() => 1)) }
  }

  if (method === "exact") {
    const shares = members.map((memberId) => ({ memberId, cents: Math.max(0, Math.round(values[memberId] ?? 0)) }))
    const remaining = total - shares.reduce((a, s) => a + s.cents, 0)
    return remaining === 0 ? { ok: true, shares } : { ok: false, shares, remaining, unit: "cents" }
  }

  if (method === "percent") {
    // Percent is kept to two decimals: work in basis points so 33.33% stays exact.
    const bps = members.map((m) => Math.max(0, Math.round((values[m] ?? 0) * 100)))
    const remaining = 10000 - bps.reduce((a, b) => a + b, 0)
    const shares = splitByWeights(total, members, bps.some((b) => b > 0) ? bps : members.map(() => 0))
    return remaining === 0 ? { ok: true, shares } : { ok: false, shares, remaining, unit: "percent" }
  }

  const weights = members.map((m) => Math.max(0, Math.round(values[m] ?? 0)))
  if (weights.every((w) => w === 0)) return { ok: false, shares: [], remaining: 0, unit: "none" }
  return { ok: true, shares: splitByWeights(total, members, weights) }
}

/** Positive = owed to this member, negative = this member owes. Sums to zero. */
export function balances(
  memberIds: MemberId[],
  expenses: { payers: Payer[]; shares: Share[] }[],
  settlements: { from: MemberId; to: MemberId; cents: number }[],
): Record<MemberId, number> {
  const out: Record<MemberId, number> = Object.fromEntries(memberIds.map((m) => [m, 0]))
  for (const e of expenses) {
    for (const p of e.payers) out[p.memberId] = (out[p.memberId] ?? 0) + p.cents
    for (const s of e.shares) out[s.memberId] = (out[s.memberId] ?? 0) - s.cents
  }
  for (const s of settlements) {
    out[s.from] = (out[s.from] ?? 0) + s.cents
    out[s.to] = (out[s.to] ?? 0) - s.cents
  }
  return out
}

export type Transfer = { from: MemberId; to: MemberId; cents: number }

/** The smallest set of Settlements (greedy, largest first) that brings every Balance to zero. */
export function settlePlan(bal: Record<MemberId, number>, order: MemberId[]): Transfer[] {
  const debtors = order.filter((m) => bal[m] < 0).map((m) => ({ m, c: -bal[m] }))
  const creditors = order.filter((m) => bal[m] > 0).map((m) => ({ m, c: bal[m] }))
  const plan: Transfer[] = []
  debtors.sort((a, b) => b.c - a.c)
  creditors.sort((a, b) => b.c - a.c)
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const cents = Math.min(debtors[i].c, creditors[j].c)
    if (cents > 0) plan.push({ from: debtors[i].m, to: creditors[j].m, cents })
    debtors[i].c -= cents
    creditors[j].c -= cents
    if (debtors[i].c === 0) i++
    if (creditors[j].c === 0) j++
  }
  return plan
}

const formatters = new Map<string, Intl.NumberFormat>()

export function formatMoney(cents: number, currency = "USD", opts: { sign?: boolean } = {}) {
  const key = `${currency}:${opts.sign ? 1 : 0}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      signDisplay: opts.sign ? "exceptZero" : "auto",
    })
    formatters.set(key, f)
  }
  return f.format(cents / 100)
}

/** "12.5" or "$12.50" or "12" -> 1250. Returns null for anything that isn't a plain amount. */
export function parseMoney(input: string): number | null {
  const clean = input.replace(/[$,\s]/g, "")
  if (clean === "") return null
  if (!/^\d*(\.\d{0,2})?$/.test(clean)) return null
  const n = Number(clean)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2)
}
