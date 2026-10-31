// Rent, utilities and the Settle nudge (#25) against the Neon dev branch, in throwaway Groups (Apt 4B's people: Maya
// pays the landlord, Dev and Sam). DMs are captured with an injected deliver, so no Channel is needed. Times are local
// to America/Chicago (the Groups' zone). Run: npx tsx --test src/services/money-rent.dbtest.ts
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Outgoing } from "@/channels/types";
import { devUserId } from "@/channels/dev";
import { zonedTimeToUtc } from "@/lib/time";
import { onGroupJoined } from "@/onboarding";
import { groupBundle } from "./bundle";
import { deleteGroup } from "./groups";
import { setPaymentHandles } from "./members";
import { getExpense, logExpense, settleUp } from "./money";
import { answerAmount, prefillAmount, runRecurring, setVariableExpense } from "./recurring";
import { getRent, rentBundleLine, rentDmJob, rentStatus, setRent } from "./rent";
import { groupReport } from "./report";
import { getNudgeSettings, settleNudgeJob, updateNudgeSettings } from "./settle-nudge";
import type { Ctx } from "./types";
import { NotAllowedError } from "./authz";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

const TZ = "America/Chicago";
const local = (month: number, day: number, hour: number, minute = 0) => zonedTimeToUtc(TZ, { year: 2026, month, day, hour, minute });

type Sent = { memberId: string; out: Outgoing };
const inbox = () => {
  const sent: Sent[] = [];
  return { sent, deliver: async (memberId: string, out: Outgoing) => void sent.push({ memberId, out }) };
};

async function apt(tag: string) {
  const stamp = `${tag}-${Date.now()}`;
  const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`rent-${name}-${stamp}`), name }));
  const joined = await onGroupJoined({ channel: "dev", externalId: `rent-${stamp}`, title: `Rent test ${stamp}` }, people, people[0]);
  const id = Object.fromEntries(joined.members.map((m) => [m.displayName, m.id])) as Record<"Maya" | "Dev" | "Sam", string>;
  const as = (name: keyof typeof id): Ctx => ({ groupId: joined.group.id, memberId: id[name], source: "chat" });
  return { groupId: joined.group.id, id, as };
}

let A: Awaited<ReturnType<typeof apt>>;
let B: Awaited<ReturnType<typeof apt>>;

describe("rent, utilities and the Settle nudge against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "money-rent dbtest");
    A = await apt("a");
    B = await apt("b");
    await setPaymentHandles(A.as("Maya"), { venmo: "maya-k" });
    await setPaymentHandles(B.as("Maya"), { venmo: "maya-k" });
  });

  after(async () => {
    for (const g of [A, B]) if (g) await deleteGroup(g.groupId);
    for (const g of [A, B]) if (g) assert.equal((await db.select().from(schema.pendingAmounts).where(eq(schema.pendingAmounts.groupId, g.groupId))).length, 0, "pending_amounts go with the Group");
  });

  // ---------- rent ----------

  test("setting the rent gives one recurring parent with exact splits, first due the 1st", async () => {
    const { id, as } = A;
    const rent = await setRent(as("Maya"), { cents: 240000, dueDay: 1, method: "exact", splits: [{ memberId: id.Maya, cents: 100000 }, { memberId: id.Dev, cents: 80000 }, { memberId: id.Sam, cents: 60000 }] }, local(10, 29, 8));
    assert.equal(rent.startsOn, "2026-11-01");
    assert.equal(rent.payerName, "Maya");
    assert.deepEqual(rent.shares.map((s) => [s.name, s.cents]), [["Maya", 100000], ["Dev", 80000], ["Sam", 60000]]);
    const parents = await db
      .select()
      .from(schema.expenses)
      .where(and(eq(schema.expenses.groupId, A.groupId), eq(schema.expenses.category, "rent"), isNull(schema.expenses.recurringParentId)));
    assert.equal(parents.length, 1);
    assert.equal(parents[0].recurring, "monthly");
    assert.equal(parents[0].splitMethod, "exact");
  });

  test("only Maya (the Payer) or an Admin changes it", async () => {
    await assert.rejects(setRent(A.as("Sam"), { cents: 250000 }, local(10, 29, 8)), (e) => e instanceof NotAllowedError && /Maya \(who pays the landlord\)/.test(e.message));
  });

  test("day -3: the Bundle's line and two DMs (Dev $800, Sam $600, never Maya), once", async () => {
    const box = inbox();
    assert.equal(await rentDmJob(A, local(10, 29, 8, 30), box.deliver), 0, "outside the Bundle's hour");
    assert.equal(await rentDmJob(A, local(10, 29, 9, 5), box.deliver), 2);
    assert.equal(await rentDmJob(A, local(10, 29, 9, 30), box.deliver), 0, "once a month");
    assert.deepEqual(box.sent.map((s) => s.memberId).sort(), [A.id.Dev, A.id.Sam].sort());
    const dev = box.sent.find((s) => s.memberId === A.id.Dev)!.out;
    const sam = box.sent.find((s) => s.memberId === A.id.Sam)!.out;
    assert.match(dev.text, /your share is \$800\b/);
    assert.match(sam.text, /your share is \$600\b/);
    assert.ok(!dev.text.includes("$600") && !sam.text.includes("$800"));
    assert.deepEqual(dev.buttons, [{ text: "Pay Maya on Venmo", url: "https://venmo.com/u/maya-k?txn=pay&amount=800.00&note=Rent" }]);

    const line = "🏠 Rent $2,400 is due Sunday. Maya pays the landlord.";
    assert.equal(await rentBundleLine(A, local(10, 29, 9, 5)), line);
    assert.ok((await groupBundle(A, local(10, 29, 9, 5)))?.includes(line), "Money's line is in the Bundle");
    assert.equal(await rentBundleLine(A, local(10, 30, 9)), null, "nothing on the days between");
  });

  test("the due day with Dev settled: only Sam is named", async () => {
    await settleUp(A.as("Dev"), { toId: A.id.Maya, cents: 80000 });
    assert.equal(await rentBundleLine(A, local(11, 1, 9, 5)), "🏠 Rent is due today. Maya's still waiting on Sam.");
    assert.equal(await rentBundleLine(A, local(11, 2, 9)), null, "nothing after the due day");
  });

  test("rent_status: the rent, no offer; a change once charged starts a new parent next month", async () => {
    const s = await rentStatus(A, local(10, 29, 9));
    assert.equal(s.offer, false);
    assert.equal(s.rent?.amount, "$2,400");
    const old = (await getRent(A))!;
    const next = await setRent(A.as("Maya"), { cents: 250000, splits: [{ memberId: A.id.Maya, cents: 100000 }, { memberId: A.id.Dev, cents: 85000 }, { memberId: A.id.Sam, cents: 65000 }] }, local(11, 15, 12));
    assert.equal(next.startsOn, "2026-12-01");
    assert.equal(next.cents, 250000);
    assert.notEqual(next.expenseId, old.expenseId);
    const before = await getExpense(A, old.expenseId);
    assert.equal(before?.recurring, null, "the old parent stops repeating");
    assert.equal(before?.cents, 240000, "November keeps what it was");
  });

  // ---------- utilities ----------

  test("a variable electric bill: asked on its due day, once more the next day, then quiet; one row", async () => {
    const box = inbox();
    const parent = await setVariableExpense(A.as("Dev"), { description: "Electric", dueDay: 20 });
    assert.equal(parent.variable, true);
    assert.equal(parent.occurredOn, "2026-11-20");
    await runRecurring(local(11, 19, 10), { deliver: box.deliver, groupId: A.groupId });
    assert.equal(box.sent.length, 0, "not due yet");
    await runRecurring(local(11, 20, 10), { deliver: box.deliver, groupId: A.groupId });
    await runRecurring(local(11, 20, 15), { deliver: box.deliver, groupId: A.groupId });
    assert.deepEqual(box.sent, [{ memberId: A.id.Dev, out: { text: "How much was the electric bill?" } }]);
    const rows = await db.select().from(schema.pendingAmounts).where(eq(schema.pendingAmounts.expenseId, parent.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].period, "2026-11");
    await runRecurring(local(11, 21, 10), { deliver: box.deliver, groupId: A.groupId });
    await runRecurring(local(11, 22, 10), { deliver: box.deliver, groupId: A.groupId });
    assert.equal(box.sent.length, 2, "one re-ask, then nothing until next month");
    assert.equal((await db.select().from(schema.pendingAmounts).where(eq(schema.pendingAmounts.expenseId, parent.id)))[0].asks, 2);
    const copies = await db.select().from(schema.expenses).where(eq(schema.expenses.recurringParentId, parent.id));
    assert.equal(copies.length, 0, "a variable parent is never copied");
  });

  test("answerAmount(92) logs $92 split like the parent; a second answer is refused; Sam can't answer", async () => {
    await assert.rejects(answerAmount(A.as("Sam"), { cents: 9200 }), NotAllowedError);
    const { expense, parent } = await answerAmount(A.as("Dev"), { cents: 9200 });
    assert.equal(expense.cents, 9200);
    assert.equal(expense.occurredOn, "2026-11-20");
    assert.equal(expense.recurringParentId, parent.id);
    assert.equal(expense.payers?.[0].memberId, A.id.Dev);
    assert.deepEqual(expense.splits?.map((s) => s.memberId).sort(), parent.splits?.map((s) => s.memberId).sort());
    assert.equal(expense.splits?.reduce((t, s) => t + s.cents, 0), 9200);
    await assert.rejects(answerAmount(A.as("Dev"), { cents: 9200 }), /already logged \(\$92\.00\)/);
  });

  test("prefillAmount: the bill's amount for the next month, and the ask only confirms it", async () => {
    assert.equal(await prefillAmount(A.groupId, "water", 5000), null, "no water bill");
    const hit = await prefillAmount(A.groupId, "ComEd electric bill", 9500);
    assert.equal(hit?.description, "Electric");
    const box = inbox();
    await runRecurring(local(12, 20, 10), { deliver: box.deliver, groupId: A.groupId });
    assert.deepEqual(box.sent.map((s) => s.out.text), ["How much was the electric bill? Looks like $95 (from the bill). Right?"]);
  });

  // ---------- the Settle nudge ----------

  test("the Settle nudge DMs the right people once a week and skips the opted-out Member", async () => {
    const { id, as } = B;
    await logExpense(as("Maya"), { cents: 9000, description: "groceries", category: "groceries", occurredOn: "2026-10-30" });
    await logExpense(as("Dev"), { cents: 1500, description: "pizza", category: "food", occurredOn: "2026-11-13", splitAmong: [id.Dev, id.Sam] });
    await db.insert(schema.memberNotes).values({ memberId: id.Sam, note: { nudges: "off" } }).onConflictDoNothing();
    assert.deepEqual(await getNudgeSettings(B), { thresholdCents: 2000, thresholdDays: 7, enabled: true });

    const box = inbox();
    const sunday = local(11, 15, 18, 10); // the report's default day and hour
    assert.equal(await settleNudgeJob(B, local(11, 15, 17, 10), box.deliver), 0, "outside the report's hour");
    assert.equal(await settleNudgeJob(B, sunday, box.deliver), 1);
    assert.equal(await settleNudgeJob(B, local(11, 15, 18, 40), box.deliver), 0, "once a week");
    assert.deepEqual(box.sent.map((s) => s.memberId), [id.Dev], "Sam opted out; Sam's $7.50 to Dev is under the line");
    assert.equal(box.sent[0].out.text, `Quick one: you owe Maya $30.00. Tap to pay, then say "paid" here.`);
    assert.deepEqual(box.sent[0].out.buttons, [{ text: "Pay Maya on Venmo", url: "https://venmo.com/u/maya-k?txn=pay&amount=30.00" }]);

    const report = await groupReport(B, local(11, 15, 18, 45));
    const money = report.parts.map((p) => p.text);
    assert.ok(money.includes("2 open balances; I've DM'd everyone."), money.join(" | "));
    assert.ok(!money.some((t) => /Dev|Sam|\$30/.test(t) && /owe|pays/.test(t)), "no names or amounts");
    assert.ok(money.some((t) => /keep track of rent/.test(t)), "the rent offer, once");
    assert.ok(!(await groupReport(B, local(11, 15, 18, 50))).parts.some((p) => /keep track of rent/.test(p.text)), "not twice");
    assert.equal((await rentStatus(B)).offer, false, "already offered");
  });

  test("nudge settings: Admin only; off means no DMs and a plain count", async () => {
    await assert.rejects(updateNudgeSettings(B.as("Dev"), { enabled: false }), NotAllowedError);
    assert.deepEqual(await updateNudgeSettings(B.as("Maya"), { enabled: false, thresholdCents: 1000 }), { thresholdCents: 1000, thresholdDays: 7, enabled: false });
    const box = inbox();
    assert.equal(await settleNudgeJob(B, local(11, 22, 18, 10), box.deliver), 0);
    assert.ok((await groupReport(B, local(11, 22, 18, 15))).parts.some((p) => p.text === "2 open balances."));
  });
});
