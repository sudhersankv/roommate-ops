import { defineManifest } from "../define";

export const splitting = defineManifest({
  id: "splitting",
  name: "Splitting",
  description: "Shared Expenses (any split, several payers, receipts), Balances, settling up with pay links, and Splitwise import/export.",
  summary: "Log shared costs, split them any way, settle up with pay links.",
  longDescription:
    "Tell Roomie what you paid and it splits it: evenly, by exact amounts, percentages or shares, even with several payers. Send a photo of a receipt and it splits it item by item. Balances and the Settle plan are always exact, and Settle up hands out Venmo, PayPal or Cash App links with the amount filled in. Bring an old Splitwise group along, or keep one in sync.",
  icon: "Wallet",
  category: "money",
  tags: ["expenses", "balances", "settle up", "receipts", "Splitwise", "Venmo"],
  defaultOn: true,
  worksWith: { integrations: ["splitwise"] },
  status: "stable",
  gate: {
    criterion: "Money other than the grocery run: shared expenses, who paid, balances, who owes what, paying someone back, receipts, Venmo/PayPal/Cash App, Splitwise.",
    examples: ["I paid 60 for internet", "who owes what?", "Alex paid 60 and I paid 40 for dinner", "settle up with Sam"],
  },
  persona: [
    `- Splits: pass the intent, not your arithmetic. "50/25/25" is percents, "2:2:1" is shares, "I owe 30, Dev 20" is exact amounts, "Alex paid 60 and I paid 40" is payers. If amounts don't add up, the tool says so: ask, don't fix them yourself.`,
    `- Always set a category when you log an expense; ask only if the amount or who's in it is unclear.`,
    `- "[photo: <url>]" in a message is a picture someone sent. If it's a receipt, use expense_from_receipt with that url.`,
    `- "Settle up with X" means show what's owed and the pay buttons (settle_up with paid=false). Record a payment only once someone says it's paid.`,
    `- "Undo" right after you deleted an expense means restore_expense.`,
  ].join("\n"),
  abilities: {
    log_expense: "Log a shared cost: evenly, exact amounts, percentages or shares, one or several payers",
    update_expense: "Fix an expense: the amount, who's in it, how it's split",
    delete_expense: "Delete an expense",
    restore_expense: "Undo a delete",
    get_balances: "Say who owes what, exactly",
    settle_up: "Settle up with pay links (Venmo, PayPal, Cash App) and record the payment",
    set_simplify_debts: "Admins: settle with the fewest payments, or pair by pair",
    list_expenses: "List recent expenses with everyone's share",
    expense_from_receipt: "Read a receipt photo and split it item by item",
    splitwise_status: "Check the Splitwise connection",
    splitwise_connect: "Admins: connect Splitwise",
    splitwise_import: "Admins: bring in a Splitwise group's history",
    splitwise_export: "Admins: copy this group's expenses to Splitwise",
    splitwise_mirror: "Admins: keep a Splitwise group in sync",
  },
  adminOnly: {
    set_simplify_debts: { action: String.raw`simplif|fewest|pairwise|pair by pair`, ask: `Change how debts settle? Say "roomie, yes simplify debts" (or "roomie, yes don't simplify debts").` },
    splitwise_connect: { action: "splitwise", ask: `Connect Splitwise? Say "roomie, yes connect Splitwise".` },
    splitwise_import: { action: "splitwise", ask: `Import that Splitwise group? Say "roomie, yes import from Splitwise".` },
    splitwise_export: { action: "splitwise", ask: `Copy this group's expenses to Splitwise? Say "roomie, yes export to Splitwise".` },
    splitwise_mirror: { action: "splitwise", ask: `Change the Splitwise mirror? Say "roomie, yes mirror Splitwise" (or "roomie, yes stop the Splitwise mirror").` },
  },
  dashboard: {
    nav: { label: "Money", href: (g) => `/g/${g}/money`, icon: "Wallet", order: 10 },
    pages: ["money"],
  },
});
