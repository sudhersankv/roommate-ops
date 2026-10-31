import { defineManifest } from "../define";

// The id stays "splitting" (group_toolkits rows, evals, tests); people see "Money" (ADR 0015).
export const splitting = defineManifest({
  id: "splitting",
  name: "Money",
  description: "Shared Expenses (any split, several payers, receipts), Balances, settling up with pay links, and Splitwise import/export.",
  summary: "Log shared costs, split them any way, settle up with pay links.",
  spoken: "money",
  longDescription:
    "Tell Roomie what you paid and it splits it: evenly, by exact amounts, percentages or shares, even with several payers. Send a photo of a receipt and it splits it item by item. Balances and the Settle plan are always exact, and Settle up hands out Venmo, PayPal or Cash App links with the amount filled in. Bring an old Splitwise group along, or keep one in sync.",
  icon: "Wallet",
  category: "money",
  tags: ["expenses", "split", "splitting", "balances", "settle up", "receipts", "Splitwise", "Venmo"],
  defaultOn: true,
  worksWith: { integrations: ["splitwise"] },
  status: "stable",
  gate: {
    criterion: "Money other than the grocery run: shared expenses, rent and utility bills, who paid, balances, who owes what, paying someone back, receipts, Venmo/PayPal/Cash App, Splitwise.",
    examples: ["I paid 60 for internet", "who owes what?", "Alex paid 60 and I paid 40 for dinner", "settle up with Sam", "rent is 2400 on the 1st, Maya pays", "electric was 92"],
  },
  abilities: {
    log_expense: "Log a shared cost: evenly, exact amounts, percentages or shares, one or several payers",
    update_expense: "Fix an expense: the amount, who's in it, how it's split",
    delete_expense: "Delete an expense",
    restore_expense: "Undo a delete",
    get_balances: "Say who owes what, exactly",
    settle_up: "Settle up with pay links (Venmo, PayPal, Cash App) and record the payment",
    set_simplify_debts: "Admins: settle with the fewest payments, or pair by pair",
    list_expenses: "List recent expenses with everyone's share",
    set_rent: "Track the rent: who pays the landlord, everyone's share, a heads-up 3 days before",
    rent_status: "Say what the rent is, when it's due and who pays",
    set_variable_expense: "Ask the payer for a bill that changes each month (electric) on its due day",
    answer_amount: "Log this month's bill from the amount the payer gives",
    expense_from_receipt: "Read a receipt photo and split it item by item",
    splitwise_status: "Check the Splitwise connection",
    splitwise_connect: "Admins: connect Splitwise",
    splitwise_import: "Admins: bring in a Splitwise group's history",
    splitwise_export: "Admins: copy this group's expenses to Splitwise",
    splitwise_mirror: "Admins: keep a Splitwise group in sync",
  },
  adminOnly: {
    set_rent: { action: String.raw`\brent\b`, ask: `Change the rent?` },
    set_variable_expense: { action: String.raw`\b(?:var(?:y|ies|iable)|changes|different|bill)\b`, ask: `Set up {target} as a bill I ask the amount of each month?`, target: "description" },
    set_simplify_debts: { action: String.raw`simplif|fewest|pairwise|pair by pair`, ask: `Change how debts settle?` },
    // Each one needs its own verb next to "Splitwise": "is splitwise connected?" asks splitwise_status (not admin-only)
    // and authorizes none of these.
    splitwise_connect: { action: String.raw`^(?=.*\bsplitwise\b)(?=.*\b(?:connect|link|hook up|sign in|log in)\b)`, ask: `Connect your Splitwise?` },
    splitwise_import: { action: String.raw`^(?=.*\bsplitwise\b)(?=.*\b(?:import\w*|bring\b.*\b(?:in|over)|pull\b.*\bin|move\b.*\bover)\b)`, ask: `Import the Splitwise group {target}?`, target: "group" },
    splitwise_export: { action: String.raw`^(?=.*\bsplitwise\b)(?=.*\b(?:export\w*|copy|push|send\b.*\bto)\b)`, ask: `Copy this group's expenses to Splitwise?` },
    splitwise_mirror: { action: String.raw`^(?=.*\bsplitwise\b)(?=.*\b(?:mirror\w*|sync\w*|keep\b.*\bin sync)\b)`, ask: `Change the Splitwise mirror?` },
  },
  groupDecisions: ["log_expense"],
  // Money leads the Bundle and the report (ADR 0017).
  postOrder: 10,
  dashboard: {
    nav: { label: "Money", href: (g) => `/g/${g}/money`, icon: "Wallet", order: 10 },
    pages: ["money"],
  },
});
