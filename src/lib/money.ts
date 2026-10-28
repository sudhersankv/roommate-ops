// Money on screen. Amounts are integer cents (ADR 0007); the real splits and balances come from services/money.ts.

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
  const clean = input.replace(/[$€£₹,\s]/g, "")
  if (clean === "") return null
  if (!/^\d*(\.\d{0,2})?$/.test(clean)) return null
  const n = Number(clean)
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

export function centsToInput(cents: number) {
  return (cents / 100).toFixed(2)
}

/** The currency's symbol on its own ("$", "€"), for input prefixes. */
export function currencySymbol(currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency
}

/**
 * Preview only (the Cart's "I paid" drawer): splits `total` by weights, leftover cents to the largest remainders.
 * The Expense itself is split by services/cart.ts when it's saved.
 */
export function splitByWeights(total: number, members: string[], weights: number[]): { memberId: string; cents: number }[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (members.length === 0 || sum <= 0) return []
  const exact = weights.map((w) => (total * w) / sum)
  const base = exact.map((x) => Math.floor(x))
  let left = total - base.reduce((a, b) => a + b, 0)
  const order = exact.map((x, i) => ({ i, r: x - Math.floor(x) })).sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of order) {
    if (left <= 0) break
    base[i] += 1
    left -= 1
  }
  return members.map((memberId, i) => ({ memberId, cents: base[i] }))
}
