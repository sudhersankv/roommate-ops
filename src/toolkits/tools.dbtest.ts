// Integration tests for every Roomie tool against the real dev DB (no LLM involved).
// Run: npm run test:tools   (tsx --test src/toolkits/tools.dbtest.ts; src/lib/env loads .env)
// Not named *.test.ts on purpose: `npm test` runs without .env and must not pick this up.
//
// Isolation: `before` onboards a throwaway Group ("Test Group <ts>", Sudhersan is the Admin); `after` deletes every row
// that references it and asserts the DB is clean. The seeded "Apt 4B" rows are never touched.
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { isValidationError } from "@mastra/core/tools";
import { RequestContext } from "@mastra/core/request-context";
import { db, schema } from "@/db";
import type { Ctx } from "@/services/types";
import type { Balance, Expense, Transfer } from "@/services/money";
import type { ChoreStatus, ShameRow } from "@/services/chores";
import type { Reminder } from "@/services/reminders";
import type { MaintenanceItem } from "@/services/upkeep";
import type { CartItem } from "@/services/cart";
import { devUserId } from "@/channels/dev";
import { onGroupJoined, onParticipantJoined } from "@/onboarding";
import { deleteGroup } from "@/services/groups";
import { allTools } from "./registry";

type Tools = ReturnType<typeof allTools>;
type ToolId = keyof Tools;
type ToolInput<K extends ToolId> = Parameters<NonNullable<Tools[K]["execute"]>>[0];
type AnyTool = { id: string; execute?: (input: unknown, context: unknown) => Promise<unknown> };

const NAMES = ["Sudhersan", "Ryan", "Alex"] as const;

let groupId: string;
let member: Record<(typeof NAMES)[number], string>;
let ctx: Ctx;
let requestContext: RequestContext;
let tools: Tools;
const covered = new Set<string>();

const contextFor = (memberId: string, name: string, role: "admin" | "member", status: "active" | "pending"): RequestContext =>
  new RequestContext<unknown>([
    ["groupId", groupId],
    ["memberId", memberId],
    ["memberName", name],
    ["role", role],
    ["status", status],
    ["source", "chat"],
  ]);

/** Call a tool's execute the way the agent runtime would: Mastra validates the input; the Group comes from requestContext. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function run<K extends ToolId>(id: K, input: ToolInput<K>, rc = requestContext): Promise<any> {
  covered.add(id);
  const tool = tools[id] as unknown as AnyTool;
  assert.ok(tool.execute, `${id} has no execute`);
  const out = await tool.execute(input, { requestContext: rc });
  if (isValidationError(out)) throw new Error(`${id} rejected input: ${JSON.stringify(out)}`);
  return out;
}

type GroupTable = PgTable & { groupId: PgColumn };
const count = async (table: GroupTable) =>
  Number((await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.groupId, groupId)))[0].n);

describe("Roomie tools against the dev DB", () => {
  before(async () => {
    const people = NAMES.map((name) => ({ userExternalId: devUserId(`test-${name}-${Date.now()}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `test-${Date.now()}`, title: `Test Group ${Date.now()}` }, people, people[0]);
    groupId = joined.group.id;
    member = Object.fromEntries(joined.members.map((r) => [r.displayName, r.id])) as typeof member;
    ctx = { groupId, memberId: member.Sudhersan, source: "chat" };
    requestContext = contextFor(member.Sudhersan, "Sudhersan", "admin", "active");
    tools = allTools();
  });

  after(async () => {
    try {
      if (!groupId) return;
      await deleteGroup(groupId);
      // Verify nothing is left behind.
      const tables: [string, GroupTable][] = [
        ["expenses", schema.expenses],
        ["settlements", schema.settlements],
        ["reminders", schema.reminders],
        ["maintenance", schema.maintenance],
        ["cart_items", schema.cartItems],
        ["chat_messages", schema.chatMessages],
        ["activity", schema.activity],
        ["members", schema.members],
        ["chores", schema.chores],
        ["chats", schema.chats],
        ["group_toolkits", schema.groupToolkits],
      ];
      for (const [name, t] of tables) assert.equal(await count(t), 0, `leftover rows in ${name}`);
      const [orphans] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(schema.expenseSplits)
        .leftJoin(schema.expenses, eq(schema.expenseSplits.expenseId, schema.expenses.id))
        .where(sql`${schema.expenses.id} is null`);
      assert.equal(Number(orphans.n), 0, "orphan expense_splits");
      const left = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
      assert.equal(left.length, 0, "test Group still exists");
    } finally {
      await db.$client.end();
    }
  });

  // ---------- members ----------

  test("list_members returns the 3 test members with role and status; the adder is the Admin", async () => {
    const list: { name: string; role: string; status: string }[] = await run("list_members", {});
    assert.deepEqual(list.map((m) => m.name).sort(), [...NAMES].sort());
    assert.deepEqual(list.find((m) => m.name === "Sudhersan"), { name: "Sudhersan", role: "admin", status: "active" });
    assert.ok(list.filter((m) => m.name !== "Sudhersan").every((m) => m.role === "member" && m.status === "active"), "people already in the chat are active");
  });
  test("unknown member name throws a helpful error listing the members", async () => {
    await assert.rejects(run("log_expense", { amount: 10, description: "pizza", payer: "Dev" }), /No member named "Dev".*Sudhersan/);
    await assert.rejects(run("log_chore", { chore: "dishes", who: "Sam" }), /No member named "Sam"/);
    await assert.rejects(run("set_reminder", { text: "x", dueAt: new Date().toISOString(), who: "Maya" }), /No member named "Maya"/);
  });

  test("schema validation: negative dollars never reach the service", async () => {
    const tool = tools.log_expense as unknown as AnyTool;
    const out = await tool.execute!({ amount: -5, description: "nope" }, { requestContext });
    assert.ok(isValidationError(out), "expected a ValidationError object");
    assert.equal(await count(schema.expenses), 0);
  });

  test("a tool called without the Group in requestContext refuses", async () => {
    const tool = tools.list_members as unknown as AnyTool;
    await assert.rejects(tool.execute!({}, { requestContext: new RequestContext() }), /groupId and memberId/);
  });

  // ---------- money ----------

  test("log_expense: '$60 internet' -> 6000 cents, 3 even splits, payer = sender", async () => {
    const e: Expense = await run("log_expense", { amount: 60, description: "internet" });
    assert.equal(e.cents, 6000);
    assert.equal(e.payerName, "Sudhersan");
    assert.equal(e.splits?.length, 3);
    for (const s of e.splits ?? []) assert.equal(s.cents, 2000);

    const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, e.id));
    assert.equal(row.cents, 6000);
    assert.equal(row.payerId, member.Sudhersan);
    assert.equal(row.source, "chat");
    const splits = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, e.id));
    assert.equal(splits.length, 3);
    assert.equal(splits.reduce((s, r) => s + r.cents, 0), 6000);
  });

  test("log_expense: payer by name, split among a subset, odd cent goes to the payer", async () => {
    const e: Expense = await run("log_expense", { amount: 10.01, description: "beer", payer: "Ryan", splitAmong: ["Ryan", "Alex"] });
    assert.equal(e.cents, 1001);
    assert.equal(e.payerName, "Ryan");
    const by = Object.fromEntries((e.splits ?? []).map((s) => [s.name, s.cents]));
    assert.deepEqual(by, { Ryan: 501, Alex: 500 });
  });

  test("get_balances: who owes what + settle plan (cents, nets to zero)", async () => {
    const { balances, settlePlan }: { balances: Balance[]; settlePlan: Transfer[] } = await run("get_balances", {});
    const by = Object.fromEntries(balances.map((b) => [b.name, b.cents]));
    // internet: S +4000, R -2000, A -2000. beer: R +500, A -500.
    assert.deepEqual(by, { Sudhersan: 4000, Ryan: -1500, Alex: -2500 });
    assert.equal(balances.reduce((s, b) => s + b.cents, 0), 0);
    assert.equal(settlePlan.reduce((s, t) => s + t.cents, 0), 4000);
    for (const t of settlePlan) assert.equal(t.toName, "Sudhersan");
    assert.equal(settlePlan[0].fromName, "Alex", "biggest debtor pays first");
  });

  test("settle_up: 'Alex paid Sudhersan back $25' zeroes Alex", async () => {
    const r = await run("settle_up", { to: "Sudhersan", amount: 25, from: "Alex" });
    assert.deepEqual(r, { ok: true });
    const rows = await db.select().from(schema.settlements).where(eq(schema.settlements.groupId, groupId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cents, 2500);
    assert.equal(rows[0].fromId, member.Alex);
    assert.equal(rows[0].toId, member.Sudhersan);
    const { balances }: { balances: Balance[] } = await run("get_balances", {});
    assert.equal(balances.find((b) => b.name === "Alex")?.cents, 0);
    assert.equal(balances.find((b) => b.name === "Sudhersan")?.cents, 1500);
  });

  test("settle_up: default payer is the sender; paying yourself is rejected", async () => {
    await assert.rejects(run("settle_up", { to: "Sudhersan", amount: 1 }), /yourself/);
    await run("settle_up", { to: "Ryan", amount: 1 });
    const mine = await db.select().from(schema.settlements).where(eq(schema.settlements.fromId, member.Sudhersan));
    assert.equal(mine.length, 1);
    assert.equal(mine[0].cents, 100);
    assert.equal(mine[0].toId, member.Ryan);
  });

  test("list_expenses: newest first with splits; limit respected", async () => {
    const list: Expense[] = await run("list_expenses", {});
    assert.equal(list.length, 2);
    assert.equal(list[0].description, "beer");
    assert.equal(list[1].description, "internet");
    assert.equal(list[1].splits?.length, 3);
    const one: Expense[] = await run("list_expenses", { limit: 1 });
    assert.equal(one.length, 1);
  });

  // ---------- chores ----------

  test("add_chore puts chores on the chart; same name again updates the cadence", async () => {
    assert.deepEqual(await run("add_chore", { name: "Dishes", everyDays: 1 }), { ok: true, chore: "Dishes", everyDays: 1 });
    await run("add_chore", { name: "Take out trash", everyDays: 3 });
    await run("add_chore", { name: "take out trash", everyDays: 2 });
    const chart = await db.select().from(schema.chores).where(eq(schema.chores.groupId, groupId));
    assert.deepEqual(
      chart.map((c) => [c.name, c.everyDays]).sort(),
      [
        ["Dishes", 1],
        ["Take out trash", 2],
      ],
    );
  });

  test("log_chore: 'the dishes' fuzzy-matches Dishes for the sender; 'trash' for Alex by name", async () => {
    const r: { chore: string; streak: number } = await run("log_chore", { chore: "the dishes" });
    assert.equal(r.chore, "Dishes");
    assert.equal(r.streak, 1);
    const r2: { chore: string; streak: number } = await run("log_chore", { chore: "the dishes" });
    assert.equal(r2.streak, 2, "two in a row by the same person");
    const r3: { chore: string; streak: number } = await run("log_chore", { chore: "trash", who: "Alex" });
    assert.equal(r3.chore, "Take out trash");

    const logs = await db
      .select({ memberId: schema.choreLogs.memberId, name: schema.chores.name })
      .from(schema.choreLogs)
      .innerJoin(schema.chores, eq(schema.choreLogs.choreId, schema.chores.id))
      .where(eq(schema.chores.groupId, groupId));
    assert.equal(logs.length, 3);
    assert.equal(logs.filter((l) => l.memberId === member.Sudhersan && l.name === "Dishes").length, 2);
    assert.equal(logs.filter((l) => l.memberId === member.Alex && l.name === "Take out trash").length, 1);
    assert.equal((await db.select().from(schema.chores).where(eq(schema.chores.groupId, groupId))).length, 2, "no new chore was created");
  });

  test("log_chore: an unknown chore is added to the chart (every 7 days)", async () => {
    const r: { chore: string } = await run("log_chore", { chore: "watered the plants" });
    assert.equal(r.chore, "watered the plants");
    const [c] = await db
      .select()
      .from(schema.chores)
      .where(and(eq(schema.chores.groupId, groupId), eq(schema.chores.name, "watered the plants")));
    assert.equal(c.groupId, groupId);
    assert.equal(c.everyDays, 7);
  });

  test("chore_status: last done by, whose turn, Hall of Shame worst first", async () => {
    const { chores, shame }: { chores: ChoreStatus[]; shame: ShameRow[] } = await run("chore_status", {});
    const dishes = chores.find((c) => c.name === "Dishes");
    assert.equal(dishes?.lastDoneBy, "Sudhersan");
    assert.equal(dishes?.overdue, false);
    assert.ok(dishes?.whoseTurn === "Alex" || dishes?.whoseTurn === "Ryan", "someone who hasn't done dishes is up next");
    const trash = chores.find((c) => c.name === "Take out trash");
    assert.equal(trash?.lastDoneBy, "Alex");
    // Ryan did nothing -> worst. Then Alex (1) before Sudhersan (3).
    assert.deepEqual(
      shame.map((s) => s.name),
      ["Ryan", "Alex", "Sudhersan"],
    );
    assert.equal(shame[0].daysSinceLastChore, null);
    assert.equal(shame[0].choresThisWeek, 0);
    assert.equal(shame[2].choresThisWeek, 3);
  });

  // ---------- reminders ----------

  let trashReminderId: string;

  test("set_reminder: for Ryan by name; monthly for everyone", async () => {
    const due = new Date(Date.now() + 3 * 24 * 3600_000);
    const r: Reminder = await run("set_reminder", { text: "Trash goes out at 8pm", dueAt: due.toISOString(), who: "Ryan" });
    trashReminderId = r.id;
    assert.equal(r.memberName, "Ryan");
    assert.equal(r.memberId, member.Ryan);
    assert.equal(r.recurring, null);
    assert.equal(r.dueAt.getTime(), due.getTime());

    const rent: Reminder = await run("set_reminder", { text: "Rent is due", dueAt: due.toISOString(), monthly: true });
    assert.equal(rent.memberId, null);
    assert.equal(rent.recurring, "monthly");

    const rows = await db.select().from(schema.reminders).where(eq(schema.reminders.groupId, groupId));
    assert.equal(rows.length, 2);
    assert.ok(rows.every((x) => x.sentAt === null));
  });

  test("set_reminder: bad date is rejected by the service", async () => {
    await assert.rejects(run("set_reminder", { text: "x", dueAt: "next tuesday-ish" }), /not a real date/);
  });

  test("list_reminders: upcoming, soonest first", async () => {
    const list: Reminder[] = await run("list_reminders", {});
    assert.deepEqual(list.map((r) => r.text).sort(), ["Rent is due", "Trash goes out at 8pm"]);
    assert.equal(list.find((r) => r.id === trashReminderId)?.memberName, "Ryan");
  });

  test("cancel_reminder: by text, then by id; unknown throws with the list", async () => {
    const c: { id: string; cancelled: string } = await run("cancel_reminder", { text: "trash goes" });
    assert.equal(c.id, trashReminderId);
    const left: Reminder[] = await run("list_reminders", {});
    assert.equal(left.length, 1);
    await assert.rejects(run("cancel_reminder", { text: "nothing like this" }), /No upcoming reminder matches.*Rent is due/);
    await run("cancel_reminder", { reminderId: left[0].id });
    assert.equal(await count(schema.reminders), 0);
    await assert.rejects(run("cancel_reminder", { text: "rent" }), /no upcoming reminders/);
  });

  // ---------- upkeep ----------

  test("add_maintenance + maintenance_status: never done = overdue", async () => {
    assert.deepEqual(await run("add_maintenance", { item: "Replace HVAC filter", everyDays: 90 }), { ok: true });
    await run("add_maintenance", { item: "Test smoke alarms", everyDays: 180 });
    const all: MaintenanceItem[] = await run("maintenance_status", {});
    assert.deepEqual(all.map((m) => [m.item, m.status]).sort(), [
      ["Replace HVAC filter", "overdue"],
      ["Test smoke alarms", "overdue"],
    ]);
    const due: MaintenanceItem[] = await run("maintenance_status", { dueOnly: true });
    assert.equal(due.length, 2);
  });

  test("maintenance_done: fuzzy 'hvac filter' marks it done; unknown item throws with known items", async () => {
    await run("maintenance_done", { item: "hvac filter" });
    const [row] = await db
      .select()
      .from(schema.maintenance)
      .where(and(eq(schema.maintenance.groupId, groupId), eq(schema.maintenance.item, "Replace HVAC filter")));
    assert.ok(row.lastDone && Date.now() - row.lastDone.getTime() < 60_000, "lastDone set to now");
    const due: MaintenanceItem[] = await run("maintenance_status", { dueOnly: true });
    assert.deepEqual(
      due.map((m) => m.item),
      ["Test smoke alarms"],
    );
    const all: MaintenanceItem[] = await run("maintenance_status", {});
    const hvac = all.find((m) => m.item === "Replace HVAC filter");
    assert.equal(hvac?.status, "ok");
    assert.ok(hvac?.nextDue && hvac.nextDue.getTime() - row.lastDone!.getTime() === 90 * 86_400_000);
    await assert.rejects(run("maintenance_done", { item: "gutters" }), /No upkeep item matches "gutters".*Replace HVAC filter/);
  });

  // ---------- report ----------

  test("group_report: ready-to-post text built from every card", async () => {
    const r: { text: string } = await run("group_report", {});
    assert.equal(typeof r.text, "string");
    assert.match(r.text, /Group report/);
    assert.match(r.text, /Ryan pays Sudhersan \$16\.00/, "settle plan from the ledger (1500 + the $1 Sudhersan sent Ryan)");
    assert.match(r.text, /Chores on track/);
    assert.match(r.text, /Behind on chores: Ryan/);
    assert.match(r.text, /Nothing scheduled/);
    assert.match(r.text, /Overdue upkeep: Test smoke alarms/);
    assert.doesNotMatch(r.text, /Replace HVAC filter/);
    assert.ok(r.text.split("\n").length <= 12, "stays short");
  });

  // ---------- cart (estimates from lib/prices; Instacart checkout is not wired yet) ----------

  type Link = { text: string; url: string };
  type CartAdd = { items: CartItem[]; addedTotalCents: number; addedTotal: string; cartItemCount: number; cartTotalCents: number; cartTotal: string; links?: Link[] };
  type CartView = { groups: Record<string, CartItem[]>; itemCount: number; estTotalCents: number; estTotal: string; links?: Link[] };
  const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");

  test("cart_add: '3 bags of chips for me' + a shared item; estimates from the catalog; View-cart link attached", async () => {
    const added: CartAdd = await run("cart_add", { items: [{ name: "chips", qty: "3 bags" }] });
    assert.equal(added.items.length, 1);
    assert.equal(added.items[0].name, "chips");
    assert.equal(added.items[0].qty, "3 bags");
    assert.equal(added.items[0].addedByName, "Sudhersan");
    assert.equal(added.items[0].estCents, 3 * 449, "3 x catalog price of chips");
    assert.equal(added.addedTotalCents, 3 * 449, "total of the items just added");
    assert.equal(added.addedTotal, "$13.47");
    assert.equal(added.cartTotalCents, 3 * 449, "first add into an empty cart: cart total = added total");
    assert.equal(added.cartItemCount, 1);
    if (/^https?:\/\//i.test(appUrl)) {
      assert.deepEqual(
        added.links?.map((b) => b.url),
        [`${appUrl}/g/${groupId}/cart`],
        "only the View cart link",
      );
      assert.ok(/view cart/i.test(added.links![0].text));
    } else {
      assert.equal(added.links, undefined, "no APP_URL -> no links");
    }

    const second: CartAdd = await run("cart_add", { items: [{ name: "dish soap" }], shared: true });
    assert.equal(second.addedTotalCents, 349, "addedTotal is only the new item");
    assert.equal(second.cartTotalCents, 1347 + 349, "cartTotal is the whole open cart");
    assert.equal(second.cartItemCount, 2);
    const rows = await db.select().from(schema.cartItems).where(eq(schema.cartItems.groupId, groupId));
    assert.equal(rows.length, 2);
    const chips = rows.find((r) => r.name === "chips");
    assert.equal(chips?.qty, "3 bags");
    assert.equal(chips?.addedBy, member.Sudhersan);
    assert.equal(chips?.shared, false);
    assert.equal(chips?.status, "open");
    assert.equal(chips?.estCents, 1347);
    const soap = rows.find((r) => r.name === "dish soap");
    assert.equal(soap?.shared, true);
    assert.equal(soap?.qty, "1");
    assert.equal(soap?.estCents, 349);
  });

  test("cart_view groups open items by who added them, with the estimated total", async () => {
    const view: CartView = await run("cart_view", {});
    const all = Object.values(view.groups).flat();
    assert.deepEqual(all.map((i) => i.name).sort(), ["chips", "dish soap"]);
    assert.ok(Object.keys(view.groups).some((k) => /sudhersan/i.test(k)), "a group for the sender");
    assert.ok(Object.keys(view.groups).some((k) => /shared/i.test(k)), "a Shared group");
    assert.equal(view.groups.Shared?.[0]?.name, "dish soap");
    assert.equal(view.itemCount, 2);
    assert.equal(view.estTotalCents, 1347 + 349);
    assert.equal(view.estTotal, "$16.96");
  });

  test("cart_remove by name", async () => {
    await run("cart_add", { items: [{ name: "oat milk", qty: "2" }] });
    assert.deepEqual(await run("cart_remove", { name: "Oat Milk" }), { removed: true });
    assert.deepEqual(await run("cart_remove", { name: "caviar" }), { removed: false });
    const open = await db.select().from(schema.cartItems).where(eq(schema.cartItems.groupId, groupId));
    assert.deepEqual(open.filter((r) => r.status === "open").map((r) => r.name).sort(), ["chips", "dish soap"]);
  });

  test("cart_checkout says Instacart checkout is coming soon, with the cart summary and no button", async () => {
    const r: { available: boolean; message: string; itemCount: number; estTotalCents: number; url?: unknown } = await run("cart_checkout", {});
    assert.equal(r.available, false);
    assert.match(r.message, /coming soon/i);
    assert.equal(r.itemCount, 2);
    assert.equal(r.estTotalCents, 1347 + 349);
    assert.ok(!("url" in r), "no checkout link");
    assert.ok(!("links" in r), "no checkout button");
  });

  test("cart_purchased: one expense split by who added what (shared split evenly), items marked purchased", async () => {
    const before = await count(schema.expenses);
    const e: Expense = await run("cart_purchased", { total: 30 });
    assert.equal(e.cents, 3000);
    assert.equal(e.payerName, "Sudhersan");
    assert.match(e.description, /Groceries \(2 items\)/);
    assert.equal(await count(schema.expenses), before + 1);
    const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, e.id));
    assert.equal(row.source, "cart");
    const splits = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, e.id));
    assert.equal(splits.reduce((s, r) => s + r.cents, 0), 3000);
    assert.equal(splits.length, 3, "chips -> Sudhersan, dish soap -> everyone");
    const cents = Object.fromEntries(splits.map((s) => [s.memberId, s.cents]));
    // weights: Sudhersan 1347 + 349/3, Ryan 349/3, Alex 349/3 (of 1696), scaled to 3000.
    assert.ok(cents[member.Sudhersan] >= 2588 && cents[member.Sudhersan] <= 2590, `Sudhersan got ${cents[member.Sudhersan]}`);
    assert.ok(Math.abs(cents[member.Ryan] - cents[member.Alex]) <= 1, "shared item split evenly");
    assert.ok(cents[member.Ryan] >= 205 && cents[member.Ryan] <= 206);
    const items = await db.select().from(schema.cartItems).where(eq(schema.cartItems.groupId, groupId));
    assert.ok(items.filter((r) => r.name !== "oat milk").every((r) => r.status === "purchased"), "cart items marked purchased");
    const view: CartView = await run("cart_view", {});
    assert.deepEqual(view.groups, {});
    assert.equal(view.estTotalCents, 0);
  });

  test("cart_purchased: payer by name; people with nothing in the cart are left out of the split; empty cart throws", async () => {
    await run("cart_add", { items: [{ name: "milk" }] });
    const e: Expense = await run("cart_purchased", { total: 5, payer: "Ryan" });
    assert.equal(e.payerName, "Ryan");
    assert.equal(e.cents, 500);
    assert.deepEqual(
      (e.splits ?? []).map((s) => [s.name, s.cents]),
      [["Sudhersan", 500]],
      "Sudhersan's milk, paid by Ryan: only Sudhersan owes",
    );
    await assert.rejects(run("cart_purchased", { total: 5 }), /cart is empty/i);
    await assert.rejects(run("cart_purchased", { total: 5, payer: "Dev" }), /No member named "Dev"/);
  });

  test("cart_purchased: a double-click charges once; a failed purchase leaves the items open", async () => {
    await run("cart_add", { items: [{ name: "bread" }] });
    const before = await count(schema.expenses);
    const [first, second] = await Promise.allSettled([run("cart_purchased", { total: 4 }), run("cart_purchased", { total: 4 })]);
    const ok = [first, second].filter((r) => r.status === "fulfilled");
    const failed = [first, second].filter((r) => r.status === "rejected");
    assert.equal(ok.length, 1, "exactly one of two concurrent purchases wins");
    assert.equal(failed.length, 1);
    assert.match(String((failed[0] as PromiseRejectedResult).reason), /cart is empty/i);
    assert.equal(await count(schema.expenses), before + 1, "one expense, not two");
    // A purchase whose expense can't be logged (payer not an active member) must roll the items back to open.
    await run("cart_add", { items: [{ name: "bagels" }] });
    const cartService = await import("@/services/cart");
    await assert.rejects(cartService.markPurchased(ctx, { totalCents: 400, payerId: "00000000-0000-0000-0000-000000000000" }), /who paid/i);
    const open = await db.select().from(schema.cartItems).where(eq(schema.cartItems.groupId, groupId));
    assert.deepEqual(open.filter((r) => r.status === "open").map((r) => r.name), ["bagels"], "items stay open after a failed purchase");
    assert.equal(await count(schema.expenses), before + 1);
    await run("cart_purchased", { total: 4 });
  });

  // ---------- identity: Pending members, Admins, settings, Claim links, forget me ----------

  let priya: string;
  let priyaRc: RequestContext;

  test("someone who joins later is Pending: Roomie asks the Admin; reads work, writes are refused kindly", async () => {
    const joined = await onParticipantJoined(groupId, { userExternalId: devUserId(`test-priya-${Date.now()}`), name: "Priya" });
    priya = joined.member.id;
    assert.equal(joined.member.status, "pending");
    assert.match(joined.announce?.text ?? "", /Sudhersan.*approve Priya/);
    priyaRc = contextFor(priya, "Priya", "member", "pending");
    const before = await count(schema.expenses);
    const refused = await run("log_expense", { amount: 20, description: "pizza" }, priyaRc);
    assert.equal(refused.notAllowed, true);
    assert.equal(refused.reason, "pending");
    assert.match(refused.message, /approve you first.*Sudhersan/);
    assert.equal(await count(schema.expenses), before, "nothing logged for a Pending member");
    const { balances }: { balances: Balance[] } = await run("get_balances", {}, priyaRc);
    assert.ok(!balances.some((b) => b.name === "Priya"), "Pending members aren't in the ledger");
    assert.deepEqual((await run("list_pending", {})).map((m: { name: string }) => m.name), ["Priya"]);
  });

  test("only an Admin approves; once approved, Priya's expense is logged and split 4 ways", async () => {
    const ryan = contextFor(member.Ryan, "Ryan", "member", "active");
    const no = await run("approve_member", { name: "Priya" }, ryan);
    assert.equal(no.reason, "admin-only");
    assert.match(no.message, /Only an admin.*Sudhersan/);
    assert.deepEqual(await run("approve_member", { name: "priya" }), { approved: "Priya" });
    const e: Expense = await run("log_expense", { amount: 20, description: "pizza" }, contextFor(priya, "Priya", "member", "active"));
    assert.equal(e.payerName, "Priya");
    assert.equal(e.splits?.length, 4);
    assert.deepEqual((await run("list_pending", {})), []);
  });

  test("decline_member removes a Pending member; promote_member makes an Admin", async () => {
    const zed = await onParticipantJoined(groupId, { userExternalId: devUserId(`test-zed-${Date.now()}`), name: "Zed" });
    assert.deepEqual(await run("decline_member", { name: "Zed" }), { declined: "Zed" });
    const [row] = await db.select().from(schema.members).where(eq(schema.members.id, zed.member.id));
    assert.equal(row.status, "removed");
    assert.deepEqual(await run("promote_member", { name: "Ryan" }), { promoted: "Ryan" });
    const [ryan] = await db.select().from(schema.members).where(eq(schema.members.id, member.Ryan));
    assert.equal(ryan.role, "admin");
  });

  test("set_group_settings (Admin): Onboarding answer picks the purpose's Toolkits; toggle_toolkit switches one", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    assert.equal((await run("set_group_settings", { currency: "EUR" }, alex)).reason, "admin-only");
    const s = await run("set_group_settings", { purpose: "trip", currency: "eur", timezone: "Europe/Berlin" });
    assert.equal(s.currency, "EUR");
    assert.equal(s.timezone, "Europe/Berlin");
    assert.deepEqual([...s.toolkits].sort(), ["groceries", "splitting"]);
    const [g] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
    assert.ok(g.onboardedAt, "Onboarding is done");
    await assert.rejects(run("set_group_settings", { timezone: "Mars/Olympus" }), /isn't a time zone/);
    const t = await run("toggle_toolkit", { toolkit: "chores", enabled: true }, contextFor(member.Ryan, "Ryan", "admin", "active"));
    assert.ok(t.toolkits.includes("chores"));
    assert.equal((await run("toggle_toolkit", { toolkit: "upkeep", enabled: true }, alex)).reason, "admin-only");
  });

  test("get_dashboard_link: a Claim link goes out privately (reused while live); with an Account, the dashboard", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    const first = await run("get_dashboard_link", {}, alex);
    assert.deepEqual(first, { kind: "claim", sentPrivately: true, expiresIn: "24 hours" });
    assert.ok(!("links" in first), "Claim links never go into the group chat");
    await run("get_dashboard_link", {}, alex);
    const tokens = await db.select().from(schema.claimTokens).where(eq(schema.claimTokens.memberId, member.Alex));
    assert.equal(tokens.length, 1, "asking twice reuses the live link");

    const claimsSvc = await import("@/services/claims");
    const user = { id: `test-${Date.now()}`, email: `alex-${Date.now()}@example.com`, name: "Alex" };
    try {
      const claimed = await claimsSvc.consumeClaim(tokens[0].token, user);
      assert.equal(claimed.memberId, member.Alex);
      await assert.rejects(claimsSvc.consumeClaim(tokens[0].token, { ...user, id: `${user.id}-other`, email: `x${user.email}` }), /already used/);
      const again = await claimsSvc.consumeClaim(tokens[0].token, user);
      assert.equal(again.memberId, member.Alex, "reloading the claim page as the same Account is fine");
      const next = await run("get_dashboard_link", {}, alex);
      assert.equal(next.kind, "dashboard");
      assert.match(next.links[0].url, new RegExp(`/g/${groupId}$`));
    } finally {
      await db.delete(schema.accounts).where(eq(schema.accounts.authUserId, user.id));
      await db.delete(schema.accounts).where(eq(schema.accounts.authUserId, `${user.id}-other`));
    }
  });

  test("set_payment_handle and forget_me: chat lines and the note go, the ledger stays", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    const h = await run("set_payment_handle", { app: "venmo", handle: "@alex-p" }, alex);
    assert.deepEqual(h.handles, { venmo: "@alex-p" });
    await db.insert(schema.chatMessages).values([
      { groupId, memberId: member.Alex, text: "hi" },
      { groupId, memberId: member.Alex, text: "remember me?" },
    ]);
    const splitsBefore = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.memberId, member.Alex));
    const r = await run("forget_me", {}, alex);
    assert.equal(r.chatLines, 2);
    assert.equal(r.keptLedger, true);
    const lines = await db.select().from(schema.chatMessages).where(and(eq(schema.chatMessages.groupId, groupId), eq(schema.chatMessages.memberId, member.Alex)));
    assert.equal(lines.length, 0);
    assert.equal((await db.select().from(schema.memberNotes).where(eq(schema.memberNotes.memberId, member.Alex))).length, 0);
    const splitsAfter = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.memberId, member.Alex));
    assert.equal(splitsAfter.length, splitsBefore.length, "Shares are kept so Balances still add up");
  });

  // ---------- coverage ----------

  test("every tool in the registry was exercised", () => {
    const all = Object.keys(tools).sort();
    const missing = all.filter((id) => !covered.has(id));
    assert.deepEqual(missing, [], `tools without a test: ${missing.join(", ")}`);
    for (const id of all) assert.equal((tools as unknown as Record<string, AnyTool>)[id].id, id, `key ${id} must equal its tool id`);
  });
});
