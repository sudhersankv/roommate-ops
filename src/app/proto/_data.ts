// Fake data for the clickable prototype. One Group, "Apt 4B". All money is integer cents.
import type { MemberId, Payer, SplitInput } from "./_lib/money"

export type Role = "admin" | "member"
export type MemberStatus = "active" | "pending"
export type PayApp = "venmo" | "paypal" | "cashapp"

export type Member = {
  id: MemberId
  name: string
  role: Role
  status: MemberStatus
  joined: string
  handles: Partial<Record<PayApp, string>>
}

export type Category = "groceries" | "utilities" | "dining" | "household" | "fun" | "transport"

export type Expense = {
  id: string
  description: string
  category: Category
  date: string
  note?: string
  /** Total in cents. Equals the sum of payers. */
  cents: number
  payers: Payer[]
  split: SplitInput
  addedBy: MemberId
}

export type Settlement = {
  id: string
  from: MemberId
  to: MemberId
  cents: number
  date: string
  via: PayApp | "cash"
}

export type CartItem = {
  id: string
  name: string
  qty?: string
  addedBy: MemberId
  shared: boolean
  estCents: number
}

export type Ingredient = { name: string; qty: string; estCents: number }

export type Recipe = {
  id: string
  title: string
  servings: number
  forDay: string
  ingredients: Ingredient[]
  steps: string[]
}

export type Chore = {
  id: string
  name: string
  cadence: string
  rotation: MemberId[]
  turn: MemberId
  due: string
  streak: number
  lastDone?: { by: MemberId; date: string }
}

export type Upkeep = {
  id: string
  name: string
  every: string
  everyDays: number
  due: string
  lastDone?: string
}

/** A line Roomie says on Home, in first person, linking to what it's about. */
export type Narration = { id: string; date: string; text: string; href?: string }

/** The Group's record of who added, changed or deleted what. */
export type ActivityEntry = { id: string; date: string; actor: MemberId | "roomie"; text: string; href?: string }

export type ChatMessage = { id: string; from: "you" | "roomie"; text: string }

export type Toolkit = {
  id: string
  name: string
  description: string
  status: "available" | "soon"
}

export const ME: MemberId = "maya"

export const group = {
  slug: "apt-4b",
  name: "Apt 4B",
  currency: "USD",
  timeZone: "America/Chicago",
  chattiness: "normal" as "quiet" | "normal" | "chatty",
}

export const otherGroups = [{ slug: "lake-trip", name: "Lake trip" }]

export const members: Member[] = [
  { id: "maya", name: "Maya", role: "admin", status: "active", joined: "2026-09-02", handles: { venmo: "@maya-r", paypal: "maya.r@gmail.com" } },
  { id: "dev", name: "Dev", role: "member", status: "active", joined: "2026-09-02", handles: { venmo: "@devp", cashapp: "$devpatel" } },
  { id: "sam", name: "Sam", role: "member", status: "active", joined: "2026-09-03", handles: { cashapp: "$samkim", paypal: "samkim@icloud.com" } },
  { id: "priya", name: "Priya", role: "member", status: "pending", joined: "2026-10-26", handles: {} },
]

const all = ["maya", "dev", "sam"]

export const expenses: Expense[] = [
  { id: "e1", description: "Costco run", category: "groceries", date: "2026-10-08", cents: 12630, payers: [{ memberId: "maya", cents: 12630 }], split: { method: "equal", members: all }, addedBy: "maya" },
  { id: "e2", description: "Internet", category: "utilities", date: "2026-10-09", cents: 7500, payers: [{ memberId: "dev", cents: 7500 }], split: { method: "equal", members: all }, addedBy: "dev" },
  { id: "e3", description: "Pizza night", category: "dining", date: "2026-10-11", cents: 4800, payers: [{ memberId: "sam", cents: 4800 }], split: { method: "exact", members: all, values: { maya: 1800, dev: 1700, sam: 1300 } }, addedBy: "sam", note: "Sam skipped the second pizza." },
  { id: "e4", description: "Electricity", category: "utilities", date: "2026-10-13", cents: 9100, payers: [{ memberId: "maya", cents: 9100 }], split: { method: "percent", members: all, values: { maya: 40, dev: 30, sam: 30 } }, addedBy: "maya", note: "Maya works from home, so she takes 40%." },
  { id: "e5", description: "Cleaning supplies", category: "household", date: "2026-10-15", cents: 2347, payers: [{ memberId: "sam", cents: 2347 }], split: { method: "equal", members: all }, addedBy: "sam" },
  { id: "e6", description: "Concert tickets", category: "fun", date: "2026-10-17", cents: 18000, payers: [{ memberId: "dev", cents: 18000 }], split: { method: "shares", members: ["dev", "sam"], values: { dev: 1, sam: 1 } }, addedBy: "dev" },
  { id: "e7", description: "Sunday brunch", category: "dining", date: "2026-10-18", cents: 9600, payers: [{ memberId: "maya", cents: 6000 }, { memberId: "dev", cents: 3600 }], split: { method: "equal", members: all }, addedBy: "maya", note: "Card machine split it across two cards." },
  { id: "e8", description: "Uber home", category: "transport", date: "2026-10-18", cents: 1860, payers: [{ memberId: "sam", cents: 1860 }], split: { method: "shares", members: ["maya", "sam"], values: { maya: 1, sam: 1 } }, addedBy: "sam" },
  { id: "e9", description: "Paper towels", category: "household", date: "2026-10-21", cents: 1299, payers: [{ memberId: "dev", cents: 1299 }], split: { method: "equal", members: all }, addedBy: "dev" },
  { id: "e10", description: "Water bill", category: "utilities", date: "2026-10-23", cents: 5400, payers: [{ memberId: "sam", cents: 5400 }], split: { method: "equal", members: all }, addedBy: "sam" },
  { id: "e11", description: "Taco night ingredients", category: "groceries", date: "2026-10-26", cents: 4125, payers: [{ memberId: "maya", cents: 4125 }], split: { method: "shares", members: all, values: { maya: 2, dev: 2, sam: 1 } }, addedBy: "maya", note: "Sam ate early and asked for a smaller share." },
  { id: "e12", description: "Movie snacks", category: "fun", date: "2026-10-27", cents: 1500, payers: [{ memberId: "dev", cents: 1500 }], split: { method: "equal", members: all }, addedBy: "dev" },
]

export const settlements: Settlement[] = [
  { id: "s1", from: "sam", to: "maya", cents: 6159, date: "2026-10-20", via: "venmo" },
  { id: "s2", from: "sam", to: "dev", cents: 6394, date: "2026-10-24", via: "cashapp" },
]

export const cart: CartItem[] = [
  { id: "c1", name: "Oat milk", qty: "2 cartons", addedBy: "maya", shared: false, estCents: 898 },
  { id: "c2", name: "Eggs", qty: "18", addedBy: "maya", shared: true, estCents: 579 },
  { id: "c3", name: "Coffee beans", qty: "2 lb", addedBy: "sam", shared: true, estCents: 1399 },
  { id: "c4", name: "Dish soap", addedBy: "sam", shared: true, estCents: 399 },
  { id: "c5", name: "Greek yogurt", qty: "32 oz", addedBy: "dev", shared: false, estCents: 649 },
  { id: "c6", name: "Hot sauce", addedBy: "sam", shared: false, estCents: 499 },
  { id: "c7", name: "Sparkling water", qty: "12 pack", addedBy: "dev", shared: true, estCents: 599 },
]

export const recipe: Recipe = {
  id: "r1",
  title: "Tacos for 5",
  servings: 5,
  forDay: "2026-10-30",
  ingredients: [
    { name: "Corn tortillas", qty: "20", estCents: 349 },
    { name: "Ground turkey", qty: "2 lb", estCents: 1198 },
    { name: "Taco seasoning", qty: "2 packets", estCents: 258 },
    { name: "Avocados", qty: "3", estCents: 387 },
    { name: "Limes", qty: "4", estCents: 196 },
    { name: "Cilantro", qty: "1 bunch", estCents: 129 },
    { name: "Red onion", qty: "1", estCents: 119 },
    { name: "Cotija", qty: "8 oz", estCents: 549 },
    { name: "Salsa verde", qty: "1 jar", estCents: 399 },
  ],
  steps: [
    "Brown the turkey with the seasoning and a splash of water.",
    "Dice the onion, chop the cilantro, slice the avocados.",
    "Warm the tortillas in a dry pan, 30 seconds a side.",
    "Pile it up. Cotija and lime on top.",
  ],
}

export const chores: Chore[] = [
  { id: "ch1", name: "Take out the trash", cadence: "Mon, Wed and Fri", rotation: all, turn: "maya", due: "2026-10-28", streak: 4, lastDone: { by: "sam", date: "2026-10-26" } },
  { id: "ch2", name: "Dishes", cadence: "Every day", rotation: all, turn: "dev", due: "2026-10-28", streak: 6, lastDone: { by: "sam", date: "2026-10-27" } },
  { id: "ch3", name: "Water the plants", cadence: "Every 3 days", rotation: all, turn: "sam", due: "2026-10-29", streak: 9, lastDone: { by: "dev", date: "2026-10-26" } },
  { id: "ch4", name: "Vacuum the living room", cadence: "Every Saturday", rotation: all, turn: "maya", due: "2026-10-31", streak: 3, lastDone: { by: "dev", date: "2026-10-24" } },
  { id: "ch5", name: "Clean the bathroom", cadence: "Every Sunday", rotation: all, turn: "sam", due: "2026-11-01", streak: 2, lastDone: { by: "maya", date: "2026-10-25" } },
]

export const upkeep: Upkeep[] = [
  { id: "u1", name: "Smoke detector batteries", every: "Every 6 months", everyDays: 182, due: "2026-10-30", lastDone: "2026-04-30" },
  { id: "u2", name: "HVAC filter", every: "Every 3 months", everyDays: 91, due: "2026-11-02", lastDone: "2026-08-02" },
  { id: "u3", name: "Descale the kettle", every: "Every month", everyDays: 30, due: "2026-11-20", lastDone: "2026-10-20" },
  { id: "u4", name: "Fridge coils", every: "Every year", everyDays: 365, due: "2027-02-14", lastDone: "2026-02-14" },
]

const g = "/proto/g/apt-4b"

export const narration: Narration[] = [
  { id: "n1", date: "2026-10-28", text: "Trash is on you today, Maya. Dev has dishes.", href: `${g}/chores` },
  { id: "n2", date: "2026-10-27", text: "Logged Dev's $15.00 for movie snacks, split three ways. You're in for $5.00.", href: `${g}/money/e12` },
  { id: "n3", date: "2026-10-27", text: "Sam did the dishes again. Six days in a row, I'm keeping count.", href: `${g}/chores` },
  { id: "n4", date: "2026-10-26", text: "Priya joined the chat. I'll help her out, but I'm waiting on you to approve her before I log anything for her.", href: `${g}/members` },
  { id: "n5", date: "2026-10-26", text: "Taco night ingredients: $41.25 from you, split 2:2:1 since Sam ate early.", href: `${g}/money/e11` },
  { id: "n6", date: "2026-10-24", text: "Sam paid Dev $63.94 on Cash App. Those two are square.", href: `${g}/money` },
]

export const activity: ActivityEntry[] = [
  { id: "a1", date: "2026-10-27", actor: "dev", text: "added Movie snacks", href: `${g}/money/e12` },
  { id: "a2", date: "2026-10-27", actor: "sam", text: "marked Dishes done" },
  { id: "a3", date: "2026-10-26", actor: "roomie", text: "added Priya as a pending member", href: `${g}/members` },
  { id: "a4", date: "2026-10-26", actor: "maya", text: "added Taco night ingredients", href: `${g}/money/e11` },
  { id: "a5", date: "2026-10-26", actor: "maya", text: "changed the split on Taco night ingredients to shares", href: `${g}/money/e11` },
  { id: "a6", date: "2026-10-24", actor: "sam", text: "recorded a $63.94 settlement to Dev" },
  { id: "a7", date: "2026-10-23", actor: "sam", text: "added Water bill", href: `${g}/money/e10` },
  { id: "a8", date: "2026-10-21", actor: "dev", text: "added Paper towels", href: `${g}/money/e9` },
  { id: "a9", date: "2026-10-20", actor: "sam", text: "recorded a $61.59 settlement to Maya" },
  { id: "a10", date: "2026-10-19", actor: "dev", text: "deleted Duplicate brunch" },
]

export const chat: ChatMessage[] = [
  { id: "m1", from: "you", text: "who owes what right now?" },
  { id: "m2", from: "roomie", text: "Dev owes you $30.00 and Sam owes you $12.50. Everyone else is square." },
  { id: "m3", from: "you", text: "can you nudge dev" },
  { id: "m4", from: "roomie", text: "Done. I sent Dev your Venmo, @maya-r, with a polite little poke." },
  { id: "m5", from: "you", text: "what's the plan for friday" },
  { id: "m6", from: "roomie", text: "Tacos for 5. The ingredients aren't in the Cart yet. Want me to add them?" },
]

export const cannedReplies = [
  "On it. I'll post it in the group chat too so nobody's surprised.",
  "Happy to split that. Equally, or did someone have more than the others?",
  "Dishes are Dev's tonight. Want me to remind him at 8?",
  "The Cart has 7 things, about $50 if nobody adds snacks.",
  "I can't log that for Priya until you approve her on the Members page.",
  "Noted. I'll ask before I split anything you didn't ask me to log.",
]

export const toolkits: Toolkit[] = [
  { id: "splitting", name: "Splitting", description: "Expenses, Shares and settling up", status: "available" },
  { id: "groceries", name: "Groceries", description: "The Cart and Recipes", status: "available" },
  { id: "chores", name: "Chores", description: "Rotations, streaks and reminders", status: "available" },
  { id: "upkeep", name: "Upkeep", description: "Filters, batteries and other house care", status: "available" },
  { id: "research", name: "Research", description: "Roomie looks things up for the group", status: "soon" },
  { id: "pdf", name: "PDFs", description: "Receipts, itineraries and summaries", status: "soon" },
  { id: "trips", name: "Trips", description: "Plan a trip and split it as you go", status: "soon" },
]
