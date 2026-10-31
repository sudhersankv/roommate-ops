// Integration tests for every Roomie tool against the Neon dev branch (no LLM involved; refuses the production branch).
// Run: npm run test:tools   (tsx --test src/toolkits/tools.dbtest.ts; src/lib/env loads .env)
// Not named *.test.ts on purpose: `npm test` runs without .env and must not pick this up.
//
// Isolation: `before` onboards a throwaway Group ("Test Group <ts>", Sudhersan is the Admin); `after` deletes every row
// that references it and asserts the DB is clean. The seeded "Apt 4B" rows are never touched. The Splitwise tools run
// in a second throwaway Group (Maya, Dev, Sam, matching the fake's people) against FakeSplitwise; the last test there
// uses the real Composio client to check that a missing or rejected key comes back as "not connected".
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { isValidationError } from "@mastra/core/tools";
import { RequestContext } from "@mastra/core/request-context";
import { db, schema } from "@/db";
import type { Ctx } from "@/services/types";
import type { Balance, Expense, Transfer } from "@/services/money";
import type { ShameRow } from "@/services/chores";
import type { CartItem } from "@/services/cart";
import { registerChannel } from "@/channels";
import { DevChannel, devUserId, type DevOutput } from "@/channels/dev";
import { bundleJob, sendDueReminders, weeklyReportJob } from "@/jobs/scheduler";
import { addDaysInZone, addDaysToDay, dayInZone, nextWeekday, zonedParts, zonedTimeToUtc } from "@/lib/time";
import { onGroupJoined, onParticipantJoined } from "@/onboarding";
import { deleteGroup, groupsWithChat } from "@/services/groups";
import { activity, cart, chatlog, chores, groups, members, money, personality as personalitySvc, receipts, recipes, recurring, schedule, splitwise, toolkits as toolkitsSvc } from "@/services";
import { composioHealth } from "@/integrations/composio";
import { FakeSplitwise, setSplitwiseClient } from "@/integrations/splitwise";
import { ComposioInstacart, FakeInstacart, setInstacartClient } from "@/integrations/instacart";
import { MemoryBlobStore, setBlobStore } from "@/integrations/blob-store";
import { readFile } from "node:fs/promises";
import { runRetention } from "@/jobs/retention";
import { expenseSummary } from "@/services/money";
import * as restock from "@/services/restock";
import * as house from "@/services/house";
import { FakeMail, setMailClient } from "@/integrations/mail";
import * as leaseInbox from "@/services/lease-inbox";
import { processInbound } from "@/services/lease-inbox-inbound";
import { allTools } from "./registry";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

// The tools are called directly here, with no chat message for the admin-only check to read (toolkits/admin-ask.ts).
process.env.ROOMIE_ADMIN_ASK_OFF = "1";

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
// Groceries run against the Instacart fake and the sample recipe (no model call).
const instacart = new FakeInstacart();

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

// Documents' files go to an in-memory store (no object storage in tests).
const blobs = new MemoryBlobStore();
setBlobStore(blobs);
const docExists = async (id: string) => (await db.select({ id: schema.documents.id }).from(schema.documents).where(eq(schema.documents.id, id))).length > 0;

type GroupTable = PgTable & { groupId: PgColumn };
const count = async (table: GroupTable) =>
  Number((await db.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(table.groupId, groupId)))[0].n);

describe("Roomie tools against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "test:tools");
    const people = NAMES.map((name) => ({ userExternalId: devUserId(`test-${name}-${Date.now()}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `test-${Date.now()}`, title: `Test Group ${Date.now()}` }, people, people[0]);
    groupId = joined.group.id;
    member = Object.fromEntries(joined.members.map((r) => [r.displayName, r.id])) as typeof member;
    ctx = { groupId, memberId: member.Sudhersan, source: "chat" };
    requestContext = contextFor(member.Sudhersan, "Sudhersan", "admin", "active");
    tools = allTools();
    setInstacartClient(instacart);
    recipes.setRecipeWriter({ write: async () => recipes.SAMPLE_RECIPE_JSON });
  });

  after(async () => {
    try {
      if (!groupId) return;
      // What lives outside the app's tables goes with the Group too: its traces, scores and uploaded photos.
      const at = new Date().toISOString();
      const trace = `t-group-${groupId}`;
      await db.execute(sql`insert into mastra_ai_spans ("traceId", "spanId", name, "spanType", "isEvent", "startedAt", "createdAt", "createdAtZ", metadata) values (${trace}, 'root', 'roomie message', 'generic', false, ${at}, ${at}, ${at}, ${JSON.stringify({ groupId })}::jsonb)`);
      await db.execute(sql`insert into mastra_ai_spans ("traceId", "spanId", name, "spanType", "isEvent", "startedAt", "createdAt", "createdAtZ") values (${trace}, 'child', 'model', 'generic', false, ${at}, ${at}, ${at})`);
      await db.execute(
        sql`insert into mastra_scorers (id, "scorerId", "runId", scorer, score, input, output, source, "createdAt", "updatedAt", "resourceId") values (${`s-group-${groupId}`}, 'x', 'r', '{}'::jsonb, 1, '{}'::jsonb, '{}'::jsonb, 'LIVE', ${at}, ${at}, ${groupId})`,
      );
      const scan = await receipts.saveUpload(`g-${groupId}`, Buffer.from("a scan"), "image/jpeg");
      assert.ok(await docExists(scan.id));
      await deleteGroup(groupId);
      assert.equal((await db.execute(sql`select 1 from mastra_ai_spans where "traceId" = ${trace}`)).rows.length, 0, "the Group's traces");
      assert.equal((await db.execute(sql`select 1 from mastra_scorers where id = ${`s-group-${groupId}`}`)).rows.length, 0, "the Group's scores");
      assert.equal(await docExists(scan.id), false, "the Group's Documents");
      assert.equal(await blobs.get(`g/${groupId}/${scan.id}`), null, "and their files");
      // Verify nothing is left behind.
      const tables: [string, GroupTable][] = [
        ["expenses", schema.expenses],
        ["settlements", schema.settlements],
        ["reminders", schema.reminders],
        ["maintenance", schema.maintenance],
        ["cart_items", schema.cartItems],
        ["cart_checkouts", schema.cartCheckouts],
        ["grocery_usuals", schema.groceryUsuals],
        ["recipes", schema.recipes],
        ["chat_messages", schema.chatMessages],
        ["activity", schema.activity],
        ["members", schema.members],
        ["chores", schema.chores],
        ["chats", schema.chats],
        ["group_toolkits", schema.groupToolkits],
        ["pet_moments", schema.petMoments],
        ["documents", schema.documents],
        ["pending_posts", schema.pendingPosts],
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
      receipts.setReceiptReader(null);
      recipes.setRecipeWriter(null);
      setInstacartClient(null);
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
    await assert.rejects(run("log_expense", { amount: 10, description: "pizza", category: "food", payer: "Dev" }), /No member named "Dev".*Sudhersan/);
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

  type Summary = ReturnType<typeof expenseSummary> & { logged?: boolean };
  const sharesOf = async (expenseId: string) =>
    Object.fromEntries(
      (await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, expenseId))).map((s) => [NAMES.find((n) => member[n] === s.memberId) ?? s.memberId, s.cents]),
    );
  const payersOf = async (expenseId: string) =>
    Object.fromEntries(
      (await db.select().from(schema.expensePayers).where(eq(schema.expensePayers.expenseId, expenseId))).map((p) => [NAMES.find((n) => member[n] === p.memberId) ?? p.memberId, p.cents]),
    );
  const balancesNow = async () => Object.fromEntries((await money.getBalances({ groupId })).map((b) => [b.name, b.cents]));

  test("log_expense: '$60 internet' -> 6000 cents, 3 even splits, payer = sender, category kept", async () => {
    const e: Summary = await run("log_expense", { amount: 60, description: "internet", category: "utilities" });
    assert.equal(e.total, "$60.00");
    assert.deepEqual(e.paidBy, [{ name: "Sudhersan", paid: "$60.00" }]);
    assert.equal(e.shares.length, 3);
    for (const s of e.shares) assert.equal(s.owes, "$20.00");

    const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, e.id));
    assert.equal(row.cents, 6000);
    assert.equal(row.payerId, member.Sudhersan);
    assert.equal(row.source, "chat");
    assert.equal(row.category, "utilities");
    assert.equal(row.splitMethod, "equal");
    assert.match(row.occurredOn, /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(await payersOf(e.id), { Sudhersan: 6000 });
    const splits = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, e.id));
    assert.equal(splits.length, 3);
    assert.equal(splits.reduce((s, r) => s + r.cents, 0), 6000);
  });

  test("log_expense: payer by name, split among a subset, odd cent goes to the payer", async () => {
    const e: Summary = await run("log_expense", { amount: 10.01, description: "beer", category: "food", payer: "Ryan", splitAmong: ["Ryan", "Alex"] });
    assert.equal(e.total, "$10.01");
    assert.deepEqual(e.paidBy, [{ name: "Ryan", paid: "$10.01" }]);
    assert.deepEqual(await sharesOf(e.id), { Ryan: 501, Alex: 500 });
  });

  test("get_balances: who owes what + settle plan (nets to zero)", async () => {
    const { balances, settlePlan, simplifyDebts } = await run("get_balances", {});
    const by = Object.fromEntries(balances.map((b: { name: string; cents: number }) => [b.name, b.cents]));
    // internet: S +4000, R -2000, A -2000. beer: R +500, A -500.
    assert.deepEqual(by, { Sudhersan: 4000, Ryan: -1500, Alex: -2500 });
    assert.equal(simplifyDebts, true);
    assert.equal(balances.find((b: { name: string }) => b.name === "Alex").balance, "-$25.00");
    assert.deepEqual(settlePlan, [
      { from: "Alex", to: "Sudhersan", amount: "$25.00" },
      { from: "Ryan", to: "Sudhersan", amount: "$15.00" },
    ]);
  });

  test("settle_up paid=true: 'Alex paid Sudhersan back $25' zeroes Alex", async () => {
    const r = await run("settle_up", { with: "Sudhersan", paid: true, amount: 25, from: "Alex" });
    assert.equal(r.recorded, true);
    assert.equal(r.amount, "$25.00");
    const rows = await db.select().from(schema.settlements).where(eq(schema.settlements.groupId, groupId));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cents, 2500);
    assert.equal(rows[0].fromId, member.Alex);
    assert.equal(rows[0].toId, member.Sudhersan);
    const by = await balancesNow();
    assert.equal(by.Alex, 0);
    assert.equal(by.Sudhersan, 1500);
  });

  test("settle_up paid=true: default payer is the sender; paying yourself is rejected", async () => {
    await assert.rejects(run("settle_up", { with: "Sudhersan", paid: true, amount: 1 }), /yourself/);
    await run("settle_up", { with: "Ryan", paid: true, amount: 1 });
    const mine = await db.select().from(schema.settlements).where(eq(schema.settlements.fromId, member.Sudhersan));
    assert.equal(mine.length, 1);
    assert.equal(mine[0].cents, 100);
    assert.equal(mine[0].toId, member.Ryan);
  });

  test("settle_up paid=false: 'settle up with Ryan' records nothing and returns pay links to the payee's handles", async () => {
    // Two handles in one message become two parallel tool calls; both must stick.
    await Promise.all([run("set_payment_handle", { app: "venmo", handle: "@sudhersan-k" }), run("set_payment_handle", { app: "cashapp", handle: "$sudk" })]);
    assert.deepEqual((await members.getNote(member.Sudhersan)).handles, { venmo: "@sudhersan-k", cashapp: "$sudk" });
    const before = await count(schema.settlements);
    const r = await run("settle_up", { with: "Ryan", paid: false });
    assert.equal(r.recorded, false);
    assert.deepEqual(r.owes, { from: "Ryan", to: "Sudhersan", amount: "$16.00" });
    const urls = r.links.map((l: { url: string }) => l.url);
    assert.ok(urls.some((u: string) => u.startsWith("https://venmo.com/u/sudhersan-k?txn=pay&amount=16.00")), urls.join(" "));
    assert.ok(urls.includes("https://cash.app/$sudk/16.00"));
    assert.equal(await count(schema.settlements), before, "nothing recorded");
  });

  test("list_expenses: newest first with payers and shares; limit respected", async () => {
    const list: Summary[] = await run("list_expenses", {});
    assert.equal(list.length, 2);
    assert.equal(list[0].description, "beer");
    assert.equal(list[1].description, "internet");
    assert.equal(list[1].shares.length, 3);
    const one: Summary[] = await run("list_expenses", { limit: 1 });
    assert.equal(one.length, 1);
  });

  test("log_expense percent: '$90 dinner, 50/25/25' -> 4500/2250/2250; an edit of the total keeps the method", async () => {
    const e: Summary = await run("log_expense", {
      amount: 90,
      description: "steak dinner",
      category: "food",
      percents: [
        { name: "Sudhersan", percent: 50 },
        { name: "Ryan", percent: 25 },
        { name: "Alex", percent: 25 },
      ],
    });
    assert.equal(e.method, "percent");
    assert.deepEqual(await sharesOf(e.id), { Sudhersan: 4500, Ryan: 2250, Alex: 2250 });
    const weights = await db.select({ w: schema.expenseSplits.weight }).from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, e.id));
    assert.deepEqual(weights.map((x) => Number(x.w)).sort((a, b) => a - b), [25, 25, 50]);
    const changed: Summary = await run("update_expense", { expense: "steak dinner", amount: 100 });
    assert.equal(changed.method, "percent");
    assert.deepEqual(await sharesOf(e.id), { Sudhersan: 5000, Ryan: 2500, Alex: 2500 });
    await run("delete_expense", { expense: "steak dinner" });
  });

  test("log_expense shares: 2:2:1 on $41.25 -> 1650/1650/825", async () => {
    const e: Summary = await run("log_expense", {
      amount: 41.25,
      description: "wine and cheese",
      category: "food",
      shares: [
        { name: "Sudhersan", shares: 2 },
        { name: "Ryan", shares: 2 },
        { name: "Alex", shares: 1 },
      ],
    });
    assert.deepEqual(await sharesOf(e.id), { Sudhersan: 1650, Ryan: 1650, Alex: 825 });
    await run("delete_expense", { expense: "wine and cheese" });
  });

  test("log_expense exact: amounts that don't add up are refused with what's left; nothing is saved", async () => {
    const before = await count(schema.expenses);
    await assert.rejects(
      run("log_expense", { amount: 50, description: "groceries", category: "groceries", exact: [{ name: "Ryan", amount: 30 }, { name: "Alex", amount: 15 }] }),
      /\$5\.00 left to assign/,
    );
    assert.equal(await count(schema.expenses), before);
  });

  test("log_expense payers: 'Alex paid 60 and I paid 40 of the 100' -> two Payers, Alex primary, balances to the cent", async () => {
    const before = await balancesNow();
    const e: Summary = await run("log_expense", { amount: 100, description: "concert tickets", category: "entertainment", payers: [{ name: "Alex", amount: 60 }, { name: "Sudhersan", amount: 40 }] });
    assert.deepEqual(await payersOf(e.id), { Alex: 6000, Sudhersan: 4000 });
    const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, e.id));
    assert.equal(row.payerId, member.Alex, "the primary payer paid the most");
    // 100 / 3 = 33.33 r 1: the primary Payer (Alex) gets the extra cent.
    assert.deepEqual(await sharesOf(e.id), { Sudhersan: 3333, Ryan: 3333, Alex: 3334 });
    const after = await balancesNow();
    assert.deepEqual({ S: after.Sudhersan - before.Sudhersan, R: after.Ryan - before.Ryan, A: after.Alex - before.Alex }, { S: 667, R: -3333, A: 2666 });
    await assert.rejects(run("log_expense", { amount: 100, description: "x", category: "other", payers: [{ name: "Alex", amount: 60 }, { name: "Sudhersan", amount: 30 }] }), /\$10\.00 unaccounted/);
    await run("delete_expense", { expense: "concert tickets" });
  });

  test("delete_expense + restore_expense ('undo'): soft delete, then back; Activity has both", async () => {
    await run("log_expense", { amount: 24, description: "pizza", category: "food" });
    const gone = await run("delete_expense", { expense: "the pizza" });
    assert.deepEqual(gone, { deleted: "pizza", amount: "$24.00", undo: "Say 'undo' to bring it back." });
    assert.ok(!(await money.listExpenses({ groupId })).some((x) => x.description === "pizza"));
    const back = await run("restore_expense", {});
    assert.deepEqual(back, { restored: "pizza", amount: "$24.00" });
    assert.ok((await money.listExpenses({ groupId })).some((x) => x.description === "pizza"));
    const kinds = (await db.select({ kind: schema.activity.kind }).from(schema.activity).where(eq(schema.activity.groupId, groupId))).map((a) => a.kind);
    assert.ok(kinds.includes("expense.deleted") && kinds.includes("expense.restored"));
    await run("log_expense", { amount: 18, description: "pizza", category: "food" });
    await assert.rejects(run("delete_expense", { expense: "pizza" }), /More than one expense matches "pizza"/);
    for (const x of await money.findExpenses({ groupId }, "pizza")) await money.deleteExpense(ctx, { expenseId: x.id });
  });

  test("set_simplify_debts: off -> pairwise settle plan, on -> fewest payments; Admins only", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    assert.equal((await run("set_simplify_debts", { on: false }, alex)).reason, "admin-only");
    const off = await run("set_simplify_debts", { on: false });
    assert.equal(off.simplifyDebts, false);
    // internet (S paid for all 3), beer (R paid for R+A), Alex -> S $25 (more than his $20), S -> Ryan $1 (so Ryan
    // owes S one more dollar).
    assert.deepEqual(off.settlePlan, [
      { from: "Ryan", to: "Sudhersan", amount: "$21.00" },
      { from: "Alex", to: "Ryan", amount: "$5.00" },
      { from: "Sudhersan", to: "Alex", amount: "$5.00" },
    ]);
    const on = await run("set_simplify_debts", { on: true });
    assert.deepEqual(on.settlePlan, [{ from: "Ryan", to: "Sudhersan", amount: "$16.00" }]);
  });

  test("expense_from_receipt: reads (fake reader), asks first, then logs exact per-item shares that add up", async () => {
    receipts.setReceiptReader({ read: async () => receipts.SAMPLE_RECEIPT });
    const photo = await receipts.saveUpload({ groupId }, Buffer.from("not really a jpeg"), "image/jpeg");
    try {
      const before = await count(schema.expenses);
      const draft = await run("expense_from_receipt", { receipt_url: photo.url || photo.path, assignments: [{ item: "steak", who: ["Ryan"] }, { item: "wine", who: ["everyone"] }] });
      assert.equal(draft.logged, false);
      assert.equal(draft.total, "$137.97");
      assert.equal(await count(schema.expenses), before, "nothing logged before confirming");
      const done = await run("expense_from_receipt", { receipt_url: photo.url || photo.path, assignments: [{ item: "steak", who: ["Ryan"] }], confirm: true });
      assert.equal(done.logged, true);
      assert.equal(done.method, "exact");
      const shares = await sharesOf(done.id);
      assert.equal(Object.values(shares).reduce((s, c) => s + c, 0), 13797);
      assert.ok(shares.Ryan > shares.Sudhersan, "the steak is Ryan's");
      const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, done.id));
      assert.ok(row.receiptUrl?.endsWith(photo.path));
      assert.equal(row.receiptDocumentId, photo.id, "the Expense points at the receipt's Document");
      await money.deleteExpense(ctx, { expenseId: done.id });
      // A printed total that disagrees with the items is never logged without asking, even with confirm.
      receipts.setReceiptReader({ read: async () => ({ ...receipts.SAMPLE_RECEIPT, total: "150.00" }) });
      const blurry = await receipts.saveUpload({ groupId }, Buffer.from("another photo"), "image/jpeg");
      const odd = await run("expense_from_receipt", { receipt_url: blurry.url || blurry.path, confirm: true });
      assert.equal(odd.logged, false);
      assert.match(odd.warning, /says \$150\.00.*add up to \$137\.97/);
      assert.equal(await count(schema.expenses), before + 1);
    } finally {
      receipts.setReceiptReader(null);
    }
  });

  test("recurring: a monthly expense gets one copy per period, however often the job runs", async () => {
    const start = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
    const rent: Summary = await run("log_expense", { amount: 1800, description: "rent", category: "rent", recurring: "monthly", date: start });
    assert.equal(rent.repeats, "monthly");
    await recurring.runRecurring();
    await recurring.runRecurring();
    const copies = await db.select().from(schema.expenses).where(eq(schema.expenses.recurringParentId, rent.id));
    assert.equal(copies.length, 1, "one copy, not two");
    assert.equal(copies[0].source, "recurring");
    assert.deepEqual(await sharesOf(copies[0].id), await sharesOf(rent.id));
    await money.deleteExpense(ctx, { expenseId: copies[0].id });
    await recurring.runRecurring();
    assert.equal((await db.select().from(schema.expenses).where(eq(schema.expenses.recurringParentId, rent.id))).length, 1, "a deleted copy isn't remade");
    await money.deleteExpense(ctx, { expenseId: rent.id });
  });

  test("rent and bills: set_rent, rent_status (offer once, shares only in a DM), set_variable_expense, answer_amount", async () => {
    const none = await run("rent_status", {});
    assert.equal(none.rent, null);
    assert.equal(none.offer, true, "offered the first time");
    assert.equal((await run("rent_status", {})).offer, false, "never again");

    const set = await run("set_rent", { amount: 2400, dueDay: 1, percents: [{ name: "Sudhersan", percent: 40 }, { name: "Ryan", percent: 30 }, { name: "Alex", percent: 30 }] });
    assert.equal(set.rent.amount, "$2,400");
    assert.equal(set.rent.paysLandlord, "Sudhersan");
    assert.equal(typeof set.rent.shares, "string", "no one's share in the group");
    const dm = contextFor(member.Sudhersan, "Sudhersan", "admin", "active");
    dm.set("isPrivate", true);
    assert.deepEqual((await run("rent_status", {}, dm)).rent.shares, [{ name: "Sudhersan", share: "$960" }, { name: "Alex", share: "$720" }, { name: "Ryan", share: "$720" }]);
    const ryan = contextFor(member.Ryan, "Ryan", "member", "active");
    const refused = await run("set_rent", { amount: 2500 }, ryan);
    assert.equal(refused.notAllowed, true, "only the Payer or an Admin");

    const bill = await run("set_variable_expense", { description: "Electric", dueDay: 20, payer: "Ryan" });
    assert.equal(bill.paidBy, "Ryan");
    await assert.rejects(run("answer_amount", { amount: 92 }, ryan), /No bill is waiting/);
    const tz = (await groups.getGroup(groupId))!.timezone;
    const [y, m, d] = (bill.firstAsk as string).split("-").map(Number);
    await recurring.runRecurring(zonedTimeToUtc(tz, { year: y, month: m, day: d, hour: 10, minute: 0 }), { groupId });
    const paid = await run("answer_amount", { amount: 92, bill: "electric" }, ryan);
    assert.equal(paid.total, "$92.00");
    assert.equal(paid.shares, undefined, "no shares in the group");
    await assert.rejects(run("answer_amount", { amount: 92 }, ryan), /already logged/);

    // Out of the way of the balance tests below.
    const rent = await db.select({ id: schema.expenses.id }).from(schema.expenses).where(and(eq(schema.expenses.groupId, groupId), isNull(schema.expenses.deletedAt), inArray(schema.expenses.category, ["rent", "utilities"])));
    for (const e of rent) await money.deleteExpense(ctx, { expenseId: e.id });
  });

  // ---------- chores ----------

  type ChoreBrief = { chore: string; whoseTurn: string | null; rotation: string[] | string; status: string; due: string; lastDone: string };

  test("chore_add: on the chart with a Rotation ('me' = the sender); same name again updates the cadence and keeps it", async () => {
    const d = await run("chore_add", { name: "Dishes", everyDays: 1 });
    assert.equal(d.created, true);
    assert.deepEqual(d.rotation, ["Sudhersan", "Ryan", "Alex"], "no Rotation = everyone");
    const t = await run("chore_add", { name: "Take out trash", everyDays: 3, rotation: ["Ryan", "Alex", "me"] });
    assert.deepEqual(t.rotation, ["Ryan", "Alex", "Sudhersan"]);
    assert.equal(t.links, undefined, "no link on a routine add");
    const again = await run("chore_add", { name: "take out trash", everyDays: 2 });
    assert.equal(again.created, false);
    assert.deepEqual(again.rotation, ["Ryan", "Alex", "Sudhersan"]);
    const chart = await db.select().from(schema.chores).where(eq(schema.chores.groupId, groupId));
    assert.deepEqual(chart.map((c) => [c.name, c.everyDays, c.rotation?.length ?? 0]).sort(), [
      ["Dishes", 1, 0],
      ["Take out trash", 2, 3],
    ]);
    await assert.rejects(run("chore_add", { name: "Mop", rotation: ["Zed"] }), /No member named "Zed"/);
    const acts = await db.select().from(schema.activity).where(and(eq(schema.activity.groupId, groupId), eq(schema.activity.kind, "chore.added")));
    assert.equal(acts.length, 2);
  });

  test("log_chore: 'the dishes' for the sender (streak 2); 'trash' for Alex moves the Rotation on to the next one", async () => {
    const r = await run("log_chore", { chore: "the dishes" });
    assert.equal(r.chore, "Dishes");
    assert.equal(r.streak, 1);
    const r2 = await run("log_chore", { chore: "the dishes" });
    assert.equal(r2.streak, 2, "two on-time turns in a row");
    const r3 = await run("log_chore", { chore: "took out the trash", who: "Alex" });
    assert.equal(r3.chore, "Take out trash");
    assert.equal(r3.doneBy, "Alex");
    assert.equal(r3.nextUp, "Sudhersan", "after Alex in Ryan, Alex, Sudhersan");
    const logs = await db
      .select({ memberId: schema.choreLogs.memberId, name: schema.chores.name })
      .from(schema.choreLogs)
      .innerJoin(schema.chores, eq(schema.choreLogs.choreId, schema.chores.id))
      .where(eq(schema.chores.groupId, groupId));
    assert.equal(logs.length, 3);
    assert.equal(logs.filter((l) => l.memberId === member.Alex && l.name === "Take out trash").length, 1);
    const [act] = await db.select().from(schema.activity).where(and(eq(schema.activity.groupId, groupId), eq(schema.activity.kind, "chore.done"))).orderBy(desc(schema.activity.createdAt)).limit(1);
    assert.equal(act.summary, "marked Take out trash done for Alex");
  });

  test("log_chore: an unknown chore is added to the chart (every 7 days)", async () => {
    const r = await run("log_chore", { chore: "watered the plants" });
    assert.equal(r.chore, "watered the plants");
    assert.equal(r.added, true);
    const [c] = await db
      .select()
      .from(schema.chores)
      .where(and(eq(schema.chores.groupId, groupId), eq(schema.chores.name, "watered the plants")));
    assert.equal(c.everyDays, 7);
  });

  test("chore_status: whose turn (Rotation or least recent), due in the Group's days, last done", async () => {
    const { chores, dueOrOverdue }: { chores: ChoreBrief[]; dueOrOverdue: string[] } = await run("chore_status", {});
    const dishes = chores.find((c) => c.chore === "Dishes")!;
    assert.match(dishes.lastDone, /^Sudhersan on \d{4}-\d{2}-\d{2}$/);
    assert.equal(dishes.status, "ok", "done today, every day: due tomorrow");
    assert.ok(dishes.whoseTurn === "Alex" || dishes.whoseTurn === "Ryan", "someone who hasn't done dishes is up");
    const trash = chores.find((c) => c.chore === "Take out trash")!;
    assert.equal(trash.whoseTurn, "Sudhersan");
    assert.deepEqual(trash.rotation, ["Ryan", "Alex", "Sudhersan"]);
    assert.ok(!dueOrOverdue.includes("Dishes"));
  });

  test("chore_skip: only whoever's turn it is passes; the next in the Rotation is up and Activity says so", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    const refused = await run("chore_skip", { chore: "trash" }, alex);
    assert.equal(refused.notAllowed, true);
    assert.match(refused.message, /Sudhersan's turn on Take out trash/);
    const s = await run("chore_skip", { chore: "trash" });
    assert.deepEqual(s, { chore: "Take out trash", choreId: s.choreId, nextUp: "Ryan" });
    const status = await chores.choreStatus({ groupId });
    const trash = status.find((c) => c.name === "Take out trash")!;
    assert.equal(trash.whoseTurn, "Ryan");
    assert.equal(trash.lastDoneBy, "Alex", "a pass isn't a done");
    const [act] = await db.select().from(schema.activity).where(and(eq(schema.activity.groupId, groupId), eq(schema.activity.kind, "chore.skipped")));
    assert.equal(act.summary, "passed their turn on Take out trash to Ryan");
    // Without naming the chore: Ryan's only chore is trash
    const ryan = contextFor(member.Ryan, "Ryan", "member", "active");
    const r = await run("chore_skip", {}, ryan);
    assert.equal(r.nextUp, "Alex");
  });

  test("hall_of_shame: the chart, worst first, with a friendly line", async () => {
    const { line, rows }: { line: string; rows: ShameRow[] } = await run("hall_of_shame", {});
    assert.deepEqual(rows.map((s) => s.name), ["Ryan", "Alex", "Sudhersan"]);
    assert.equal(rows[0].daysSinceLastChore, null);
    assert.equal(rows[2].choresThisWeek, 3);
    assert.equal(line, "The chart this week: Ryan 0 (none yet), Alex 1, Sudhersan 3.");
  });

  test("chore_update: a new cycle for a chore on the chart, fuzzy by name; the Rotation stays; Activity says so", async () => {
    const r = await run("chore_update", { chore: "trash", everyDays: 3 });
    assert.deepEqual({ name: r.name, everyDays: r.everyDays }, { name: "Take out trash", everyDays: 3 });
    const trash = (await chores.choreStatus({ groupId })).find((c) => c.name === "Take out trash")!;
    assert.equal(trash.everyDays, 3);
    assert.deepEqual(trash.order.map((p) => p.name), ["Ryan", "Alex", "Sudhersan"]);
    const [act] = await db.select().from(schema.activity).where(and(eq(schema.activity.groupId, groupId), eq(schema.activity.kind, "chore.changed"))).orderBy(desc(schema.activity.createdAt)).limit(1);
    assert.equal(act.summary, "changed Take out trash to every 3 days");
    await assert.rejects(run("chore_update", { chore: "gutters", everyDays: 3 }), /No chore matches "gutters"/);
  });

  test("chore_remove: Admins only; the chore and its history go, Activity keeps a line", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    assert.equal((await run("chore_remove", { chore: "plants" }, alex)).reason, "admin-only");
    assert.deepEqual(await run("chore_remove", { chore: "plants" }), { removed: "watered the plants" });
    const left = await db.select().from(schema.chores).where(eq(schema.chores.groupId, groupId));
    assert.deepEqual(left.map((c) => c.name).sort(), ["Dishes", "Take out trash"]);
    await assert.rejects(run("chore_remove", { chore: "gutters" }), /No chore matches "gutters"/);
  });

  // ---------- reminders ----------

  const CHI = "America/Chicago";
  const outbox: DevOutput[] = [];
  let tuesday8pm: Date;

  test("set_reminder: wall-clock in the Group's zone ('Tuesday 8pm' for everyone), 'me' monthly, Ryan privately", async () => {
    registerChannel(new DevChannel((o) => outbox.push(o)));
    tuesday8pm = nextWeekday(CHI, 2, 20);
    const p = zonedParts(CHI, tuesday8pm);
    const wall = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T20:00`;
    const trash = await run("set_reminder", { text: "Trash goes out", dueAt: wall, repeat: "weekly" });
    assert.equal(trash.for, "everyone");
    assert.equal(trash.private, false);
    const [row] = await db.select().from(schema.reminders).where(eq(schema.reminders.id, trash.id));
    assert.equal(row.dueAt.toISOString(), tuesday8pm.toISOString(), "8 PM Chicago on the next Tuesday, as an instant");
    assert.equal(row.recurring, "weekly");
    assert.equal(row.createdBy, member.Sudhersan);
    assert.match(trash.when, /^Tue \w{3} \d{1,2}, 8:00 PM, then weekly$/);

    const rent = await run("set_reminder", { text: "Pay rent", dueAt: new Date(Date.now() + 86_400_000).toISOString(), who: "me", repeat: "monthly" });
    assert.equal(rent.for, "Sudhersan");
    assert.equal(rent.private, true);
    const ryan = await run("set_reminder", { text: "Pay Sudhersan back for pizza", dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), who: "Ryan" });
    assert.equal(ryan.for, "Ryan");
    assert.equal(await count(schema.reminders), 3);
  });

  test("set_reminder: a time that already passed or isn't a date is refused", async () => {
    await assert.rejects(run("set_reminder", { text: "x", dueAt: "next tuesday-ish" }), /not a real date/);
    await assert.rejects(run("set_reminder", { text: "x", dueAt: "2020-01-01T09:00" }), /already passed/);
  });

  test("list_reminders: what the sender may see (the group's, theirs, the ones they set), soonest first", async () => {
    const mine: { text: string; for: string; setBy: string }[] = await run("list_reminders", {});
    assert.deepEqual(mine.map((r) => r.text).sort(), ["Pay Sudhersan back for pizza", "Pay rent", "Trash goes out"]);
    const alexSees: { text: string }[] = await run("list_reminders", {}, contextFor(member.Alex, "Alex", "member", "active"));
    assert.deepEqual(alexSees.map((r) => r.text), ["Trash goes out"], "other people's private reminders stay private");
  });

  test("scheduler: the whole group's reminder goes to the Chat, a Member's privately with '(set by ...)', repeats come back", async () => {
    await db.update(schema.reminders).set({ dueAt: new Date(Date.now() - 60_000) }).where(and(eq(schema.reminders.groupId, groupId), sql`${schema.reminders.recurring} is distinct from 'weekly'`));
    // The weekly one fired last Tuesday at 8 PM, so the next is the coming Tuesday at 8 PM, DST or not.
    await db.update(schema.reminders).set({ dueAt: addDaysInZone(CHI, tuesday8pm, -7) }).where(and(eq(schema.reminders.groupId, groupId), eq(schema.reminders.recurring, "weekly")));
    outbox.length = 0;
    const sent = await sendDueReminders(new Date(), groupId);
    assert.equal(sent, 3);
    const chat = outbox.filter((o) => o.to === "chat");
    const priv = outbox.filter((o) => o.to === "private");
    assert.equal(chat.length, 1, "one Chat post: the group's");
    assert.match(chat[0].msg.text, /trash goes out/i);
    assert.equal(priv.length, 2);
    const toRyan = priv.find((o) => o.to === "private" && o.userExternalId.includes("ryan"))!;
    assert.match(toRyan.msg.text, /pay Sudhersan back for pizza \(set by Sudhersan\)$/);
    const own = priv.find((o) => o.to === "private" && o.userExternalId.includes("sudhersan"))!;
    assert.doesNotMatch(own.msg.text, /set by/);
    const next = await db.select().from(schema.reminders).where(and(eq(schema.reminders.groupId, groupId), isNull(schema.reminders.sentAt)));
    assert.deepEqual(next.map((r) => r.recurring).sort(), ["monthly", "weekly"], "the one-off is done; repeats are scheduled again");
    assert.ok(next.every((r) => r.dueAt.getTime() > Date.now()));
    const weekly = next.find((r) => r.recurring === "weekly")!;
    assert.equal(weekly.dueAt.toISOString(), tuesday8pm.toISOString());
    assert.equal(await sendDueReminders(new Date(), groupId), 0, "nothing twice");
  });

  test("cancel_reminder: by text, then by id; other people's private ones can't be cancelled; unknown lists what's there", async () => {
    const c = await run("cancel_reminder", { text: "rent" });
    assert.equal(c.cancelled, "Pay rent");
    const left: { id: string; text: string }[] = await run("list_reminders", {});
    assert.deepEqual(left.map((r) => r.text), ["Trash goes out"]);
    await assert.rejects(run("cancel_reminder", { text: "nothing like this" }), /No upcoming reminder matches.*Trash goes out/);
    await run("cancel_reminder", { reminderId: left[0].id });
    assert.equal(Number((await db.select({ n: sql<number>`count(*)::int` }).from(schema.reminders).where(and(eq(schema.reminders.groupId, groupId), isNull(schema.reminders.sentAt))))[0].n), 0);
    await assert.rejects(run("cancel_reminder", { text: "rent" }), /no upcoming reminders/);
  });

  // ---------- upkeep ----------

  type UpkeepBrief = { item: string; status: string; due: string; lastDone: string };

  test("upkeep_add + upkeep_status: one item, then the usual five (skipping what's tracked); never done = due today", async () => {
    const a = await run("upkeep_add", { item: "Replace HVAC / air filter", everyDays: 90 });
    assert.equal(a.created, true);
    const u = await run("upkeep_add", { usual: true });
    assert.equal(u.added, 4);
    const all: { items: UpkeepBrief[]; tracked: number } = await run("upkeep_status", {});
    assert.equal(all.tracked, 5);
    assert.ok(all.items.every((m) => m.status === "due-soon" && m.due === "due today"));
    const due: { items: UpkeepBrief[] } = await run("upkeep_status", { dueOnly: true });
    assert.equal(due.items.length, 5);
    await assert.rejects(run("upkeep_add", { item: "Gutters" }), /How often/);
  });

  test("upkeep_done: 'changed the air filter' finds the filter; due again in 90 local days; unknown throws with the list", async () => {
    const d = await run("upkeep_done", { item: "changed the air filter" });
    assert.equal(d.item, "Replace HVAC / air filter");
    assert.equal(d.nextDueDay, addDaysToDay(dayInZone(CHI, new Date()), 90));
    const all: { items: UpkeepBrief[] } = await run("upkeep_status", {});
    assert.equal(all.items.find((m) => m.item === "Replace HVAC / air filter")?.status, "ok");
    const due: { items: UpkeepBrief[] } = await run("upkeep_status", { dueOnly: true });
    assert.equal(due.items.length, 4);
    await assert.rejects(run("upkeep_done", { item: "gutters" }), /No upkeep item matches "gutters".*Replace HVAC/);
  });

  test("upkeep_remove: Admins only", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    assert.equal((await run("upkeep_remove", { item: "coffee maker" }, alex)).reason, "admin-only");
    assert.deepEqual(await run("upkeep_remove", { item: "coffee maker" }), { removed: "Descale coffee maker" });
    assert.equal(await count(schema.maintenance), 4);
  });

  // ---------- report + the chores nudge ----------

  test("group_report: one ready-to-post message from every Toolkit, at most 12 lines", async () => {
    const r: { text: string } = await run("group_report", {});
    assert.match(r.text, /^📋 Group report · Test Group/);
    assert.match(r.text, /💸 2 open balances; I'm nudging people privately\.\n/, "a count from the ledger, over the $5 line, never a name (ADR 0021)");
    assert.doesNotMatch(r.text, /\$16\.00/);
    assert.match(r.text, /Chores this week: Sudhersan 2, Alex 1, Ryan 0\./);
    assert.match(r.text, /The chart says Ryan has some catching up to do\./);
    assert.match(r.text, /Upkeep due soon: .*Test smoke alarms \(today\)/);
    assert.doesNotMatch(r.text, /air filter/);
    assert.match(r.text, /The Cart's empty\./);
    assert.ok(r.text.split("\n").length <= 12, "stays short");
  });

  test("scheduler: the Bundle (House's chores line) posts once in the nudge hour, only when something's due; the report once on its day", async () => {
    await run("chore_add", { name: "Mop the floor", everyDays: 7 });
    const [g] = await groupsWithChat(groupId);
    const today = zonedParts(CHI, new Date());
    const at = (hour: number, dayOffset = 0) => zonedTimeToUtc(CHI, { year: today.year, month: today.month, day: today.day + dayOffset, hour, minute: 15 });
    outbox.length = 0;
    assert.equal(await bundleJob(g, at(10)), null, "outside the 9 AM hour");
    const text = await bundleJob(g, at(9));
    assert.match(text ?? "", /^🧹 On the chart today: .*mop the floor/);
    assert.equal(await bundleJob(g, at(9)), null, "once per local day");
    assert.equal(outbox.filter((o) => o.to === "chat").length, 1);
    const [claim] = await db.select().from(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, groupId), eq(schema.scheduledPosts.kind, "bundle")));
    assert.equal(claim?.period, dayInZone(CHI, at(9)), "claimed as the Bundle for the local day");

    await run("set_group_settings", { choresNudgeHour: null, reportDay: "Wednesday", reportHour: 7 });
    assert.equal(await bundleJob(g, at(9, 1)), null, "nudge switched off");
    const [houseRow] = await db.select().from(schema.groupToolkits).where(and(eq(schema.groupToolkits.groupId, groupId), eq(schema.groupToolkits.toolkit, "house")));
    assert.equal(houseRow?.settings.nudgeHour, null, "the nudge hour lives on House's row");
    const wed = nextWeekday(CHI, 3, 7, at(0));
    const report = await weeklyReportJob(g, new Date(wed.getTime() + 10 * 60_000));
    assert.match(report ?? "", /Group report/);
    assert.equal(await weeklyReportJob(g, new Date(wed.getTime() + 20 * 60_000)), null, "once per week");
    assert.equal(await weeklyReportJob(g, new Date(wed.getTime() + 2 * 3_600_000)), null, "outside its hour");
    await run("set_group_settings", { choresNudgeHour: 9, reportDay: "Sunday", reportHour: 18 });
    await run("chore_remove", { chore: "mop" });
  });

  // ---------- cart (no prices; links only when asked; every change is an Activity row with its source) ----------

  type Link = { text: string; url: string };
  type Said = { name: string; qty: string; shared?: boolean; for?: string };
  type CartAdd = { added: Said[]; cartItemCount: number; needsClarification?: string[]; links?: Link[] };
  type CartView = { groups: Record<string, { name: string; qty: string; recipe?: string }[]>; itemCount: number; links?: Link[] };
  const appUrl = (process.env.APP_URL ?? "").trim().replace(/\/+$/, "");
  const noPrice = (r: unknown) => assert.ok(!/\$\d|estCents|estTotal|cartTotal/.test(JSON.stringify(r)), `no prices in ${JSON.stringify(r)}`);
  const lastActivity = async () => (await db.select().from(schema.activity).where(eq(schema.activity.groupId, groupId)).orderBy(desc(schema.activity.createdAt)).limit(1))[0];

  test("cart_add: '3 bags of chips for me' + a shared item; stored as said, no prices, no links; Activity says where", async () => {
    const added: CartAdd = await run("cart_add", { items: [{ name: "chips", qty: "3 bags" }] });
    assert.deepEqual(added.added, [{ name: "chips", qty: "3 bags", for: "Sudhersan" }]);
    assert.equal(added.cartItemCount, 1);
    assert.equal(added.links, undefined, "no View-cart link on a routine add");
    noPrice(added);
    const a = await lastActivity();
    assert.deepEqual([a.kind, a.summary, a.source, a.actorMemberId], ["cart.added", "put chips on the Cart", "chat", member.Sudhersan]);

    const second: CartAdd = await run("cart_add", { items: [{ name: "dish soap" }], shared: true });
    assert.deepEqual(second.added, [{ name: "dish soap", qty: "1", shared: true }]);
    assert.equal(second.cartItemCount, 2);
    assert.equal((await lastActivity()).summary, "put dish soap on the Cart for everyone");
    const rows = await db.select().from(schema.cartItems).where(eq(schema.cartItems.groupId, groupId));
    assert.equal(rows.length, 2);
    const chips = rows.find((r) => r.name === "chips");
    assert.deepEqual([chips?.qty, chips?.addedBy, chips?.shared, chips?.status, chips?.estCents], ["3 bags", member.Sudhersan, false, "open", null]);
    const soap = rows.find((r) => r.name === "dish soap");
    assert.deepEqual([soap?.shared, soap?.qty, soap?.estCents], [true, "1", null]);
  });

  test("cart_add: an ambiguous quantity is held back with one question; 'for Ryan' attributes to Ryan", async () => {
    const r: CartAdd = await run("cart_add", { items: [{ name: "bagels" }, { name: "eggs", qty: "12, 18" }], for: "Ryan" });
    assert.deepEqual(r.added, [{ name: "bagels", qty: "1", for: "Ryan" }]);
    assert.deepEqual(r.needsClarification, ["eggs: 12 and 18 what? cartons or eggs?"]);
    assert.equal((await lastActivity()).summary, "put bagels on the Cart for Ryan");
    assert.equal(await run("cart_remove", { name: "bagels" }).then((x) => x.removed), true);
    assert.equal((await lastActivity()).summary, "took bagels (Ryan's) off the Cart");
  });

  test("cart_add with usuals: a bare 'Pepsi' asks once; the answer (remember) is his usual; next time usedUsual, no question; Ryan's is his own", async () => {
    type Add = CartAdd & { usedUsual?: { name: string; qty: string }[] };
    const ask: Add = await run("cart_add", { items: [{ name: "Pepsi" }] });
    assert.deepEqual([ask.added, ask.needsClarification], [[], ["Pepsi: cans or a bottle, and how many?"]]);
    const answer: Add = await run("cart_add", { items: [{ name: "Pepsi", qty: "12 × 12 oz cans", remember: true }] });
    assert.deepEqual([answer.added, answer.usedUsual], [[{ name: "Pepsi", qty: "12 × 12 oz cans", for: "Sudhersan" }], undefined]);
    const usual: Add = await run("cart_add", { items: [{ name: "pepsi" }] });
    assert.deepEqual([usual.added, usual.usedUsual, usual.needsClarification], [[{ name: "Pepsi", qty: "12 × 12 oz cans", for: "Sudhersan" }], [{ name: "Pepsi", qty: "12 × 12 oz cans" }], undefined]);
    const once: CartAdd = await run("cart_add", { items: [{ name: "Pepsi", qty: "1 × 2-liter bottle", remember: false }] });
    assert.equal(once.added[0].qty, "1 × 2-liter bottle");
    const ryans: CartAdd = await run("cart_add", { items: [{ name: "Pepsi" }] }, contextFor(member.Ryan, "Ryan", "member", "active"));
    assert.deepEqual(ryans.needsClarification, ["Pepsi: cans or a bottle, and how many?"], "Sudhersan's usual isn't Ryan's");
    for (let k = 0; k < 3; k++) await run("cart_remove", { name: "Pepsi" });
    noPrice(usual);
  });

  test("cart_view groups open items by who added them; no prices; the Cart page only when asked", async () => {
    const view: CartView = await run("cart_view", {});
    const all = Object.values(view.groups).flat();
    assert.deepEqual(all.map((i) => i.name).sort(), ["chips", "dish soap"]);
    assert.ok(Object.keys(view.groups).some((k) => /sudhersan/i.test(k)), "a group for the sender");
    assert.equal(view.groups.Shared?.[0]?.name, "dish soap");
    assert.equal(view.itemCount, 2);
    assert.equal(view.links, undefined);
    noPrice(view);
    const asked: CartView = await run("cart_view", { link: true });
    if (/^https?:\/\//i.test(appUrl)) assert.deepEqual(asked.links?.map((b) => b.url), [`${appUrl}/g/${groupId}/cart`]);
  });

  test("cart_view list: the whole list ready to post, the same text the Cart page's Share button gets", async () => {
    const { cartShareText } = await import("@/app/g/[groupId]/_components/data");
    const group = await groups.getGroup(groupId);
    const r = await run("cart_view", { list: true });
    assert.equal(r.text, `${group!.name} shopping list\n☐ dish soap\n☐ chips, 3 bags (Sudhersan)`);
    assert.equal(r.itemCount, 2);
    assert.equal(r.links, undefined);
    assert.equal(r.text, await cartShareText({ ctx }), "one truth for the chat and the dashboard");
    noPrice(r);
  });

  test("cart_remove by name; the dashboard's remove is recorded as the dashboard", async () => {
    await run("cart_add", { items: [{ name: "oat milk", qty: "2" }] });
    assert.deepEqual(await run("cart_remove", { name: "Oat Milk" }), { removed: true, cartItemCount: 2 });
    assert.deepEqual(await run("cart_remove", { name: "caviar" }), { removed: false, cartItemCount: 2 });
    const open = await db.select().from(schema.cartItems).where(eq(schema.cartItems.groupId, groupId));
    assert.deepEqual(open.filter((r) => r.status === "open").map((r) => r.name).sort(), ["chips", "dish soap"]);
    const [eggs] = await cart.addItems({ ...ctx, source: "ui" }, { items: [{ name: "Eggs" }] });
    assert.equal(await cart.removeItemById({ ...ctx, source: "ui" }, { id: eggs.id }), true);
    const a = await lastActivity();
    assert.deepEqual([a.kind, a.summary, a.source], ["cart.removed", "took eggs off the Cart", "dashboard"]);
    const changes = await activity.recentChanges(groupId, new Date(Date.now() - 60_000));
    assert.equal(changes.at(-1), "Sudhersan took eggs off the Cart (dashboard, just now)");
    assert.ok(changes.length <= activity.MAX_CHANGES);
  });

  test("cart_checkout: an Instacart shopping list of the open cart (fake), recorded as a Checkout; same cart reuses it", async () => {
    const calls = instacart.calls.length;
    const r: { available: boolean; checkoutId: string; itemCount: number; links: Link[] } = await run("cart_checkout", {});
    assert.equal(r.available, true);
    assert.equal(r.itemCount, 2);
    noPrice(r);
    assert.equal(r.links.length, 1);
    assert.match(r.links[0].url, /^https:\/\/instacart\.example\/lists\//);
    assert.match(r.links[0].text, /instacart/i);
    const sent = instacart.calls.at(-1)!;
    assert.equal(sent.slug, "INSTACART_CREATE_SHOPPING_LIST_PAGE");
    assert.equal(sent.args.link_type, "shopping_list");
    assert.deepEqual(
      (sent.args.line_items as { name: string; line_item_measurements: unknown[] }[]).map((l) => [l.name, l.line_item_measurements]),
      [["chips", [{ quantity: 3, unit: "package" }]], ["dish soap", [{ quantity: 1, unit: "each" }]]],
    );
    const [row] = await db.select().from(schema.cartCheckouts).where(eq(schema.cartCheckouts.id, r.checkoutId));
    assert.equal(row.itemsSnapshot.length, 2);
    assert.equal(row.instacartUrl, r.links[0].url);
    assert.equal(row.paidAt, null);
    const again = await run("cart_checkout", {});
    assert.equal(again.checkoutId, r.checkoutId, "nothing changed: the same Checkout");
    assert.equal(instacart.calls.length, calls + 1, "and no second Instacart call");
  });

  test("cart_checkout: Instacart unavailable -> the Checkout is still recorded and Roomie says so; empty cart throws", async () => {
    setInstacartClient(new ComposioInstacart());
    const key = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    try {
      await run("cart_add", { items: [{ name: "limes", qty: "4" }] });
      const r = await run("cart_checkout", {});
      assert.equal(r.available, false);
      assert.match(r.message, /isn't available yet/);
      assert.ok(!("links" in r));
      const [row] = await db.select().from(schema.cartCheckouts).where(eq(schema.cartCheckouts.id, r.checkoutId));
      assert.equal(row.instacartUrl, null);
      assert.equal(row.itemsSnapshot.length, 3);
      assert.equal(await run("cart_remove", { name: "limes" }).then((x) => x.removed), true);
    } finally {
      if (key !== undefined) process.env.COMPOSIO_API_KEY = key;
      setInstacartClient(instacart);
    }
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
    // One share per item: chips -> Sudhersan, dish soap a third each: Sudhersan 4/6, Ryan 1/6, Alex 1/6 of 3000.
    assert.deepEqual([cents[member.Sudhersan], cents[member.Ryan], cents[member.Alex]], [2000, 500, 500]);
    const items = await db.select().from(schema.cartItems).where(eq(schema.cartItems.groupId, groupId));
    assert.ok(items.filter((r) => r.name !== "oat milk").every((r) => r.status === "purchased"), "cart items marked purchased");
    const view: CartView = await run("cart_view", {});
    assert.deepEqual(view.groups, {});
    assert.equal((await lastActivity()).kind, "cart.purchased");
    assert.equal(row.splitMethod, "exact");
    assert.equal(row.category, "groceries");
    const [paid] = await db.select().from(schema.cartCheckouts).where(eq(schema.cartCheckouts.groupId, groupId)).orderBy(desc(schema.cartCheckouts.createdAt)).limit(1);
    assert.equal(paid.expenseId, e.id, "the newest Checkout points at the Expense that paid it");
    assert.ok(paid.paidAt);
  });

  test("cart_purchased: payer by name; people with nothing in the cart are left out of the split; empty cart throws", async () => {
    await run("cart_add", { items: [{ name: "bananas" }] });
    const e: Expense = await run("cart_purchased", { total: 5, payer: "Ryan" });
    assert.equal(e.payerName, "Ryan");
    assert.equal(e.cents, 500);
    assert.deepEqual(
      (e.splits ?? []).map((s) => [s.name, s.cents]),
      [["Sudhersan", 500]],
      "Sudhersan's bananas, paid by Ryan: only Sudhersan owes",
    );
    await assert.rejects(run("cart_purchased", { total: 5 }), /cart is empty/i);
    await assert.rejects(run("cart_purchased", { total: 5, payer: "Dev" }), /No member named "Dev"/);
  });

  test("cart_purchased: a double-click charges once; a failed purchase leaves the items open", async () => {
    await run("cart_add", { items: [{ name: "tortillas" }] });
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

  // ---------- recipes and the Pantry ----------

  const ryanRc = () => contextFor(member.Ryan, "Ryan", "member", "active");

  test("pantry_set / pantry_list: normalized, deduped, A to Z; add and remove", async () => {
    assert.deepEqual((await run("pantry_list", {})).pantry, []);
    assert.deepEqual((await run("pantry_set", { add: ["Salt", "oil", "rice", "salt "] })).pantry, ["oil", "rice", "salt"]);
    assert.deepEqual((await run("pantry_set", { remove: ["Rice"] }, ryanRc())).pantry, ["oil", "salt"], "any active Member can edit it");
    assert.deepEqual((await run("pantry_list", {})).pantry, ["oil", "salt"]);
    await assert.rejects(run("pantry_set", {}), /What should go in/);
  });

  test("restock_status / restock_mute / restock_unmute: a habit seen three times is probably low until muted", async () => {
    const today = await restock.localDay(groupId);
    const days = [8, 17, 26].map((ago) => addDaysToDay(today, -ago)); // every 9 days, last 8 days ago
    await restock.recordPurchases(ctx, days.map((occurredOn) => ({ name: "Sparkling water", memberId: null, occurredOn, source: "cart" as const, sourceId: null })));
    const low = await run("restock_status", {});
    assert.ok(low.items.includes("sparkling water"), JSON.stringify(low));
    assert.match(low.say, /^Probably low: .*sparkling water/);
    assert.doesNotMatch(low.say, /\$/);
    assert.equal((await run("restock_mute", { item: "sparkling water" }, ryanRc())).say, "Got it, I'll stop mentioning sparkling water.");
    assert.ok(!(await run("restock_status", {})).items.includes("sparkling water"));
    assert.equal((await run("restock_unmute", { item: "Sparkling Water" })).say, "OK, I'll mention sparkling water again.");
    assert.ok((await run("restock_status", {})).items.includes("sparkling water"));
    const added = await run("restock_add_listed", { scope: "shared", only: ["the sparkling water"] }, ryanRc());
    assert.deepEqual([added.added, added.say], [["sparkling water"], "Added sparkling water as shared."]);
    assert.ok(!(await run("restock_status", {})).items.includes("sparkling water"), "in the Cart: not low");
    assert.equal((await run("cart_remove", { name: "sparkling water" }, ryanRc())).removed, true);
  });

  let tacosId: string;

  test("recipe_draft: writes and saves a Recipe for 5 (fake writer), have/need from the Pantry, cart untouched", async () => {
    const openBefore = (await cart.listOpenItems(ctx)).length;
    const r = await run("recipe_draft", { request: "tacos for 5 on friday", servings: 5, plannedFor: "2026-10-30", shopping: true });
    tacosId = r.recipeId;
    assert.equal(r.title, "Tacos for 5");
    assert.equal(r.servings, 5);
    assert.equal(r.plannedFor, "2026-10-30");
    assert.equal(r.haveCount, 2, "salt and the oil are in the Pantry");
    assert.equal(r.missingCount, 9);
    assert.equal(r.askToAdd, "Want the 9 missing ingredients on the list?", "planning it for a day: one offer (#43)");
    assert.match(r.text, /^Tacos for 5 \(serves 5, 30 min\)/);
    assert.match(r.text, /Need: 20 corn tortillas, 2 lb ground turkey/);
    assert.match(r.text, /Have: 1 tbsp oil, 1 tsp salt/);
    assert.match(r.text, /5 steps, on the Cart page/);
    assert.equal(r.links, undefined, "no link on a routine recipe");
    noPrice(r);
    assert.equal((await cart.listOpenItems(ctx)).length, openBefore, "a Recipe never touches the Cart by itself");
    const [row] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, tacosId));
    assert.equal(row.createdBy, member.Sudhersan);
    assert.equal(row.ingredients.find((i) => i.name === "ground turkey")?.unit, "pound");
  });

  test("recipe_add_to_cart: the missing ingredients minus 'we have onions', shared, with recipe_id; twice adds nothing", async () => {
    const r = await run("recipe_add_to_cart", { skip: ["onions"] });
    assert.equal(r.recipe, "Tacos for 5");
    assert.equal(r.addedCount, 8);
    assert.deepEqual(r.skippedHave.sort(), ["red onion", "salt", "vegetable oil"]);
    assert.ok(r.added.includes("Ground turkey (2 lb)"));
    const rows = await db.select().from(schema.cartItems).where(and(eq(schema.cartItems.groupId, groupId), eq(schema.cartItems.recipeId, tacosId)));
    assert.equal(rows.length, 8);
    assert.ok(rows.every((x) => x.shared && x.status === "open" && x.addedBy === member.Sudhersan));
    const turkey = rows.find((x) => x.name === "Ground turkey")!;
    assert.deepEqual([turkey.qty, Number(turkey.quantity), turkey.unit, turkey.estCents], ["2 lb", 2, "pound", null]);
    noPrice(r);
    assert.equal(r.links, undefined);
    const view: CartView = await run("cart_view", {});
    assert.ok(view.groups.Shared.every((i) => i.recipe === "Tacos for 5"));
    const again = await run("recipe_add_to_cart", { recipe: "the tacos", skip: ["onions"] });
    assert.equal(again.addedCount, 0);
    assert.equal(again.alreadyInCart.length, 8);
    await assert.rejects(run("recipe_add_to_cart", { recipe: "lasagna" }), /No recipe like "lasagna"/);
  });

  test("recipe_link: an Instacart recipe page (fake) with every ingredient, cached until the ingredients change", async () => {
    const calls = instacart.calls.length;
    const r = await run("recipe_link", { recipe: "tacos" });
    assert.equal(r.available, true);
    assert.match(r.links[0].url, /^https:\/\/instacart\.example\/recipes\//);
    const sent = instacart.calls.at(-1)!;
    assert.equal(sent.slug, "INSTACART_CREATE_RECIPE_PAGE");
    assert.equal((sent.args.ingredients as unknown[]).length, 11);
    assert.equal(sent.args.servings, 5);
    assert.deepEqual(sent.args.landing_page_configuration, { partner_linkback_url: `${appUrl}/g/${groupId}/cart`, enable_pantry_items: true });
    assert.equal((await run("recipe_link", {})).links[0].url, r.links[0].url);
    assert.equal(instacart.calls.length, calls + 1, "cached");
    const [row] = await db.select().from(schema.recipes).where(eq(schema.recipes.id, tacosId));
    await db.update(schema.recipes).set({ servings: 6 }).where(eq(schema.recipes.id, tacosId));
    const changed = await run("recipe_link", {});
    assert.notEqual(changed.links[0].url, r.links[0].url, "a changed recipe gets a new link");
    await db.update(schema.recipes).set({ servings: row.servings }).where(eq(schema.recipes.id, tacosId));
  });

  test("cart_remove: Members remove their own items, Admins anyone's", async () => {
    await run("cart_add", { items: [{ name: "kombucha" }] }, ryanRc());
    const refused = await run("cart_remove", { name: "ground turkey" }, ryanRc());
    assert.equal(refused.notAllowed, true);
    assert.match(refused.message, /Only Sudhersan .* or an admin/);
    assert.equal((await run("cart_remove", { name: "kombucha" }, ryanRc())).removed, true);
    await run("cart_add", { items: [{ name: "kombucha" }] }, ryanRc());
    const [k] = await db.select().from(schema.cartItems).where(and(eq(schema.cartItems.groupId, groupId), eq(schema.cartItems.name, "kombucha"), eq(schema.cartItems.status, "open")));
    assert.equal(await cart.removeItemById(ctx, { id: k.id }), true, "the Admin removes Ryan's");
  });

  test("cart_purchased after a checkout: exact Shares by item, recipe items shared, personal to the adder", async () => {
    await run("cart_add", { items: [{ name: "greek yogurt" }] }, ryanRc());
    const ask = await run("cart_checkout", {});
    assert.deepEqual([ask.askFirst, ask.suggested, ask.links], [true, ["sparkling water"], undefined], "asks about what's probably low first");
    const checkout = await run("cart_checkout", { skip_suggestions: true });
    assert.equal(checkout.itemCount, 9);
    const open = await cart.listOpenItems(ctx);
    const expected = cart.computeCartSplits(open.map((i) => ({ addedBy: i.addedBy!, shared: i.shared, estCents: i.estCents })), (await members.listMembers(ctx)).map((m) => m.id), 8400, member.Sudhersan);
    const r = await run("cart_purchased", { total: 84 });
    assert.equal(r.total, "$84.00");
    assert.equal(r.method, "exact");
    assert.equal(r.category, "groceries");
    assert.equal(r.description, "Groceries (9 items)");
    assert.deepEqual(Object.fromEntries((r.splits as { memberId: string; cents: number }[]).map((s) => [s.memberId, s.cents])), Object.fromEntries(expected.map((s) => [s.memberId, s.cents])));
    assert.ok(r.shares.every((s: { owes: string }) => /^\$\d+\.\d{2}$/.test(s.owes)), "ready-to-say amounts");
    const ryan = expected.find((s) => s.memberId === member.Ryan)!.cents;
    const alex = expected.find((s) => s.memberId === member.Alex)!.cents;
    assert.ok(ryan > alex, "Ryan's yogurt is on Ryan");
    const [c] = await db.select().from(schema.cartCheckouts).where(eq(schema.cartCheckouts.id, checkout.checkoutId));
    assert.equal(c.expenseId, r.id);
    assert.equal((await cart.listOpenItems(ctx)).length, 0);
  });

  test("cart_from_photo: a list photo is read (fake vision), summarized, added as shared only on confirm; a receipt points at Money's tool", async () => {
    const photos = await import("@/services/grocery-photos");
    const list = await receipts.saveUpload({ groupId }, Buffer.from("a shopping list"), "image/jpeg");
    const bill = await receipts.saveUpload({ groupId }, Buffer.from("a receipt"), "image/jpeg");
    photos.setPhotoReader({ read: async ({ dataUrl }) => (Buffer.from(dataUrl.split(",")[1], "base64").toString().includes("receipt") ? JSON.stringify({ kind: "receipt" }) : photos.SAMPLE_LIST_JSON) });
    try {
      const read = await run("cart_from_photo", { photo_url: list.path, shared: true });
      assert.equal(read.needsConfirmation, true);
      assert.equal(read.kind, "list");
      assert.equal(read.summary, "5 items: eggs (12), milk (1 gallon), bread, bananas (6), rice (2 lb)");
      assert.equal((await cart.listOpenItems(ctx)).length, 0, "reading adds nothing");
      noPrice(read);
      const done = await run("cart_from_photo", { photo_url: list.path, shared: true, confirm: true, skip: ["rice"] });
      assert.deepEqual(done.added, ["eggs", "milk", "bread", "bananas"]);
      const open = await cart.listOpenItems(ctx);
      assert.ok(open.length === 4 && open.every((i) => i.shared && i.estCents === null));
      assert.equal(open.find((i) => i.name === "eggs")?.qty, "12");
      assert.equal((await lastActivity()).summary, "put eggs, milk, bread and 1 more on the Cart for everyone");
      const r = await run("cart_from_photo", { photo_url: bill.path });
      assert.deepEqual(r, { kind: "receipt", next: "expense_from_receipt" }, "no Money check: Groceries requires it");
      // Another Group's Document is in core-slots.dbtest.ts; here a link to none at all.
      const theirs = `/api/docs/${crypto.randomUUID()}`;
      await assert.rejects(run("cart_from_photo", { photo_url: theirs }), /only read photos sent in this group's chat/);
      await assert.rejects(run("expense_from_receipt", { receipt_url: theirs }), /only read photos sent in this group's chat/);
      for (const i of open) await cart.removeItemById(ctx, { id: i.id });
    } finally {
      photos.setPhotoReader(null);
      photos.clearPhotoCache();
    }
  });

  test("recipe_add_to_cart: buyable amounts, the spices assumed and named once, a usual wins; the recipe keeps cooking amounts; the Pantry's 'not kept' isn't assumed", async () => {
    const beefTacos = JSON.stringify({
      title: "Beef tacos for 4",
      servings: 4,
      cooking_time: 25,
      ingredients: [
        { name: "ground beef", quantity: 1, unit: "lb", display_text: "1 lb ground beef" },
        { name: "garlic", quantity: 2, unit: "clove", display_text: "2 cloves garlic, minced" },
        { name: "chili powder", quantity: 1, unit: "tbsp", display_text: "1 tbsp chili powder" },
        { name: "ground cumin", quantity: 2, unit: "tsp", display_text: "2 tsp ground cumin" },
        { name: "sour cream", quantity: 4, unit: "tbsp", display_text: "4 tbsp sour cream" },
        { name: "salt", quantity: 0.5, unit: "tsp", display_text: "1/2 tsp salt" },
        { name: "black pepper", quantity: 0.25, unit: "tsp", display_text: "1/4 tsp black pepper" },
        { name: "corn tortillas", quantity: 12, unit: "each", display_text: "12 corn tortillas" },
        { name: "cheddar", quantity: 6, unit: "oz", display_text: "6 oz cheddar, grated" },
      ],
      steps: ["Brown the beef with the garlic and spices.", "Warm the tortillas.", "Fill, top with cheddar and sour cream."],
    });
    recipes.setRecipeWriter({ write: async () => beefTacos });
    try {
      // The house always gets the big tub of sour cream.
      await run("cart_add", { items: [{ name: "sour cream", qty: "16 oz tub", remember: true }], shared: true });
      await run("cart_remove", { name: "sour cream" });
      const draft = await run("recipe_draft", { request: "beef tacos for 4", servings: 4 });
      assert.match(draft.text, /Need: 1 lb ground beef, 2 cloves garlic, minced, 1 tbsp chili powder, 2 tsp ground cumin, 4 tbsp sour cream/, "the recipe keeps cooking amounts");
      const r = await run("recipe_add_to_cart", { recipe: "beef tacos" });
      // The house bought 20 tortillas for the last tacos (cart_purchased taught that usual), so 20 it is.
      assert.deepEqual(r.added.sort(), ["Cheddar (8 oz)", "Corn tortillas (20)", "Garlic (1 head)", "Ground beef (1 lb)", "Sour cream (16 oz tub)"]);
      assert.deepEqual(r.assumed, ["chili powder", "ground cumin", "black pepper"]);
      assert.deepEqual(r.skippedHave, ["salt"], "salt is in the Pantry: had, not assumed");
      assert.equal(r.say, "Added 5 things for Beef tacos for 4 to the Cart. I assumed you have chili powder, ground cumin and black pepper; say if you're out. Want me to keep them in the Pantry?");
      noPrice(r);
      // "We don't keep cumin": out of the Pantry, so it's bought next time.
      await run("pantry_set", { remove: ["cumin"] });
      const again = await run("recipe_add_to_cart", { recipe: "beef tacos" });
      assert.deepEqual([again.added, again.assumed], [["Ground cumin (1 package)"], ["chili powder", "black pepper"]]);
      for (const i of await cart.listOpenItems(ctx)) await cart.removeItemById(ctx, { id: i.id });
    } finally {
      recipes.setRecipeWriter({ write: async () => recipes.SAMPLE_RECIPE_JSON });
    }
  });

  test("keep_document / find_documents: 'roomie keep this, it's the lease' files the photo; find gives links only when asked to open", async () => {
    const photo = await receipts.saveUpload({ groupId }, Buffer.from("lease page 1"), "image/jpeg");
    assert.deepEqual(await run("find_documents", { query: "lease" }), { found: [] }, "an unkept photo isn't found");
    assert.deepEqual(await run("keep_document", { url: photo.path, title: "Lease 2026-27", kind: "lease" }), { kept: "Lease 2026-27", kind: "lease" });
    const found = await run("find_documents", { query: "the lease" });
    assert.deepEqual(found.found.map((d: { title: string; kind: string }) => [d.title, d.kind]), [["Lease 2026-27", "lease"]]);
    assert.equal(found.links, undefined);
    const open = await run("find_documents", { query: "lease", open: true });
    if (process.env.APP_URL?.startsWith("http")) assert.ok(open.links[0].url.endsWith(`/api/docs/${photo.id}`));
    await assert.rejects(run("keep_document", {}), /Send the photo or file/);
    assert.equal((await lastActivity()).summary, "kept Lease 2026-27");
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
    const refused = await run("log_expense", { amount: 20, description: "pizza", category: "food" }, priyaRc);
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
    const e: Summary = await run("log_expense", { amount: 20, description: "pizza", category: "food" }, contextFor(priya, "Priya", "member", "active"));
    assert.deepEqual(e.paidBy, [{ name: "Priya", paid: "$20.00" }]);
    assert.equal(e.shares.length, 4);
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
    assert.equal(s.learned, "Learned Money and Groceries.", "the one setup line: what was learned, no tip or offer (#44)");
    const [g] = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
    assert.ok(g.onboardedAt, "Onboarding is done");
    await assert.rejects(run("set_group_settings", { timezone: "Mars/Olympus" }), /don't know the time zone "Mars\/Olympus"\. Which city/);
    assert.equal((await run("set_group_settings", { timezone: "India" })).timezone, "Asia/Kolkata");
    assert.equal((await run("set_group_settings", { timezone: "CST" })).timezone, "America/Chicago");
    const t = await run("toggle_toolkit", { toolkit: "house", enabled: true }, contextFor(member.Ryan, "Ryan", "admin", "active"));
    assert.ok(t.toolkits.includes("house"));
    assert.equal((await run("toggle_toolkit", { toolkit: "upkeep", enabled: true }, alex)).reason, "admin-only", "'upkeep' is House's word too");
    assert.equal((await run("set_group_settings", { reportHour: 9 }, alex)).reason, "admin-only");
  });

  test("Groceries needs Money: teaching Groceries with Money off is refused and says why; so is forgetting Money while Groceries is on", async () => {
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`money-${name}-${Date.now()}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `money-${Date.now()}`, title: "Money test" }, people, people[0]);
    const gid = joined.group.id;
    const rc = new RequestContext<unknown>([
      ["groupId", gid],
      ["memberId", joined.members[0].id],
      ["memberName", "Maya"],
      ["role", "admin"],
      ["status", "active"],
      ["source", "chat"],
    ]);
    try {
      const on = () => groups.enabledToolkits({ groupId: gid });
      const keep = await run("toggle_toolkit", { toolkit: "money", enabled: false }, rc);
      assert.equal(keep.reason, "needed-by");
      assert.equal(keep.message, "Groceries needs Money, so I'm keeping it.");
      assert.ok((await on()).includes("splitting"), "Money stays on");

      assert.equal((await run("toggle_toolkit", { toolkit: "groceries", enabled: false }, rc)).enabled, false);
      const off = await run("toggle_toolkit", { toolkit: "splitting", enabled: false }, rc);
      assert.equal(off.enabled, false, "with Groceries off, Money can go");
      const refused = await run("toggle_toolkit", { toolkit: "groceries", enabled: true }, rc);
      assert.equal(refused.reason, "requirements");
      assert.equal(refused.message, "I can't learn Groceries yet: it needs Money first.");
      assert.ok(!(await on()).includes("groceries"), "Groceries stays off");
      assert.ok(!/toolkit|feature|enable/i.test(refused.message + keep.message), "Tricks vocabulary only");

      await run("toggle_toolkit", { toolkit: "money", enabled: true }, rc);
      assert.equal((await run("toggle_toolkit", { toolkit: "groceries", enabled: true }, rc)).enabled, true, "Money on, Groceries follows");
    } finally {
      await deleteGroup(gid);
    }
  });

  test("set_group_settings with toolkits: [groceries] ends with Money on too, and the setup line says so", async () => {
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`list-${name}-${Date.now()}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `list-${Date.now()}`, title: "Apt 4B" }, people, people[0]);
    const gid = joined.group.id;
    const rc = new RequestContext<unknown>([
      ["groupId", gid],
      ["memberId", joined.members[0].id],
      ["memberName", "Maya"],
      ["role", "admin"],
      ["status", "active"],
      ["source", "chat"],
    ]);
    try {
      const s = await run("set_group_settings", { purpose: "roommates", toolkits: ["groceries"] }, rc);
      assert.deepEqual(s.toolkits, ["splitting", "groceries"]);
      assert.deepEqual(await groups.enabledToolkits({ groupId: gid }), ["splitting", "groceries"]);
      assert.match(s.learned, /^Learned Money and Groceries\./);
      const later = await run("set_group_settings", { toolkits: ["house", "groceries"] }, rc);
      assert.deepEqual(later.toolkits, ["splitting", "groceries", "house"], "a later list keeps Money under Groceries too");
    } finally {
      await deleteGroup(gid);
    }
  });

  test("migration 0012: a Group's chores / upkeep rows become one house row (on if either was on, the nudge hour kept); running it again changes nothing", async () => {
    // The migration's own SQL, as scripts/migrate.ts runs it. Idempotent, so it's safe on the dev branch (no old rows left).
    const statements = (await readFile("drizzle/0012_house.sql", "utf8")).split("--> statement-breakpoint").map((s) => s.trim()).filter(Boolean);
    const migrate = async () => {
      for (const s of statements) await db.execute(sql.raw(s));
    };
    const houseRow = async (gid: string) => (await db.select().from(schema.groupToolkits).where(and(eq(schema.groupToolkits.groupId, gid), eq(schema.groupToolkits.toolkit, "house"))))[0];
    const onlyChores = await onGroupJoined({ channel: "dev", externalId: `mig-a-${Date.now()}`, title: "Chores only" }, [{ userExternalId: devUserId(`mig-a-${Date.now()}`), name: "Maya" }], { userExternalId: devUserId(`mig-a-${Date.now()}`), name: "Maya" });
    const bothOff = await onGroupJoined({ channel: "dev", externalId: `mig-b-${Date.now()}`, title: "Both off" }, [{ userExternalId: devUserId(`mig-b-${Date.now()}`), name: "Dev" }], { userExternalId: devUserId(`mig-b-${Date.now()}`), name: "Dev" });
    try {
      // The old shape: a Group with Chores on (nudge at 7) and no Upkeep row; another that had forgotten both.
      await db.delete(schema.groupToolkits).where(and(eq(schema.groupToolkits.groupId, onlyChores.group.id), eq(schema.groupToolkits.toolkit, "house")));
      await db.insert(schema.groupToolkits).values({ groupId: onlyChores.group.id, toolkit: "chores", enabled: true, settings: { nudgeHour: 7 } });
      await db.delete(schema.groupToolkits).where(and(eq(schema.groupToolkits.groupId, bothOff.group.id), eq(schema.groupToolkits.toolkit, "house")));
      await db.insert(schema.groupToolkits).values([
        { groupId: bothOff.group.id, toolkit: "chores", enabled: false, settings: { nudgeHour: null } },
        { groupId: bothOff.group.id, toolkit: "upkeep", enabled: false },
      ]);
      await migrate();
      assert.deepEqual([(await houseRow(onlyChores.group.id)).enabled, (await houseRow(onlyChores.group.id)).settings], [true, { nudgeHour: 7 }]);
      assert.deepEqual([(await houseRow(bothOff.group.id)).enabled, (await houseRow(bothOff.group.id)).settings], [false, { nudgeHour: null }]);
      assert.deepEqual(await groups.enabledToolkits({ groupId: onlyChores.group.id }), ["splitting", "groceries", "house"]);
      assert.deepEqual(await groups.enabledToolkits({ groupId: bothOff.group.id }), ["splitting", "groceries"]);
      assert.deepEqual(await schedule.getSchedule({ groupId: onlyChores.group.id }), { nudgeHour: 7, reportWeekday: 0, reportHour: 18 }, "the nudge hour carried over");
      const old = await db.select().from(schema.groupToolkits).where(inArray(schema.groupToolkits.toolkit, ["chores", "upkeep"]));
      assert.equal(old.length, 0, "the old rows are gone");
      await migrate();
      assert.deepEqual([(await houseRow(onlyChores.group.id)).enabled, (await houseRow(bothOff.group.id)).enabled], [true, false], "a second run changes nothing");
    } finally {
      await deleteGroup(onlyChores.group.id);
      await deleteGroup(bothOff.group.id);
    }
  });

  test("Onboarding a household ('roommates, USD, Chicago'): House's onEnable adds three starter chores for everyone and the usual upkeep, once", async () => {
    const people = ["Maya", "Dev"].map((name) => ({ userExternalId: devUserId(`house-${name}-${Date.now()}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `house-${Date.now()}`, title: "House test" }, people, people[0]);
    const gid = joined.group.id;
    try {
      const rc = new RequestContext<unknown>([
        ["groupId", gid],
        ["memberId", joined.members[0].id],
        ["memberName", "Maya"],
        ["role", "admin"],
        ["status", "active"],
        ["source", "chat"],
      ]);
      const s = await run("set_group_settings", { purpose: "roommates", currency: "USD", timezone: "Chicago" }, rc);
      assert.equal(s.timezone, "America/Chicago");
      const chartOf = async () => db.select().from(schema.chores).where(eq(schema.chores.groupId, gid));
      const upkeepOf = async () => db.select().from(schema.maintenance).where(eq(schema.maintenance.groupId, gid));
      const chart = await chartOf();
      assert.deepEqual(chart.map((c) => c.name).sort(), ["Clean the bathroom", "Dishes", "Take out the trash"]);
      assert.ok(chart.every((c) => c.rotation === null), "everyone, new people included");
      assert.equal((await upkeepOf()).length, 5);
      await run("set_group_settings", { purpose: "roommates" }, rc);
      assert.equal((await chartOf()).length, 3, "only at Onboarding");
      // "roomie, forget house" then "roomie, learn house": the hook runs again and adds nothing twice.
      await run("chore_remove", { chore: "Dishes" }, rc);
      await run("toggle_toolkit", { toolkit: "house", enabled: false }, rc);
      await run("toggle_toolkit", { toolkit: "house", enabled: true }, rc);
      assert.deepEqual((await chartOf()).map((c) => c.name).sort(), ["Clean the bathroom", "Take out the trash"], "a chart with chores on it is left alone");
      assert.equal((await upkeepOf()).length, 5, "the usual five are already tracked");
    } finally {
      await deleteGroup(gid);
    }
  });

  test("toggle_toolkit goes through the catalog (names, coming soon, unknown); list_toolkits; a dashboard switch-on posts one line", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    const off = await run("toggle_toolkit", { toolkit: "Groceries", enabled: false });
    assert.equal(off.enabled, false);
    assert.ok(!off.toolkits.includes("groceries"));
    assert.equal((await run("toggle_toolkit", { toolkit: "groceries", enabled: true }, alex)).reason, "admin-only", "members are refused kindly");
    const soon = await run("toggle_toolkit", { toolkit: "trips", enabled: true });
    assert.equal(soon.notAvailable, true);
    assert.equal(soon.reason, "coming-soon");
    assert.match(soon.message, /can't learn Trips yet/);
    for (const name of ["outings", "cooking", "move out"]) {
      const r = await run("toggle_toolkit", { toolkit: name, enabled: true });
      assert.equal(r.reason, "coming-soon", `${name} is coming soon`);
      assert.match(r.message, /it's on the list/);
      assert.ok(!/toolkit|feature|capabilit|module|plugin/i.test(r.message), "Tricks vocabulary only");
    }
    assert.equal((await run("toggle_toolkit", { toolkit: "spaceships", enabled: true })).reason, "unknown");
    assert.match((await run("toggle_toolkit", { toolkit: "spaceships", enabled: true })).message, /don't know a "spaceships" Trick/);

    const list = await run("list_toolkits", {}, alex);
    assert.ok(list.known.some((t: { name: string; try?: string[] }) => t.name === "Money" && t.try?.length));
    assert.ok(list.couldLearn.some((t: { name: string }) => t.name === "Groceries"));
    assert.ok(list.comingSoon.includes("Guests") && list.comingSoon.includes("Stickers"));
    assert.ok(["Outings", "Cooking", "Move-out"].every((n) => list.comingSoon.includes(n)));
    assert.ok(list.couldLearn.some((t: { name: string }) => t.name === "Lease Inbox"), "built (#27): one to teach, not Soon");
    assert.ok(!list.known.concat(list.couldLearn).some((t: { name: string }) => t.name === "Core"), "core isn't a Trick");
    assert.match(list.say, /^Money, .*\. Just talk to me\.$/, "one line, like the launch video");
    assert.ok(list.couldLearn.some((t: { name: string }) => t.name === "Groceries"), "what could be learned stays in the result, for when they ask");
    assert.doesNotMatch(JSON.stringify(list), /Splitting/, "the Trick is called Money");
    assert.ok(!/toolkit|feature|enable/i.test(list.say + list.whoCanTeach), "Tricks vocabulary only");
    assert.equal(list.links, undefined, "no Browse Tricks link: links only when asked");

    const learned = await run("toggle_toolkit", { toolkit: "groceries", enabled: true });
    assert.equal(learned.say, "Learned Groceries: one shared Cart, recipes for the group, and an Instacart list.");
    const forgot = await run("toggle_toolkit", { toolkit: "groceries", enabled: false });
    assert.match(forgot.say, /^Forgot Groceries\. Nothing's deleted/);

    const ui = { groupId, memberId: member.Sudhersan, source: "ui" as const };
    const said = async () => (await chatlog.roomieLines(groupId, 50)).filter((l) => l.text === "Learned Groceries: one shared Cart, recipes for the group, and an Instacart list.").length;
    const on = await toolkitsSvc.setToolkit(ui, { toolkit: "groceries", enabled: true });
    assert.deepEqual([on.changed, on.enabled, on.summary], [true, true, "One shared Cart, recipes for the group, and an Instacart list."]);
    assert.equal(await said(), 1, "Roomie says it once in the chat");
    await toolkitsSvc.setToolkit(ui, { toolkit: "groceries", enabled: false });
    await toolkitsSvc.setToolkit(ui, { toolkit: "groceries", enabled: true });
    assert.equal(await said(), 1, "off and on again within the cooldown: no second line");
    const again = await toolkitsSvc.setToolkit(ui, { toolkit: "groceries", enabled: true });
    assert.equal(again.changed, false, "already on: no change, no hook, no Activity");
    const rows = await db.select().from(schema.activity).where(and(eq(schema.activity.groupId, groupId), eq(schema.activity.kind, "toolkit.toggled")));
    assert.ok(rows.some((r) => r.summary === "taught Roomie Groceries"));
    assert.ok(rows.some((r) => r.summary === "had Roomie forget Groceries"));
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

  test("set_group_settings has no personality (ADR 0020): one voice, whatever a Group stored", async () => {
    const s = await run("set_group_settings", { chattiness: "normal" });
    assert.equal("personality" in s, false);
    // A Group that set a vibe before still reads as chill, called Roomie.
    await personalitySvc.updatePersonality(ctx, { base: "gremlin", name: "Dino", quirks: ["obsessed with the plant"] });
    const p = await personalitySvc.getPersonality({ groupId });
    assert.equal(p.base, "chill");
    assert.equal(p.name, "Roomie");
    assert.deepEqual(p.quirks, []);
  });

  test("the Learned style: the job counts what the model proposes, resets on an Admin's word; pet moments are claimed once", async () => {
    const { refreshStyleNote, setCandidateReader } = await import("@/jobs/style-note");
    const lines = ["bet", "bet lol", "no cap", "ryry you coming", "ok ryry", "ryry!!", "fr"];
    // Everything this Group logged so far stays out of the batch (rounded up past the microseconds).
    const [{ since }] = await db
      .select({ since: sql<string | null>`ceil(extract(epoch from max(${schema.chatMessages.createdAt})) * 1000) + 1` })
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.groupId, groupId));
    await db.insert(schema.chatMessages).values(lines.map((text) => ({ groupId, memberId: member.Sudhersan, text })));
    setCandidateReader(async () => ({ languages: [{ name: "English", share: 1 }], codeSwitching: 0, slang: ["bet", "no cap", "fr"], tone: ["dry"], nicknames: [{ nickname: "ryry", member: "Ryan" }], insideJokes: [] }));
    try {
      assert.equal(await refreshStyleNote(groupId, since ? new Date(Number(since)) : null, new Date(), true), true);
    } finally {
      setCandidateReader(null);
    }
    const learned = (await personalitySvc.getPersonality({ groupId })).learned;
    assert.deepEqual(learned.slang, [{ phrase: "bet", count: 2 }], "no cap and fr were said once");
    assert.deepEqual(learned.nicknames, [{ nickname: "ryry", member: "Ryan", count: 3 }]);
    assert.equal(learned.messagesSeen, lines.length);
    assert.ok(learned.confidence > 0 && learned.confidence < 0.1);
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    await assert.rejects(personalitySvc.resetLearned({ groupId, memberId: member.Alex }), /Only an admin/);
    assert.equal((await run("set_group_settings", { chattiness: "chatty" }, alex)).reason, "admin-only");
    assert.equal((await personalitySvc.resetLearned(ctx)).learned.messagesSeen, 0);

    const { dbMoments } = await import("@/services/pet");
    assert.equal(await dbMoments.claim(groupId, "greeting", "2026-10-28"), true);
    assert.equal(await dbMoments.claim(groupId, "greeting", "2026-10-28"), false, "the primary key makes it once");
    assert.equal(await dbMoments.claim(groupId, "win", "streak:dishes:alex:3:2026-10-28"), true);
  });

  test("remember and what_do_you_know_about_me: your own note; someone else's only as an Admin", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    const r = await run("remember", { diet: "vegetarian", caresAbout: "the plant" }, alex);
    assert.match(r.remembered, /diet: vegetarian; cares about the plant/);
    await run("remember", { allergies: "peanuts" }, alex);
    const mine = await run("what_do_you_know_about_me", {}, alex);
    assert.equal(mine.name, "Alex");
    assert.match(mine.facts, /vegetarian.*peanuts.*the plant/);
    assert.equal((await run("what_do_you_know_about_me", { who: "Sudhersan" }, alex)).reason, "admin-only");
    const asAdmin = await run("what_do_you_know_about_me", { who: "Alex" });
    assert.match(asAdmin.facts, /vegetarian/);
    assert.ok((await members.peopleFacts({ groupId })).some((l) => l.startsWith("Alex: ") && /vegetarian/.test(l)), "in the instructions' people block");
  });

  test("set_payment_handle and forget_me: chat lines, note, memory under any name, photos, traces, contact and identity go; the ledger stays", async () => {
    const alex = contextFor(member.Alex, "Alex", "member", "active");
    const h = await run("set_payment_handle", { app: "venmo", handle: "@alex-p" }, alex);
    assert.deepEqual(h.handles, { venmo: "@alex-p" });
    const ts = Date.now();
    // Alex as a WhatsApp Member: first called by their number, WhatsApp knows them as "Alexander P".
    const jid = `1555${String(ts).slice(-7)}@s.whatsapp.net`;
    const lid = `${ts}@lid`;
    const number = `+${jid.split("@")[0]}`;
    await db.update(schema.members).set({ channelUserId: jid }).where(eq(schema.members.id, member.Alex));
    await db.insert(schema.waContacts).values({ lid, pn: jid, name: "Alexander P" });
    await db.insert(schema.chatMessages).values([
      { groupId, memberId: member.Alex, text: "hi" },
      { groupId, memberId: member.Alex, text: "remember me?" },
    ]);
    await db.insert(schema.activity).values({ groupId, actorMemberId: member.Alex, kind: "test.forget", summary: `Alex added rent for ${number}` });
    const photo = await receipts.saveUpload({ groupId }, Buffer.from("a photo"), "image/jpeg", `forget-${ts}`);

    // Roomie's memory thread, written the way Mastra stores it.
    const thread = `group-${groupId}`;
    const now = new Date().toISOString();
    await db.execute(sql`insert into mastra_threads (id, "resourceId", title, "createdAt", "updatedAt") values (${thread}, ${groupId}, '', ${now}, ${now}) on conflict do nothing`);
    const say = (id: string, role: "user" | "assistant", text: string) =>
      db.execute(
        sql`insert into mastra_messages (id, thread_id, "resourceId", role, type, content, "createdAt", "createdAtZ") values (${id}, ${thread}, ${groupId}, ${role}, 'v2', ${JSON.stringify({ format: 2, parts: [{ type: "text", text }], content: text })}, ${now}, ${now})`,
      );
    const mid = (n: number) => `forget-${ts}-${n}`;
    await say(mid(1), "user", "[Alex] hi");
    await say(mid(2), "user", `[${number}] remember me?`);
    await say(mid(3), "user", `[Alexander P] [photo: ${photo.path}] look`);
    await say(mid(4), "user", "[Ryan] hi");
    await say(mid(5), "assistant", "Alex owes Ryan $5.00");
    await say(mid(6), "assistant", "Ryan is all square.");

    // Traces: Alex's message (root + child), a scorer run that scored it, its score; and Ryan's trace, which stays.
    const span = (traceId: string, spanId: string, metadata: Record<string, unknown>, input: unknown = null) =>
      db.execute(
        sql`insert into mastra_ai_spans ("traceId", "spanId", name, "spanType", "isEvent", "startedAt", "createdAt", "createdAtZ", metadata, input) values (${traceId}, ${spanId}, 'roomie message', 'generic', false, ${now}, ${now}, ${now}, ${JSON.stringify(metadata)}::jsonb, ${JSON.stringify(input)}::jsonb)`,
      );
    const t1 = `t-forget-${ts}-alex`;
    const t2 = `t-forget-${ts}-ryan`;
    const t3 = `t-forget-${ts}-ryan-quoting-alex`;
    await span(t1, "root", { groupId, memberId: member.Alex });
    await span(t1, "child", {});
    await span(`${t1}-scorer`, "run", { targetTraceId: t1 });
    await span(`${t1}-scorer`, "judge", {}, { prompt: "[Alex] hi" });
    await span(t2, "root", { groupId, memberId: member.Ryan }, { text: "[Ryan] hi" });
    await span(t3, "root", { groupId, memberId: member.Ryan }, { text: "[Ryan] roomie what did alex say" });
    await span(t3, "agent", {}, { context: `Recent group chat:\n[${number}] remember me?` });
    const [reminder] = await db.insert(schema.reminders).values({ groupId, text: "call mom", dueAt: new Date(Date.now() + 86_400_000), memberId: member.Alex, createdBy: member.Alex }).returning();
    await db.execute(
      sql`insert into mastra_scorers (id, "scorerId", "runId", scorer, score, input, output, source, "createdAt", "updatedAt", "traceId") values (${`s-${ts}`}, 'brevity-tone', 'r', '{}'::jsonb, 1, '{}'::jsonb, '{}'::jsonb, 'LIVE', ${now}, ${now}, ${t1})`,
    );

    const splitsBefore = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.memberId, member.Alex));
    try {
      const r = await run("forget_me", {}, alex);
      assert.equal(r.chatLines, 2);
      assert.equal(r.keptLedger, true);
      assert.equal(r.memoryMessages, 4, "Alex's 3 lines under 3 names + Roomie's reply naming Alex");
      const lines = await db.select().from(schema.chatMessages).where(and(eq(schema.chatMessages.groupId, groupId), eq(schema.chatMessages.memberId, member.Alex)));
      assert.equal(lines.length, 0);
      assert.equal((await db.select().from(schema.memberNotes).where(eq(schema.memberNotes.memberId, member.Alex))).length, 0);
      const splitsAfter = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.memberId, member.Alex));
      assert.equal(splitsAfter.length, splitsBefore.length, "Shares are kept so Balances still add up");

      const [me] = await db.select().from(schema.members).where(eq(schema.members.id, member.Alex));
      assert.deepEqual([me.displayName, me.channelUserId, me.accountId, me.status], ["Former member", null, null, "removed"]);
      const left = (await db.execute(sql`select id from mastra_messages where thread_id = ${thread} and id like ${`forget-${ts}-%`} order by id`)).rows.map((x) => (x as { id: string }).id);
      assert.deepEqual(left, [mid(4), mid(6)], "Ryan's line with the same text and the reply that doesn't name Alex stay");
      assert.equal(await docExists(photo.id), false, "the photo in a forgotten line is deleted");
      const spans = (await db.execute(sql`select "traceId" from mastra_ai_spans where "traceId" like ${`t-forget-${ts}%`}`)).rows.map((x) => (x as { traceId: string }).traceId);
      assert.deepEqual(spans, [t2], "Alex's trace, its whole scorer run and Ryan's trace quoting Alex's line are gone; Ryan's own stays");
      assert.equal((await db.select().from(schema.reminders).where(eq(schema.reminders.id, reminder.id))).length, 0, "reminders set for them");
      assert.equal((await db.execute(sql`select 1 from mastra_scorers where id = ${`s-${ts}`}`)).rows.length, 0);
      assert.equal((await db.select().from(schema.waContacts).where(eq(schema.waContacts.lid, lid))).length, 0, "the WhatsApp contact row behind their id");
      const [act] = await db.select().from(schema.activity).where(and(eq(schema.activity.groupId, groupId), eq(schema.activity.kind, "test.forget")));
      assert.equal(act.summary, "Former member added rent for Former member");

      const again = await members.forgetMe({ groupId, memberId: member.Alex, source: "chat" });
      assert.deepEqual(again, { chatLines: 0, memoryMessages: 0 }, "safe to run twice");
    } finally {
      await db.execute(sql`delete from mastra_ai_spans where "traceId" like ${`t-forget-${ts}%`}`);
      await db.execute(sql`delete from mastra_scorers where id = ${`s-${ts}`}`);
      await db.delete(schema.waContacts).where(eq(schema.waContacts.lid, lid));
    }
  });

  test("retention: traces, scores and memory messages older than 30 days go; newer ones stay", async () => {
    const ts = Date.now();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
    const recent = new Date().toISOString();
    const thread = `retention-${ts}`;
    for (const [id, at] of [["old", old], ["new", recent]] as const) {
      await db.execute(sql`insert into mastra_ai_spans ("traceId", "spanId", name, "spanType", "isEvent", "startedAt", "createdAt", "createdAtZ") values (${`t-ret-${ts}-${id}`}, 's', 'roomie message', 'generic', false, ${at}, ${at}, ${at})`);
      await db.execute(
        sql`insert into mastra_scorers (id, "scorerId", "runId", scorer, score, input, output, source, "createdAt", "updatedAt") values (${`s-ret-${ts}-${id}`}, 'x', 'r', '{}'::jsonb, 1, '{}'::jsonb, '{}'::jsonb, 'LIVE', ${at}, ${at})`,
      );
      await db.execute(sql`insert into mastra_messages (id, thread_id, role, type, content, "createdAt", "createdAtZ") values (${`m-ret-${ts}-${id}`}, ${thread}, 'user', 'v2', '{"format":2,"parts":[]}', ${at}, ${at})`);
    }
    try {
      const counts = await runRetention();
      assert.ok(counts.spans >= 1 && counts.scores >= 1 && counts.memoryMessages >= 1, JSON.stringify(counts));
      const ids = async (table: string, col: string) => (await db.execute(sql.raw(`select "${col}" as id from ${table} where "${col}" like '%-ret-${ts}-%' order by 1`))).rows.map((x) => (x as { id: string }).id);
      assert.deepEqual(await ids("mastra_ai_spans", "traceId"), [`t-ret-${ts}-new`]);
      assert.deepEqual(await ids("mastra_scorers", "id"), [`s-ret-${ts}-new`]);
      assert.deepEqual(await ids("mastra_messages", "id"), [`m-ret-${ts}-new`]);
    } finally {
      await db.execute(sql`delete from mastra_ai_spans where "traceId" like ${`t-ret-${ts}-%`}`);
      await db.execute(sql`delete from mastra_scorers where id like ${`s-ret-${ts}-%`}`);
      await db.execute(sql`delete from mastra_messages where id like ${`m-ret-${ts}-%`}`);
    }
  });

});

// ---------- Splitwise against the in-memory fake (a second throwaway Group named like the fake's people) ----------

describe("Splitwise tools against the fake client", () => {
  let gid: string;
  let ids: Record<string, string>;
  let rc: RequestContext;
  let fake: FakeSplitwise;
  const as = (name: string) => new RequestContext<unknown>([["groupId", gid], ["memberId", ids[name]], ["memberName", name], ["role", name === "Maya" ? "admin" : "member"], ["status", "active"], ["source", "chat"]]);
  const cents = async () => Object.fromEntries((await money.getBalances({ groupId: gid })).map((b) => [b.name, b.cents]));

  before(async () => {
    fake = new FakeSplitwise();
    setSplitwiseClient(fake);
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`sw-${name}-${Date.now()}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `test-sw-${Date.now()}`, title: `Splitwise test ${Date.now()}` }, people, people[0]);
    gid = joined.group.id;
    ids = Object.fromEntries(joined.members.map((m) => [m.displayName, m.id]));
    rc = as("Maya");
  });

  after(async () => {
    setSplitwiseClient(null);
    if (gid) await deleteGroup(gid);
  });

  test("not connected yet: status says so; non-Admins can't connect", async () => {
    const s = await run("splitwise_status", {}, rc);
    assert.equal(s.available, true);
    assert.equal(s.connected, false);
    assert.equal((await run("splitwise_connect", {}, as("Dev"))).reason, "admin-only");
    const r = await run("splitwise_import", { group: "Apt 4B" }, rc);
    assert.equal(r.notConnected, true);
    assert.match(r.message, /isn't connected yet/);
  });

  test("connect, then import a group: people matched by name, Jordan comes in Pending, history and payments, no duplicates", async () => {
    assert.deepEqual(await run("splitwise_connect", {}, rc), { connected: true });
    const status = await run("splitwise_status", {}, rc);
    assert.deepEqual(status.splitwiseGroups, ["Apt 4B (Splitwise)", "Tahoe weekend"]);
    const r = await run("splitwise_import", { group: "apt 4b" }, rc);
    assert.equal(r.expenses, 3);
    assert.equal(r.settlements, 1);
    assert.equal(r.skipped.deleted, 1);
    assert.deepEqual(r.newMembers, ["Jordan Lee"]);
    const [jordan] = await db.select().from(schema.members).where(and(eq(schema.members.groupId, gid), eq(schema.members.displayName, "Jordan Lee")));
    assert.equal(jordan.status, "pending");
    // Internet (Maya 75 for 3), Thai (Dev 64 for 4), Costco (Maya 70 + Sam 50 for 3), Sam paid Maya 25.
    assert.deepEqual(await cents(), { Maya: 3900, "Jordan Lee": -1600, Sam: -600, Dev: -1700 });
    const costco = (await money.listExpenses({ groupId: gid })).find((e) => e.description === "Costco")!;
    assert.equal(costco.method, "exact");
    assert.equal(costco.category, "groceries");
    assert.equal(costco.note, "Two carts");
    assert.equal(costco.occurredOn, "2026-09-14");
    assert.deepEqual(costco.payers?.map((p) => [p.name, p.cents]), [["Maya", 7000], ["Sam", 5000]]);
    assert.ok(costco.splitwiseId);
    const again = await run("splitwise_import", { group: "Apt 4B (Splitwise)" }, rc);
    assert.equal(again.expenses, 0);
    assert.equal(again.skipped.duplicate, 4);
    assert.deepEqual(await cents(), { Maya: 3900, "Jordan Lee": -1600, Sam: -600, Dev: -1700 }, "re-import changes nothing");
  });

  test("export: a one-time copy of what Splitwise doesn't have, with 2-decimal shares; running it twice copies nothing more", async () => {
    await run("log_expense", { amount: 30, description: "pizza", category: "food", splitAmong: ["Maya", "Dev", "Sam"] }, rc);
    await money.settleUp({ groupId: gid, memberId: ids.Dev, source: "chat" }, { toId: ids.Maya, cents: 500 });
    const r = await run("splitwise_export", {}, rc);
    assert.equal(r.expenses, 1);
    assert.equal(r.settlements, 1);
    const pizza = fake.state.expenses.find((e) => e.description === "pizza")!;
    assert.equal(pizza.costCents, 3000);
    assert.deepEqual(pizza.users.map((x) => [x.userId, x.paidCents, x.owedCents]).sort(), [["101", 3000, 1000], ["102", 0, 1000], ["103", 0, 1000]]);
    assert.equal((await run("splitwise_export", {}, rc)).expenses, 0);
  });

  test("live mirror: add, change and delete are queued and pushed by the outbox", async () => {
    assert.deepEqual(await run("splitwise_mirror", { on: true }, rc), { mode: "mirror" });
    const e = await run("log_expense", { amount: 45, description: "brunch", category: "food", percents: [{ name: "Maya", percent: 50 }, { name: "Dev", percent: 50 }] }, rc);
    assert.equal((await splitwise.splitwiseState({ groupId: gid })).pendingPushes, 1);
    assert.deepEqual(await splitwise.runSplitwiseOutbox(), { done: 1, failed: 0 });
    const pushed = () => fake.state.expenses.find((x) => x.description === "brunch");
    assert.equal(pushed()?.costCents, 4500);
    await run("update_expense", { expense: "brunch", amount: 50 }, rc);
    await splitwise.runSplitwiseOutbox();
    assert.deepEqual(pushed()?.users.map((x) => x.owedCents), [2500, 2500]);
    await run("delete_expense", { expense: "brunch" }, rc);
    await splitwise.runSplitwiseOutbox();
    assert.equal(pushed()?.deleted, true);
    assert.equal((await splitwise.splitwiseState({ groupId: gid })).pendingPushes, 0);
    assert.deepEqual(await run("splitwise_mirror", { on: false }, rc), { mode: "import" });
    await run("log_expense", { amount: 9, description: "coffee", category: "food" }, rc);
    assert.equal((await splitwise.splitwiseState({ groupId: gid })).pendingPushes, 0, "mirror off: nothing queued");
  });

  test("a failed push is retried later, not lost", async () => {
    await run("splitwise_mirror", { on: true }, rc);
    const real = fake.createExpense.bind(fake);
    fake.createExpense = async () => {
      throw new Error("Splitwise is down");
    };
    await run("log_expense", { amount: 12, description: "bagels", category: "food" }, rc);
    assert.deepEqual(await splitwise.runSplitwiseOutbox(), { done: 0, failed: 1 });
    fake.createExpense = real;
    assert.deepEqual(await splitwise.runSplitwiseOutbox(), { done: 0, failed: 0 }, "backoff: not due yet");
    assert.deepEqual(await splitwise.runSplitwiseOutbox(new Date(Date.now() + 5 * 60_000)), { done: 1, failed: 0 });
    assert.ok(fake.state.expenses.some((x) => x.description === "bagels"));
  });

  test("the real Composio client with a missing or rejected key answers 'not connected', never crashes", async () => {
    setSplitwiseClient(null);
    const was = process.env.SPLITWISE_FAKE;
    delete process.env.SPLITWISE_FAKE;
    try {
      const r = await run("splitwise_connect", {}, rc);
      if ((await composioHealth()) === "ok") assert.ok(r.connected !== undefined, "a valid key gives a connect link");
      else {
        assert.equal(r.notConnected, true);
        assert.match(r.message, /Splitwise isn't (connected|available|set up)/);
        const s = await run("splitwise_status", {}, rc);
        assert.equal(s.available, false);
        assert.match(s.why, /COMPOSIO_API_KEY/);
      }
    } finally {
      if (was !== undefined) process.env.SPLITWISE_FAKE = was;
      setSplitwiseClient(fake);
    }
  });
});

// ---------- WhatsApp's identity services and session store (a throwaway whatsapp Chat, wa_* rows cleaned up) ----------

describe("WhatsApp: LID -> phone JID, placeholder names, the session and contact stores", () => {
  const ts = Date.now();
  const lid = `${ts}01@lid`;
  const pn = `1555${String(ts).slice(-7)}@s.whatsapp.net`;
  const session = `test-${ts}`;
  let gid: string;

  after(async () => {
    if (gid) await deleteGroup(gid);
    await db.delete(schema.waSessions).where(eq(schema.waSessions.id, session));
    await db.delete(schema.waContacts).where(eq(schema.waContacts.lid, lid));
  });

  test("onboarded with a LID, the Member moves to the phone JID once it's known; a heard name replaces the placeholder", async () => {
    const other = { userExternalId: `1555${String(ts).slice(-7, -1)}9@s.whatsapp.net`, name: "+15550000009" };
    const joined = await onGroupJoined({ channel: "whatsapp", externalId: `${ts}@g.us`, title: `WA test ${ts}` }, [{ userExternalId: lid, name: "Someone" }, other], other);
    gid = joined.group.id;
    assert.equal(await members.rekeyChannelUser("whatsapp", lid, pn), 1);
    assert.equal(await members.rekeyChannelUser("whatsapp", lid, pn), 0, "nothing left under the LID");
    assert.equal((await members.memberByChannelUser(gid, pn))?.displayName, "Someone");
    await members.fillPlaceholderName("whatsapp", pn, "Someone", "Dev");
    await members.fillPlaceholderName("whatsapp", pn, "Someone", "Not Dev");
    assert.equal((await members.memberByChannelUser(gid, pn))?.displayName, "Dev", "a real name is never overwritten");
    assert.equal(await members.rekeyChannelUser("telegram", pn, lid), 0, "other Channels' Groups are untouched");
  });

  test("wa_sessions round-trips through jsonb; wa_contacts keeps what it learned", async () => {
    const { pgAuthRows, pgContacts } = await import("@/channels/whatsapp-store");
    const { makeAuthState } = await import("@/channels/whatsapp-auth");
    const rows = pgAuthRows(session);
    const first = await makeAuthState(rows);
    first.state.creds.registered = true;
    await first.saveCreds();
    await first.state.keys.set({ session: { "x.0": Buffer.from([7, 8]) }, "pre-key": { "5": first.state.creds.signedIdentityKey } });
    const again = await makeAuthState(rows);
    assert.equal(again.hasSession, true);
    assert.deepEqual(Buffer.from(again.state.creds.noiseKey.public), Buffer.from(first.state.creds.noiseKey.public));
    assert.deepEqual((await again.state.keys.get("session", ["x.0"]))["x.0"], Buffer.from([7, 8]));
    await again.state.keys.set({ session: { "x.0": null } });
    assert.deepEqual(await again.state.keys.get("session", ["x.0"]), {});
    await again.clear();
    assert.equal((await rows.get(["creds", "pre-key-5"])).size, 0);

    await pgContacts.save({ lid, pn: null, name: "Dev" });
    await pgContacts.save({ lid, pn, name: null });
    const mine = (await pgContacts.all()).find((c) => c.lid === lid);
    assert.deepEqual(mine, { lid, pn, name: "Dev" }, "a later save fills in, never blanks");
  });
});

// ---------- Joining (ADR 0014): the Join link, seats and the Admin's approval, in a throwaway WhatsApp Group ----------

describe("Join links and seats", () => {
  const ts = Date.now();
  const claimsSvc = import("@/services/claims");
  const joinsSvc = import("@/services/joins");
  let gid: string;
  let ids: Record<"Maya" | "Dev" | "Sam", string>;
  let code: string;
  let setupDm: { text: string; buttons?: { url: string }[] } | null;
  const accountIds: string[] = [];
  const as = (name: "Maya" | "Dev" | "Sam", extra: [string, unknown][] = []) =>
    new RequestContext<unknown>([["groupId", gid], ["memberId", ids[name]], ["memberName", name], ["role", name === "Maya" ? "admin" : "member"], ["status", "active"], ["source", "chat"], ...extra]);
  const ctxAs = (name: "Maya" | "Dev" | "Sam", source: "chat" | "ui" = "ui"): Ctx => ({ groupId: gid, memberId: ids[name], source });
  const account = async (who: string) => {
    const a = await (await claimsSvc).upsertAccount({ id: `test-join-${ts}-${who}`, email: `${who}-${ts}@example.com`, name: who });
    accountIds.push(a.authUserId);
    return a;
  };
  const row = async (memberId: string) => (await db.select().from(schema.members).where(eq(schema.members.id, memberId)))[0];
  const ip = { ip: `10.0.0.${ts % 250}` };

  before(async () => {
    const { MemoryCounters } = await import("@/lib/window-limit");
    (await joinsSvc).setJoinLimits(new MemoryCounters());
    const people = ["Maya", "Dev", "Sam"].map((name, i) => ({ userExternalId: `1555${String(ts).slice(-6)}${i}@s.whatsapp.net`, name }));
    const joined = await onGroupJoined({ channel: "whatsapp", externalId: `join-${ts}@g.us`, title: `Join test ${ts}` }, people, people[0], { participantCount: 3 });
    gid = joined.group.id;
    ids = Object.fromEntries(joined.members.map((m) => [m.displayName, m.id])) as typeof ids;
    code = joined.group.joinCode!;
    setupDm = joined.setupDm;
  });

  after(async () => {
    (await joinsSvc).setJoinLimits(null);
    if (gid) await deleteGroup(gid);
    for (const id of accountIds) await db.delete(schema.accounts).where(eq(schema.accounts.authUserId, id));
  });

  test("a new Group has a Join code, its head count, and the Admin's setup DM (their Claim link as a button)", async () => {
    const joins = await joinsSvc;
    assert.ok(joins.isJoinCode(code), code);
    assert.equal(await joins.ensureJoinCode(gid), code, "stable until rotated");
    assert.equal(await joins.rosterSize(gid), 3);
    assert.match(setupDm!.text, /You added me to Join test \d+, so you're its admin/);
    assert.match(setupDm!.text, /Answer the setup here or in the group: what's the group for, currency, city\./);
    assert.match(setupDm!.buttons![0].url, /\/claim\//);
    const tokens = await db.select().from(schema.claimTokens).where(eq(schema.claimTokens.memberId, ids.Maya));
    assert.equal(tokens.length, 1);
  });

  test("free: an unclaimed seat connects at once; the same Account again is 'already'; a claimed seat -> Pending wanting it", async () => {
    const joins = await joinsSvc;
    const sam = await account("sam");
    const picker = await joins.pickerFor(code, sam.id);
    assert.deepEqual(picker!.seats.map((s) => s.label).sort(), ["Dev", "Sam"], "the Admin's seat isn't offered");
    assert.equal(picker!.adminsOpen, true);
    assert.deepEqual(await joins.claimSeat(code, sam, ids.Sam, ip), { kind: "connected", groupId: gid, memberName: "Sam" });
    assert.equal((await row(ids.Sam)).accountId, sam.id);
    assert.equal((await joins.claimSeat(code, sam, ids.Dev, ip)).kind, "already", "one seat per Account");
    assert.ok(!(await joins.pickerFor(code, sam.id))!.seats.some((s) => s.id === ids.Sam), "a claimed seat isn't offered");
    const imposter = await account("imposter");
    const r = await joins.claimSeat(code, imposter, ids.Sam, ip);
    assert.equal(r.kind, "pending");
    const [pending] = await db.select().from(schema.members).where(and(eq(schema.members.groupId, gid), eq(schema.members.accountId, imposter.id)));
    assert.deepEqual([pending.status, pending.wantsSeatId, pending.displayName], ["pending", ids.Sam, "imposter"]);
    assert.equal((await row(ids.Sam)).accountId, sam.id, "Sam keeps his seat");
    const asked = (await chatlog.roomieLines(gid, 20)).map((l) => l.text);
    assert.ok(asked.some((t) => /^imposter signed in to the dashboard as Sam\. Maya: approve them\?/.test(t)), asked.join(" | "));
  });

  test("roster full (as many Accounts as people) -> Pending; unknown head count -> Pending; 'not on the list' -> Pending", async () => {
    const joins = await joinsSvc;
    const grab = await account("admin-grab");
    assert.equal((await joins.claimSeat(code, grab, ids.Maya, ip)).kind, "pending", "an Admin seat is never taken from the Join link, even with seats free");
    assert.equal((await row(ids.Maya)).accountId, null);
    const [grabbed] = await db.select().from(schema.members).where(and(eq(schema.members.groupId, gid), eq(schema.members.accountId, grab.id)));
    assert.equal(grabbed.wantsSeatId, null, "it doesn't even ask for the Admin seat");
    const approved = await members.approveMember(ctxAs("Maya", "chat"), { memberId: grabbed.id });
    assert.equal(approved.id, grabbed.id, "approved as a Member of their own, never onto the Admin seat");
    assert.equal((await row(ids.Maya)).accountId, null);
    await assert.rejects(members.approveMember(ctxAs("Maya", "chat"), { memberId: grabbed.id }), /already approved/);
    await db.delete(schema.members).where(and(eq(schema.members.groupId, gid), eq(schema.members.accountId, grab.id)));
    await joins.setParticipantCount("whatsapp", `join-${ts}@g.us`, 1);
    const dev1 = await account("dev1");
    assert.equal((await joins.claimSeat(code, dev1, ids.Dev, ip)).kind, "pending", "1 person, 1 Account already");
    assert.equal((await row(ids.Dev)).accountId, null);
    await joins.setParticipantCount("whatsapp", `join-${ts}@g.us`, null);
    const maya = await account("maya-unknown");
    assert.equal((await joins.claimSeat(code, maya, ids.Maya, ip)).kind, "pending", "can't count: approve every join");
    await joins.setParticipantCount("whatsapp", `join-${ts}@g.us`, 3);
    const stranger = await account("stranger");
    const r = await joins.claimSeat(code, stranger, null, ip);
    assert.deepEqual([r.kind, r.memberName], ["pending", "stranger"]);
  });

  test("approve_all: every pick waits; only an Admin sets the policy (service and set_join_policy)", async () => {
    const joins = await joinsSvc;
    await assert.rejects(joins.setJoinPolicy(ctxAs("Dev"), { policy: "approve_all" }), /Only an admin/);
    assert.equal((await run("set_join_policy", { policy: "approve_all" }, as("Dev"))).reason, "admin-only");
    assert.deepEqual(await run("set_join_policy", { policy: "approve_all" }, as("Maya")), { policy: "approve_all", now: "An Admin approves every join" });
    const dev2 = await account("dev2");
    assert.equal((await joins.claimSeat(code, dev2, ids.Dev, ip)).kind, "pending");
    await joins.setJoinPolicy(ctxAs("Maya"), { policy: "free" });
  });

  test("approve moves a Pending sign-in onto the seat it asked for; revoke and reassign are Admin-only", async () => {
    const joins = await joinsSvc;
    const imposter = (await db.select().from(schema.members).where(and(eq(schema.members.groupId, gid), eq(schema.members.displayName, "imposter"))))[0];
    const sam = (await row(ids.Sam)).accountId;
    await assert.rejects(joins.revokeSeat(ctxAs("Dev"), { memberId: ids.Sam }), /Only an admin/);
    await assert.rejects(joins.revokeSeat(ctxAs("Maya"), { memberId: ids.Maya }), /yourself|Nobody/);
    assert.equal((await run("revoke_seat", { name: "Sam" }, as("Dev"))).reason, "admin-only");
    const revoked = await run("revoke_seat", { name: "Sam" }, as("Maya"));
    assert.equal(revoked.disconnected, "Sam");
    assert.equal((await row(ids.Sam)).accountId, null, "the Member stays, the seat is open");
    const samAccount = { id: sam!, name: "sam", email: `sam-${ts}@example.com` };
    assert.equal((await joins.claimSeat(code, samAccount, ids.Sam, ip)).kind, "already", "the disconnected Account waits (Pending), it can't just pick the seat again");
    const [waiting] = await db.select().from(schema.members).where(and(eq(schema.members.groupId, gid), eq(schema.members.accountId, sam!)));
    assert.equal(waiting.status, "pending");
    // "roomie approve imposter": the Pending row goes, its Account is on Sam's seat now.
    assert.deepEqual(await run("approve_member", { name: "imposter" }, as("Maya")), { approved: "Sam" });
    assert.equal((await row(ids.Sam)).accountId, imposter.accountId);
    assert.equal((await row(imposter.id)).status, "removed");
    // Reassign: the Account on Sam's seat moves to Dev's; Sam's seat is open again.
    await assert.rejects(joins.reassignSeat(ctxAs("Dev"), { fromMemberId: ids.Sam, toMemberId: ids.Dev }), /Only an admin/);
    await joins.reassignSeat(ctxAs("Maya"), { fromMemberId: ids.Sam, toMemberId: ids.Dev });
    assert.equal((await row(ids.Dev)).accountId, imposter.accountId);
    assert.equal((await row(ids.Sam)).accountId, null);
    // A Pending sign-in can be moved straight onto an open seat (that approves it).
    const dev1 = (await db.select().from(schema.members).where(and(eq(schema.members.groupId, gid), eq(schema.members.displayName, "dev1"))))[0];
    await joins.reassignSeat(ctxAs("Maya"), { fromMemberId: dev1.id, toMemberId: ids.Sam });
    assert.equal((await row(ids.Sam)).accountId, dev1.accountId);
    assert.equal((await row(dev1.id)).status, "removed");
    await assert.rejects(joins.reassignSeat(ctxAs("Maya"), { fromMemberId: ids.Sam, toMemberId: ids.Dev }), /already connected/);
    assert.ok(sam, "Sam had been connected before the revoke");
    const states = await joins.seatStates({ groupId: gid });
    assert.equal(states.get(ids.Sam)?.state, "connected");
    assert.equal(states.get(ids.Maya)?.state, "open");
  });

  test("declined is final for that Account; rotate kills the old code (rotate_join_link, Admin only)", async () => {
    const joins = await joinsSvc;
    const { MemoryCounters } = await import("@/lib/window-limit");
    joins.setJoinLimits(new MemoryCounters()); // the tests above used this IP's 10 picks
    const stranger = (await db.select().from(schema.members).where(and(eq(schema.members.groupId, gid), eq(schema.members.displayName, "stranger"))))[0];
    await members.declineMember(ctxAs("Maya"), { memberId: stranger.id });
    const strangerAccount = { id: stranger.accountId!, name: "stranger", email: `stranger-${ts}@example.com` };
    await assert.rejects(joins.claimSeat(code, strangerAccount, ids.Maya, ip), (e: unknown) => e instanceof joins.JoinError && e.code === "declined");
    assert.equal((await run("rotate_join_link", {}, as("Dev"))).reason, "admin-only");
    const rotated = await run("rotate_join_link", {}, as("Maya"));
    assert.match(rotated.say, /^New Join link: .*\/j\/[a-z2-7]{10}\. The old one doesn't work anymore\.$/);
    assert.equal(await joins.groupByCode(code), undefined, "the old code opens nothing");
    await assert.rejects(joins.claimSeat(code, strangerAccount, ids.Maya, ip), (e: unknown) => e instanceof joins.JoinError && e.code === "missing");
    code = (await joins.ensureJoinCode(gid))!;
    assert.ok((await joins.groupByCode(code))?.id === gid);
  });

  test("get_dashboard_link for everyone: the Join link line, never a Claim link", async () => {
    const r = await run("get_dashboard_link", { forEveryone: true }, as("Dev"));
    assert.equal(r.kind, "join");
    assert.match(r.say, new RegExp(`^Everyone: your dashboard is at .*/j/${code}\\. Sign in with Google and pick your name\\.$`));
    assert.ok(!/claim/.test(JSON.stringify(r)));
    assert.equal(r.links, undefined);
  });

  test("setup answered in a DM: the learned line and the Join link go to the group chat too", async () => {
    const s = await run("set_group_settings", { purpose: "friends", currency: "USD" }, as("Maya", [["isPrivate", true]]));
    assert.equal(s.postedInGroup, true);
    assert.match(s.say, /^Learned Money\.\nEveryone: your dashboard is at .*\/j\//);
    const lines = (await chatlog.roomieLines(gid, 20)).map((l) => l.text);
    assert.ok(lines.includes(s.say), "posted (and logged) in the group");
  });

  test("rate limit: 10 picks an hour per IP, then refused", async () => {
    const joins = await joinsSvc;
    const { MemoryCounters } = await import("@/lib/window-limit");
    joins.setJoinLimits(new MemoryCounters());
    const bogus = { id: "00000000-0000-4000-8000-000000000000", name: "x", email: "x@example.com" };
    const fakeSeat = "00000000-0000-4000-8000-000000000001";
    for (let i = 0; i < 10; i++) await assert.rejects(joins.claimSeat(code, { ...bogus, id: `00000000-0000-4000-8000-0000000000${10 + i}` }, fakeSeat, { ip: "203.0.113.9" }), (e: unknown) => e instanceof joins.JoinError && e.code === "seat");
    await assert.rejects(joins.claimSeat(code, bogus, fakeSeat, { ip: "203.0.113.9" }), (e: unknown) => e instanceof joins.JoinError && e.code === "rate_limited");
    joins.setJoinLimits(new MemoryCounters());
    for (let i = 0; i < 10; i++) await assert.rejects(joins.claimSeat(code, bogus, fakeSeat, { ip: `198.51.100.${i}` }), (e: unknown) => e instanceof joins.JoinError && e.code === "seat");
    await assert.rejects(joins.claimSeat(code, bogus, fakeSeat, { ip: "198.51.100.99" }), (e: unknown) => e instanceof joins.JoinError && e.code === "rate_limited", "per Account too");
  });
});

describe("polls and nudges (#24B)", () => {
  let pgid: string;
  let people: Record<string, string>;
  const posted: DevOutput[] = [];
  const rc = (name: string) => new RequestContext<unknown>([["groupId", pgid], ["memberId", people[name]], ["memberName", name], ["role", name === "Maya" ? "admin" : "member"], ["status", "active"], ["source", "chat"]]);

  before(async () => {
    registerChannel(new DevChannel((o) => posted.push(o)));
    const stamp = Date.now();
    const list = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`polls-${name}-${stamp}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `polls-${stamp}`, title: `Polls ${stamp}` }, list, list[0]);
    pgid = joined.group.id;
    people = Object.fromEntries(joined.members.map((m) => [m.displayName, m.id]));
  });
  after(async () => {
    if (pgid) await deleteGroup(pgid);
  });

  test("ask_poll: a who's-in poll about $60 pizza goes to the chat and nothing is logged", async () => {
    const r = await run("ask_poll", { question: "Who's in on the $60 pizza?", options: ["I'm in", "Not me"], multi: false, about: { amount: 60, description: "pizza", category: "food" } }, rc("Maya"));
    assert.equal(r.asked, true);
    assert.equal(r.answerWith, "a number", "dev-chat has no native polls");
    assert.match(posted.at(-1)?.msg.text ?? "", /^\(poll \d+\) Who's in on the \$60 pizza\?\n1\. I'm in\n2\. Not me/);
    const [p] = await db.select().from(schema.polls).where(eq(schema.polls.groupId, pgid));
    assert.deepEqual(p.about, { kind: "who-in", payerId: people.Maya, cents: 6000, description: "pizza", category: "food" });
    assert.equal((await money.listExpenses({ groupId: pgid })).length, 0);
    await assert.rejects(run("ask_poll", { question: "Which?", options: ["a", "b", "c", "d", "e"], multi: false } as never, rc("Maya")));
  });

  test("set_nudges: off, then on again", async () => {
    assert.equal((await run("set_nudges", { on: false }, rc("Sam"))).nudges, "off");
    assert.equal(await members.nudgesOff(people.Sam), true);
    assert.equal((await run("set_nudges", { on: true }, rc("Sam"))).nudges, "on");
    assert.equal(await members.nudgesOff(people.Sam), false);
  });
});

describe("Lease Inbox tools (#27, FakeMail)", () => {
  let lgid: string;
  let people: Record<string, string>;
  let inboxId: string;
  const mail = new FakeMail();
  const rc = (name: string, latest?: string) =>
    new RequestContext<unknown>([["groupId", lgid], ["memberId", people[name]], ["memberName", name], ["role", name === "Maya" ? "admin" : "member"], ["status", "active"], ["source", "chat"], ...(latest ? [["latest", latest] as [string, unknown]] : [])]);

  before(async () => {
    setMailClient(mail);
    leaseInbox.setClassifier({ classify: async (i) => (i.workOrderTitle ? { class: "work-order", reply: "acknowledged", summary: "they'll send someone" } : { class: "other", summary: i.subject }) });
    const stamp = Date.now();
    const list = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`lease-${name}-${stamp}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `lease-${stamp}`, title: `Lease ${stamp}` }, list, list[0]);
    lgid = joined.group.id;
    people = Object.fromEntries(joined.members.map((m) => [m.displayName, m.id]));
    inboxId = (await leaseInbox.ensureInbox({ groupId: lgid, memberId: people.Maya, source: "chat" })).inboxId;
  });
  after(async () => {
    if (lgid) await deleteGroup(lgid);
    setMailClient(null);
    leaseInbox.setClassifier(null);
  });

  test("inbox_status: the address and the three ways to connect", async () => {
    const r = await run("inbox_status", {}, rc("Dev"));
    assert.match(r.line, /Our email address is lease-\d+-[a-z0-9]{4}@agentmail\.to\. To connect the landlord/);
    assert.match(r.line, /I don't know the landlord yet/);
  });

  test("trust_sender: the Admin's yes trusts the sender Roomie asked about", async () => {
    const m = mail.receive(inboxId, { from: "Brookfield Residential Leasing <leasing@brookfieldresidential.com>", subject: "Welcome to Brookfield", text: "Hello residents." });
    await processInbound(lgid, m);
    const r = await run("trust_sender", {}, rc("Maya", "yes"));
    assert.deepEqual(r.trusted, ["leasing@brookfieldresidential.com", "brookfieldresidential.com"]);
    const no = await run("trust_sender", { sender: "spam.example" }, rc("Dev", "yes"));
    assert.equal(no.notAllowed, true, "Admins only");
  });

  test("report_issue sends at once; work_order_status answers; send_to_landlord replies in the thread", async () => {
    const r = await run("report_issue", { what: "the leaking kitchen sink" }, rc("Dev", "roomie the sink's leaking, tell them"));
    assert.deepEqual(r, { sent: true, say: "Sent: reported the leaking kitchen sink." });
    assert.match(mail.sent.at(-1)!.text, /at Dev's request\./);
    const s = await run("work_order_status", { what: "sink" }, rc("Sam"));
    assert.match(s.line, /^the leaking kitchen sink: sent, no answer yet/);
    const reply = mail.receive(inboxId, { from: "leasing@brookfieldresidential.com", subject: "Re: Work order: the leaking kitchen sink", text: "We'll send someone.", threadId: mail.sent.at(-1)!.threadId });
    await processInbound(lgid, reply);
    const t = await run("send_to_landlord", { intent: "reply", about: "the sink", body: "Thanks, someone is home after 4.", summary: "told them someone's home after 4" }, rc("Sam", "roomie tell them someone's home after 4"));
    assert.equal(t.sent, true);
    assert.equal(mail.sent.at(-1)!.threadId, reply.threadId);
  });

  test("send_to_landlord: not renewing asks first; asking again without a yes still asks; the Member's own yes sends", async () => {
    const before = mail.sent.length;
    const input = { intent: "new" as const, body: "We will not be renewing our lease.", summary: "told them we're not renewing" };
    const ask = await run("send_to_landlord", input, rc("Sam", "roomie tell them we're not renewing"));
    assert.equal(ask.sent, false);
    assert.ok(ask.ask.length >= 1);
    const sneaky = await run("send_to_landlord", { ...input, confirmed: true } as typeof input, rc("Sam", "roomie tell them we're not renewing"));
    assert.equal(sneaky.sent, false, "the model's confirmed is ignored: no yes from Sam");
    assert.equal(mail.sent.length, before);
    const yes = await run("send_to_landlord", input, rc("Sam", "yes send it"));
    assert.equal(yes.sent, true);
  });

  test("send_intro: once per landlord", async () => {
    const r = await run("send_intro", {}, rc("Maya", "roomie send the intro"));
    assert.equal(r.sent, true);
    assert.match(mail.sent.at(-1)!.text, /Maya, Dev and Sam/);
    assert.equal((await run("send_intro", {}, rc("Maya", "roomie send the intro"))).sent, false);
  });

  test("ask_lease: no lease filed yet names the address", async () => {
    const r = await run("ask_lease", { question: "what's the notice period?" }, rc("Dev"));
    assert.equal(r.found, false);
    assert.match(r.line, /^No lease filed yet\. Forward the lease PDF to lease-\d+-[a-z0-9]{4}@agentmail\.to/);
  });

  test("notice_status: a filed water shut-off that ended an hour ago -> Yep, since ...; nothing about the pool", async () => {
    const [g] = await db.select({ tz: schema.groups.timezone }).from(schema.groups).where(eq(schema.groups.id, lgid));
    const wall = (d: Date) => {
      const p = zonedParts(g.tz, d);
      return `${dayInZone(g.tz, d)}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
    };
    const now = Date.now();
    const start = wall(new Date(now - 3 * 3_600_000));
    const end = wall(new Date(now - 3_600_000));
    leaseInbox.setClassifier({ classify: async (i) => ({ class: "notice", date: start, start, end, what: "water", off: true, summary: i.subject }) });
    try {
      await processInbound(lgid, mail.receive(inboxId, { from: "Brookfield Residential Leasing <leasing@brookfieldresidential.com>", subject: "water's off today", text: "NOTICE TO ALL RESIDENTS: water will be shut off." }));
    } finally {
      leaseInbox.setClassifier({ classify: async (i) => (i.workOrderTitle ? { class: "work-order", reply: "acknowledged", summary: "they'll send someone" } : { class: "other", summary: i.subject }) });
    }
    const r = await run("notice_status", { about: "water" }, rc("Sam", "is the water back on?"));
    assert.equal(r.found, true);
    assert.equal(r.state, "after");
    assert.match(r.line, /^Yep, since /);
    const none = await run("notice_status", { about: "the pool" }, rc("Sam"));
    assert.deepEqual([none.found, none.line], [false, "I haven't seen a notice about the pool."]);
  });

  test("release_inbox: Admins only; the address goes", async () => {
    assert.equal((await run("release_inbox", {}, rc("Dev", "release the inbox"))).notAllowed, true);
    const r = await run("release_inbox", {}, rc("Maya", "roomie release the inbox"));
    assert.equal(r.released, true);
    assert.equal(mail.inboxes.size, 0);
  });
});

// The chore nudges (#60) and the rhythm offer (#61), in their own throwaway Group (Maya the Admin, Dev, Sam) so the
// chart is exactly what's seeded here. Days are the Group's real local today in Chicago.
describe("House: chore nudges and the learned rhythm", () => {
  const CHI = "America/Chicago";
  const sent: DevOutput[] = [];
  let gid: string;
  let ids: Record<"Maya" | "Dev" | "Sam", string>;
  let trashId: string;
  const todayParts = zonedParts(CHI, new Date());
  const local = (hour: number, minute = 0, dayOffset = 0) =>
    zonedTimeToUtc(CHI, { year: todayParts.year, month: todayParts.month, day: todayParts.day + dayOffset, hour, minute });
  const as = (name: keyof typeof ids): Ctx => ({ groupId: gid, memberId: ids[name], source: "chat" });

  before(async () => {
    registerChannel(new DevChannel((o) => sent.push(o)));
    const ts = Date.now();
    const people = (["Maya", "Dev", "Sam"] as const).map((name) => ({ userExternalId: devUserId(`nudge-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `test-nudge-${ts}`, title: `Nudge Group ${ts}` }, [...people], people[0]);
    gid = joined.group.id;
    await db.update(schema.groups).set({ timezone: CHI }).where(eq(schema.groups.id, gid));
    ids = Object.fromEntries(joined.members.map((m) => [m.displayName, m.id])) as typeof ids;
    await db.delete(schema.chores).where(eq(schema.chores.groupId, gid));
    const trash = await chores.addChore(as("Maya"), { name: "Take out the trash", everyDays: 3, rotation: [ids.Maya, ids.Sam, ids.Dev] });
    trashId = trash.choreId;
    // Every 3 days at 7 PM: Sam, Dev, Maya; so it's Sam's, due today.
    await db.insert(schema.choreLogs).values([
      { choreId: trashId, memberId: ids.Sam, doneAt: local(19, 0, -9) },
      { choreId: trashId, memberId: ids.Dev, doneAt: local(19, 10, -6) },
      { choreId: trashId, memberId: ids.Maya, doneAt: local(19, 20, -3) },
    ]);
    await chores.addChore(as("Maya"), { name: "Mop the floor", everyDays: 7 });
  });

  after(async () => {
    if (gid) await deleteGroup(gid);
  });

  test("the Bundle leaves out what Sam hears privately; a never-done chore stays on the group line", async () => {
    const line = await house.houseBundleLine({ groupId: gid }, local(9, 5));
    assert.match(line ?? "", /mop the floor/);
    assert.doesNotMatch(line ?? "", /trash/i);
    await members.setNudges(as("Sam"), { on: false });
    assert.match((await house.houseBundleLine({ groupId: gid }, local(9, 6))) ?? "", /take out the trash \(Sam\)/, "nudges off: back on the group line");
    await members.setNudges(as("Sam"), { on: true });
  });

  test("choreDmJob: Sam, privately, once the usual hour (7 PM) comes; once a day", async () => {
    sent.length = 0;
    assert.deepEqual(await house.choreDmJob({ groupId: gid }, local(10)), [], "before the usual hour");
    const r = await house.choreDmJob({ groupId: gid }, local(19, 5));
    assert.deepEqual(r.map((o) => [o.memberId, o.outcome]), [[ids.Sam, "sent"]]);
    assert.deepEqual(sent.map((o) => [o.to, o.msg.text]), [["private", "Hey Sam! Trash is yours today."]]);
    assert.deepEqual(await house.choreDmJob({ groupId: gid }, local(20, 30)), [], "claimed for the day");
    const claims = await db.select().from(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, gid), eq(schema.scheduledPosts.kind, "chore.dm")));
    assert.deepEqual(claims.map((c) => c.period), [`${dayInZone(CHI, local(12))}:${trashId}:${ids.Sam}`]);
  });

  test("log_chore after the nudge says nudged (the cheer: 'Sam's on a roll.'); the next done doesn't", async () => {
    const first = await chores.logChore(as("Sam"), { chore: "trash" });
    assert.equal(first.nudged, true);
    assert.equal((await chores.logChore(as("Sam"), { chore: "trash" })).nudged, false);
  });

  test("the rhythm offer: in the report's hour, once per chore per 30 days; chore_update takes the yes", async () => {
    await chores.updateChore(as("Maya"), { choreId: trashId, everyDays: 7 });
    await schedule.updateSchedule(as("Maya"), { reportWeekday: todayParts.weekday, reportHour: 18 });
    assert.deepEqual(await house.rhythmOfferParts({ groupId: gid }, local(12)), [], "outside the report's hour");
    const parts = await house.rhythmOfferParts({ groupId: gid }, local(18, 10));
    assert.deepEqual(parts.map((p) => p.text), ["Trash actually goes out every 3 days. Want me to change it?"]);
    assert.deepEqual(await house.rhythmOfferParts({ groupId: gid }, local(18, 20)), [], "offered already");
    const r = await chores.updateChore(as("Dev"), { chore: "trash", everyDays: 3 });
    assert.equal(r.everyDays, 3);
    assert.deepEqual(await chores.rhythmMismatches({ groupId: gid }), []);
  });
});

describe("coverage", () => {
  test("every tool in the registry was exercised", () => {
    const all = Object.keys(tools).sort();
    const missing = all.filter((id) => !covered.has(id));
    assert.deepEqual(missing, [], `tools without a test: ${missing.join(", ")}`);
    for (const id of all) assert.equal((tools as unknown as Record<string, AnyTool>)[id].id, id, `key ${id} must equal its tool id`);
  });
});

after(async () => {
  await db.$client.end();
});
