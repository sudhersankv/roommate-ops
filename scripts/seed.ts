// npm run seed: the demo Group "Apt 4B" with Maya (Admin), Dev and Sam (active) and Priya (Pending), three weeks of
// Expenses (equal splits, plus one percent, one shares, one multi-payer and one recurring Expense), Settlements, a
// Cart, a Pantry and a "Tacos for 5" Recipe, chores, upkeep, reminders and some chat. The numbers match the UI prototype: Maya is owed $42.50, Dev owes
// $30.00 and Sam owes $12.50. Prints the Group id, a Claim link for Maya and a Studio
// requestContext. `npm run seed:demo` (--reset) deletes Apt 4B first and rebuilds it.
// The Chat is a dev Channel chat ("dev-apt-4b"), so `npm run dev-chat -- --chat dev-apt-4b` talks to it.
import "../src/lib/env";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../src/db";
import { devUserId } from "../src/channels/dev";
import { addDays, localDay } from "../src/lib/dates";
import { guessCategory } from "../src/services/categories";
import { claims, groups, money, chores as choresSvc, pantry as pantrySvc, recipes as recipesSvc, upkeep as upkeepSvc } from "../src/services";
import { dollars } from "../src/services/types";
import { presetFor } from "../src/toolkits/presets";
import { PRESETS_FILE, writeStudioPresets } from "./lib/presets";

const RESET = process.argv.includes("--reset");
const NAME = "Apt 4B";
const CHAT = "dev-apt-4b";
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = new Date();
const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY - hours * HOUR);

async function printAccess(groupId: string) {
  const [maya] = await db.select().from(schema.members).where(eq(schema.members.groupId, groupId)).then((rows) => rows.filter((m) => m.displayName === "Maya"));
  const link = maya ? await claims.createClaimToken(maya.id) : null;
  await writeStudioPresets();
  const studio = maya ? { groupId, memberId: maya.id, memberName: "Maya", role: "admin", status: "active", source: "chat" } : null;
  console.log(`\nGroup "${NAME}": ${groupId}`);
  if (link) console.log(`Claim link for Maya (single use, 24 h): ${link.url}`);
  console.log(`Studio (npm run mastra:dev): presets in ${PRESETS_FILE}. requestContext:\n${JSON.stringify(studio)}`);
}

/**
 * Step 5's split methods on the Money page: a percent, a shares, a multi-payer and a recurring Expense, logged
 * through the services as their Payers. Settlements then put every Balance back where it was, so the totals still
 * match the prototype. Skipped when the Group already has them (older seeds get them on the next `npm run seed`).
 */
async function addSplitDemos(groupId: string) {
  const [has] = await db.select({ id: schema.expenses.id }).from(schema.expenses).where(and(eq(schema.expenses.groupId, groupId), eq(schema.expenses.splitMethod, "percent"))).limit(1);
  if (has) return false;
  const people = await db.select().from(schema.members).where(eq(schema.members.groupId, groupId));
  const id = (name: string) => people.find((p) => p.displayName === name)!.id;
  const [m, d, s] = [id("Maya"), id("Dev"), id("Sam")];
  const as = (memberId: string) => ({ groupId, memberId, source: "chat" as const });
  const [g] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
  const day = (n: number) => localDay(ago(n), g.timezone);
  const before = new Map((await money.getBalances({ groupId })).map((b) => [b.memberId, b.cents]));

  await money.logExpense(as(m), { cents: 9000, description: "Dinner at Nopa", category: "food", occurredOn: day(3), note: "Maya had the steak", percents: [{ memberId: m, percent: 50 }, { memberId: d, percent: 25 }, { memberId: s, percent: 25 }] });
  await money.logExpense(as(d), { cents: 4125, description: "Wine and cheese", category: "food", occurredOn: day(6), shares: [{ memberId: m, shares: 2 }, { memberId: d, shares: 2 }, { memberId: s, shares: 1 }] });
  await money.logExpense(as(s), { cents: 10000, description: "Costco restock", category: "groceries", occurredOn: day(4), note: "Two cards at the register", payers: [{ memberId: s, cents: 6000 }, { memberId: m, cents: 4000 }] });
  await money.logExpense(as(m), { cents: 1549, description: "Netflix", category: "entertainment", occurredOn: day(12), recurring: "monthly" });

  const after = await money.getBalances({ groupId });
  const delta = after.map((b) => ({ ...b, cents: b.cents - (before.get(b.memberId) ?? 0) }));
  for (const t of money.computeSettlePlan(delta)) await money.settleUp(as(t.fromId), { toId: t.toId, cents: t.cents });
  return true;
}

/**
 * Step 6: the Pantry (salt, oil, rice) and Maya's "Tacos for 5" Recipe planned for the coming Friday. The Recipe
 * stays out of the Cart (it only goes in when someone asks). Skipped when the Group already has a Recipe.
 */
async function addGroceriesDemos(groupId: string) {
  const [has] = await db.select({ id: schema.recipes.id }).from(schema.recipes).where(eq(schema.recipes.groupId, groupId)).limit(1);
  if (has) return false;
  const [maya] = await db.select().from(schema.members).where(and(eq(schema.members.groupId, groupId), eq(schema.members.displayName, "Maya")));
  const [g] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
  const as = { groupId, memberId: maya.id, source: "chat" as const };
  let friday = localDay(now, g.timezone);
  while (new Date(`${friday}T12:00:00Z`).getUTCDay() !== 5) friday = addDays(friday, 1);
  await pantrySvc.updatePantry(as, { add: ["salt", "oil", "rice"] });
  await recipesSvc.saveRecipe(as, { ...recipesSvc.parseRecipeJson(recipesSvc.SAMPLE_RECIPE_JSON), plannedFor: friday, source: "roomie" });
  return true;
}

const existing = await groups.chatFor("dev", CHAT);
if (existing && !RESET) {
  const added = await addSplitDemos(existing.group.id);
  const groceries = await addGroceriesDemos(existing.group.id);
  console.log(`"${existing.group.name}" (${existing.group.id}) already seeded${added ? "; added the step-5 split examples" : ""}${groceries ? "; added the Pantry and Tacos for 5" : ""}; pass --reset (npm run seed:demo) to rebuild`);
  await printAccess(existing.group.id);
  process.exit(0);
}
if (existing) {
  await groups.deleteGroup(existing.group.id);
  console.log(`deleted the old "${existing.group.name}" (${existing.group.id})`);
}

const [group] = await db
  .insert(schema.groups)
  .values({ name: NAME, purpose: "roommates", currency: "USD", timezone: "America/Chicago", onboardedAt: ago(26), createdAt: ago(26) })
  .returning();
const gid = group.id;
await db.insert(schema.chats).values({ groupId: gid, channel: "dev", externalId: CHAT, title: NAME, createdAt: ago(26) });
await groups.initToolkits(gid, presetFor("roommates")); // the roommates preset (toolkits/presets.ts)

const person = async (displayName: string, role: "admin" | "member", status: "active" | "pending", joinedDaysAgo: number) => {
  const [m] = await db
    .insert(schema.members)
    .values({ groupId: gid, displayName, channelUserId: devUserId(displayName), role, status, joinedAt: ago(joinedDaysAgo) })
    .returning();
  return m.id;
};
const M = await person("Maya", "admin", "active", 26);
const D = await person("Dev", "member", "active", 26);
const S = await person("Sam", "member", "active", 25);
const P = await person("Priya", "member", "pending", 2);
await db.update(schema.groups).set({ createdBy: M }).where(eq(schema.groups.id, gid));
const all = [M, D, S];

await db.insert(schema.memberNotes).values([
  { memberId: M, note: { handles: { venmo: "@maya-r", paypal: "maya.r@gmail.com" } } },
  { memberId: D, note: { handles: { venmo: "@devp", cashapp: "$devpatel" } } },
  { memberId: S, note: { handles: { cashapp: "$samkim", paypal: "samkim@icloud.com" } } },
]);

const activity: (typeof schema.activity.$inferInsert)[] = [
  { groupId: gid, actorMemberId: null, kind: "group.created", summary: "joined the chat. Maya is the first admin", createdAt: ago(26) },
  { groupId: gid, actorMemberId: null, kind: "member.pending", summary: "added Priya as a pending member", refTable: "members", refId: P, createdAt: ago(2) },
];

/* ----- money: 12 Expenses (equal splits) and 2 Settlements over three weeks ----- */
const expense = async (daysAgo: number, payerId: string, cents: number, description: string, among = all, source: "chat" | "ui" | "cart" = "chat") => {
  const occurredOn = localDay(ago(daysAgo, 3), group.timezone);
  const [e] = await db
    .insert(schema.expenses)
    .values({ groupId: gid, payerId, cents, description, category: guessCategory(description, source), occurredOn, source, createdBy: payerId, createdAt: ago(daysAgo, 3) })
    .returning();
  await db.insert(schema.expensePayers).values({ expenseId: e.id, memberId: payerId, cents });
  await db.insert(schema.expenseSplits).values(money.splitEvenly(cents, among, payerId).map((r) => ({ expenseId: e.id, ...r })));
  activity.push({ groupId: gid, actorMemberId: payerId, kind: "expense.added", summary: `added ${description}, ${dollars(cents)}`, refTable: "expenses", refId: e.id, createdAt: ago(daysAgo, 3) });
};
await expense(20, M, 12630, "Costco run", all, "cart");
await expense(19, D, 7500, "Internet");
await expense(17, S, 4800, "Pizza night");
await expense(15, M, 9100, "Electricity", all, "ui");
await expense(13, S, 2347, "Cleaning supplies");
await expense(11, D, 18000, "Concert tickets", [D, S]);
await expense(10, M, 9600, "Sunday brunch");
await expense(10, S, 1860, "Uber home", [M, S]);
await expense(7, D, 1299, "Paper towels");
await expense(5, S, 5400, "Water bill");
await expense(2, M, 4125, "Taco night ingredients");
await expense(1, D, 1500, "Movie snacks");
const settle = async (daysAgo: number, fromId: string, toId: string, cents: number, from: string, to: string) => {
  const [s] = await db.insert(schema.settlements).values({ groupId: gid, fromId, toId, cents, createdAt: ago(daysAgo, 2) }).returning();
  activity.push({ groupId: gid, actorMemberId: fromId, kind: "settlement.added", summary: `paid ${to} ${dollars(cents)}`, refTable: "settlements", refId: s.id, createdAt: ago(daysAgo, 2) });
};
await settle(8, S, M, 10841, "Sam", "Maya");
await settle(4, S, D, 2866, "Sam", "Dev");

/* ----- Cart ----- */
await db.insert(schema.cartItems).values([
  { groupId: gid, name: "Oat milk", qty: "2 cartons", addedBy: M, shared: false, estCents: 898, createdAt: ago(1, 6) },
  { groupId: gid, name: "Eggs", qty: "18", addedBy: M, shared: true, estCents: 579, createdAt: ago(1, 5) },
  { groupId: gid, name: "Coffee beans", qty: "2 lb", addedBy: S, shared: true, estCents: 1399, createdAt: ago(1, 4) },
  { groupId: gid, name: "Dish soap", qty: "1", addedBy: S, shared: true, estCents: 399, createdAt: ago(1, 3) },
  { groupId: gid, name: "Greek yogurt", qty: "32 oz", addedBy: D, shared: false, estCents: 649, createdAt: ago(0, 9) },
  { groupId: gid, name: "Hot sauce", qty: "1", addedBy: S, shared: false, estCents: 499, createdAt: ago(0, 8) },
  { groupId: gid, name: "Sparkling water", qty: "12 pack", addedBy: D, shared: true, estCents: 599, createdAt: ago(0, 7) },
]);

/* ----- chores: whose turn = whoever did it longest ago. Trash is Maya's today, dishes Dev's. ----- */
const chart = await db
  .insert(schema.chores)
  .values([
    { groupId: gid, name: "Take out the trash", everyDays: 2 },
    { groupId: gid, name: "Dishes", everyDays: 1 },
    { groupId: gid, name: "Water the plants", everyDays: 3 },
    { groupId: gid, name: "Vacuum the living room", everyDays: 7 },
    { groupId: gid, name: "Clean the bathroom", everyDays: 7 },
  ])
  .returning();
const chore = (name: string) => chart.find((c) => c.name === name)!.id;
const logs: [string, string, number][] = [
  ["Take out the trash", S, 2],
  ["Take out the trash", D, 4],
  ["Take out the trash", M, 6],
  ["Dishes", S, 1],
  ["Dishes", S, 2],
  ["Dishes", M, 3],
  ["Dishes", D, 5],
  ["Water the plants", D, 2],
  ["Water the plants", M, 5],
  ["Water the plants", S, 8],
  ["Vacuum the living room", D, 4],
  ["Vacuum the living room", S, 11],
  ["Vacuum the living room", M, 18],
  ["Clean the bathroom", M, 3],
  ["Clean the bathroom", D, 10],
  ["Clean the bathroom", S, 17],
];
await db.insert(schema.choreLogs).values(logs.map(([name, memberId, d]) => ({ choreId: chore(name), memberId, doneAt: ago(d, 2) })));
activity.push({ groupId: gid, actorMemberId: S, kind: "chore.done", summary: "marked Dishes done", refTable: "chores", refId: chore("Dishes"), createdAt: ago(1, 2) });

/* ----- upkeep and reminders ----- */
await db.insert(schema.maintenance).values([
  { groupId: gid, item: "Smoke detector batteries", everyDays: 182, lastDone: ago(180) },
  { groupId: gid, item: "HVAC filter", everyDays: 91, lastDone: ago(86) },
  { groupId: gid, item: "Descale the kettle", everyDays: 30, lastDone: ago(8) },
  { groupId: gid, item: "Fridge coils", everyDays: 365, lastDone: ago(256) },
]);
await db.insert(schema.reminders).values([
  { groupId: gid, text: "Rent is due", dueAt: new Date(now.getTime() + 4 * DAY), recurring: "monthly" },
  { groupId: gid, text: "Venmo Maya for brunch", dueAt: new Date(now.getTime() + DAY), memberId: D },
]);

/* ----- chat: what Roomie said lately (Home's narration) and a little chatter ----- */
const chat: [string | null, number, number, string][] = [
  [S, 4, 3, "sent dev the concert money"],
  [null, 4, 2, "Sam paid Dev $28.66 on Cash App. Noted."],
  [M, 2, 5, "tacos tonight, I grabbed everything"],
  [null, 2, 4, "Taco night ingredients: $41.25 from Maya, split three ways."],
  [null, 2, 1, "Priya joined the chat. I'll help her out, but I'm waiting on Maya to approve her before I log anything for her."],
  [S, 1, 3, "dishes done again"],
  [null, 1, 2, "Sam did the dishes again. Two days in a row, I'm keeping count."],
  [D, 1, 1, "roomie I paid 15 for movie snacks"],
  [null, 1, 0.9, "Logged Dev's $15.00 for movie snacks, split three ways: $5.00 each."],
  [null, 0, 2, "Trash is on Maya today. Dev has dishes."],
];
await db.insert(schema.chatMessages).values(chat.map(([memberId, d, h, text]) => ({ groupId: gid, memberId, text, createdAt: ago(d, h) })));
await db.insert(schema.activity).values(activity);
await addSplitDemos(gid);
await addGroceriesDemos(gid);

/* ---------- summary ---------- */
const ctx = { groupId: gid };
const [balances, plan, status, due] = await Promise.all([money.getBalances(ctx), money.getSettlePlan(ctx), choresSvc.choreStatus(ctx), upkeepSvc.dueMaintenance(ctx)]);
console.log(`${RESET ? "rebuilt" : "seeded"} "${NAME}" ${gid}`);
console.log("  balances:", balances.map((b) => `${b.name} ${b.cents >= 0 ? "+" : "-"}${dollars(Math.abs(b.cents))}`).join(", "));
console.log("  settle:  ", plan.map((t) => `${t.fromName} -> ${t.toName} ${dollars(t.cents)}`).join("; ") || "all square");
console.log("  chores:  ", status.map((c) => `${c.name} [${c.whoseTurn}'s turn${c.overdue ? ", due" : ""}]`).join(", "));
console.log("  upkeep:  ", due.map((m) => `${m.item} (${m.status})`).join(", ") || "nothing due");
await printAccess(gid);
process.exit(0);
