// Rent, utilities and the Settle nudge (#25) against the Neon dev branch, in throwaway Groups (Apt 4B's people: Maya
// pays the landlord, Dev and Sam). DMs go the real way (core's sendNudge: quiet hours, "stop nudging me", paused
// Groups) into a capturing dev Channel. Times are local to America/Chicago (the Groups' zone). Run: npx tsx --test src/services/money-rent.dbtest.ts
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { registerChannel } from "@/channels";
import type { Outgoing } from "@/channels/types";
import { DevChannel, devUserId } from "@/channels/dev";
import { zonedTimeToUtc } from "@/lib/time";
import { onGroupJoined } from "@/onboarding";
import { groupBundle } from "./bundle";
import { deleteGroup } from "./groups";
import { setPaymentHandles } from "./members";
import { getExpense, logExpense, settleUp } from "./money";
import { answerAmount, prefillAmount, runRecurring, setVariableExpense } from "./recurring";
import { getRent, rentBundleLine, rentDmJob, rentStatus, setRent, type DmOutcome } from "./rent";
import { groupReport } from "./report";
import { getNudgeSettings, settleNudgeJob, updateNudgeSettings } from "./settle-nudge";
import { updateSchedule } from "./schedule";
import type { Ctx } from "./types";
import { NotAllowedError } from "./authz";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

const TZ = "America/Chicago";
const local = (month: number, day: number, hour: number, minute = 0) => zonedTimeToUtc(TZ, { year: 2026, month, day, hour, minute });

// Every private message the dev Channel was asked to send, by Member.
const memberOf = new Map<string, string>();
const sent: { memberId: string; out: Outgoing }[] = [];
const inbox = () => sent.splice(0);
const outcomes = (r: DmOutcome[]) => r.map((x) => `${x.memberId}:${x.outcome}`).sort();
const setNudges = (memberId: string, nudges: "on" | "off") =>
  db.insert(schema.memberNotes).values({ memberId, note: { nudges } }).onConflictDoUpdate({ target: schema.memberNotes.memberId, set: { note: { nudges } } });

async function apt(tag: string) {
  const stamp = `${tag}-${Date.now()}`;
  const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`rent-${name}-${stamp}`), name }));
  const joined = await onGroupJoined({ channel: "dev", externalId: `rent-${stamp}`, title: `Rent test ${stamp}` }, people, people[0]);
  const id = Object.fromEntries(joined.members.map((m) => [m.displayName, m.id])) as Record<"Maya" | "Dev" | "Sam", string>;
  for (const p of people) memberOf.set(p.userExternalId, id[p.name as keyof typeof id]);
  const as = (name: keyof typeof id): Ctx => ({ groupId: joined.group.id, memberId: id[name], source: "chat" });
  return { groupId: joined.group.id, id, as };
}

let A: Awaited<ReturnType<typeof apt>>;
let B: Awaited<ReturnType<typeof apt>>;
let C: Awaited<ReturnType<typeof apt>> | undefined;

describe("rent, utilities and the Settle nudge against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "money-rent dbtest");
    registerChannel(new DevChannel((o) => void (o.to === "private" && sent.push({ memberId: memberOf.get(o.userExternalId) ?? o.userExternalId, out: o.msg }))));
    A = await apt("a");
    B = await apt("b");
    await setPaymentHandles(A.as("Maya"), { venmo: "maya-k" });
    await setPaymentHandles(B.as("Maya"), { venmo: "maya-k" });
  });

  after(async () => {
    for (const g of [A, B, C]) if (g) await deleteGroup(g.groupId);
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
    inbox();
    assert.deepEqual(await rentDmJob(A, local(10, 29, 8, 30)), [], "outside the Bundle's hour");
    assert.deepEqual(outcomes(await rentDmJob(A, local(10, 29, 9, 5))), [`${A.id.Dev}:sent`, `${A.id.Sam}:sent`].sort());
    assert.deepEqual(await rentDmJob(A, local(10, 29, 9, 30)), [], "once a month");
    const got = inbox();
    assert.deepEqual(got.map((s) => s.memberId).sort(), [A.id.Dev, A.id.Sam].sort());
    const dev = got.find((s) => s.memberId === A.id.Dev)!.out;
    const sam = got.find((s) => s.memberId === A.id.Sam)!.out;
    assert.match(dev.text, /your share is \$800\b/);
    assert.match(sam.text, /your share is \$600\b/);
    assert.ok(!dev.text.includes("$600") && !sam.text.includes("$800"));
    assert.deepEqual(dev.buttons, [{ text: "Pay Maya on Venmo", url: "https://venmo.com/u/maya-k?txn=pay&amount=800.00&note=Rent" }]);

    const line = "🏠 Rent $2,400 is due Sunday. Maya pays the landlord.";
    assert.equal(await rentBundleLine(A, local(10, 29, 9, 5)), line);
    assert.ok((await groupBundle(A, local(10, 29, 9, 5)))?.includes(line), "Money's line is in the Bundle");
    assert.equal(await rentBundleLine(A, local(10, 30, 9)), null, "nothing on the days between");
  });

  test("a Member who said \"stop nudging me\" gets no rent DM (sendNudge says off)", async () => {
    const { id, as } = B;
    await setRent(as("Maya"), { cents: 240000, dueDay: 1 }, local(10, 29, 8));
    await setNudges(id.Sam, "off");
    inbox();
    assert.deepEqual(outcomes(await rentDmJob(B, local(10, 29, 9, 5))), [`${id.Dev}:sent`, `${id.Sam}:off`].sort());
    assert.deepEqual(inbox().map((s) => s.memberId), [id.Dev]);
    // Out of the way of the Settle nudge test below (B's ledger and its rent offer).
    const { deleteExpense } = await import("./money");
    await deleteExpense(as("Maya"), { expenseId: (await getRent(B))!.expenseId });
  });

  test("the due day with Dev settled: only Sam is named, though Dev still owes Maya for groceries", async () => {
    await settleUp(A.as("Dev"), { toId: A.id.Maya, cents: 80000 });
    // Not rent: the Settle plan has Dev owing Maya $30, and the rent line doesn't care.
    await logExpense(A.as("Maya"), { cents: 9000, description: "Trader Joe's", category: "groceries", occurredOn: "2026-10-30" });
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

  test("a variable electric bill: 0 cents of its own; asked on its due day (held to 08:00 in quiet hours), once more the next day, then quiet", async () => {
    inbox();
    const parent = await setVariableExpense(A.as("Dev"), { description: "Electric", dueDay: 20 });
    assert.equal(parent.variable, true);
    assert.equal(parent.cents, 0, "no fake amount");
    assert.equal(parent.occurredOn, "2026-11-20");
    const asked: DmOutcome[] = [];
    await runRecurring(local(11, 19, 10), { groupId: A.groupId, asked });
    assert.equal(asked.length, 0, "not due yet");
    await runRecurring(local(11, 20, 23), { groupId: A.groupId, asked });
    await runRecurring(local(11, 20, 23, 30), { groupId: A.groupId, asked });
    assert.deepEqual(asked, [{ memberId: A.id.Dev, outcome: "quiet" }], "11 PM is quiet hours: one ask, held");
    const held = await db.select().from(schema.pendingPosts).where(eq(schema.pendingPosts.groupId, A.groupId));
    assert.deepEqual(held.map((h) => [h.kind, h.memberId, h.text]), [["dm", A.id.Dev, "How much was the electric bill?"]]);
    assert.equal(inbox().length, 0, "nothing sent at night");
    const rows = await db.select().from(schema.pendingAmounts).where(eq(schema.pendingAmounts.expenseId, parent.id));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].period, "2026-11");
    await runRecurring(local(11, 21, 10), { groupId: A.groupId, asked });
    await runRecurring(local(11, 22, 10), { groupId: A.groupId, asked });
    assert.deepEqual(asked.map((a) => a.outcome), ["quiet", "sent"], "one re-ask, then nothing until next month");
    assert.deepEqual(inbox(), [{ memberId: A.id.Dev, out: { text: "How much was the electric bill?" } }]);
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

  test("prefillAmount: November is answered, so the bill is December's, and the ask only confirms it", async () => {
    assert.equal(await prefillAmount(A.groupId, "water", 5000, local(11, 25, 10)), null, "no water bill");
    const hit = await prefillAmount(A.groupId, "ComEd electric bill", 9500, local(11, 25, 10));
    assert.equal(hit?.description, "Electric");
    inbox();
    await runRecurring(local(12, 20, 10), { groupId: A.groupId });
    assert.deepEqual(inbox().map((s) => s.out.text), ["How much was the electric bill? Looks like $95 (from the bill). Right?"]);
  });

  test("prefillAmount after a skipped month: January's bill goes on January, not on December's unanswered ask", async () => {
    await runRecurring(local(12, 21, 10), { groupId: A.groupId }); // December's re-ask; nobody answers
    inbox();
    const jan = (month: number, day: number, hour: number) => zonedTimeToUtc(TZ, { year: 2027, month, day, hour, minute: 0 });
    await prefillAmount(A.groupId, "electric", 10150, jan(1, 5, 10));
    const rows = await db.select().from(schema.pendingAmounts).where(eq(schema.pendingAmounts.groupId, A.groupId));
    assert.deepEqual(rows.map((r) => [r.period, r.asks, r.prefillCents]).sort(), [["2026-11", 2, null], ["2026-12", 2, 9500], ["2027-01", 0, 10150]]);
    await runRecurring(jan(1, 20, 10), { groupId: A.groupId });
    assert.deepEqual(inbox().map((s) => s.out.text), ["How much was the electric bill? Looks like $101.50 (from the bill). Right?"]);
  });

  // ---------- the Settle nudge ----------

  test("the Settle nudge DMs the right people once a week and skips the opted-out Member", async () => {
    const { id, as } = B;
    await logExpense(as("Maya"), { cents: 9000, description: "groceries", category: "groceries", occurredOn: "2026-10-30" });
    await logExpense(as("Dev"), { cents: 1500, description: "pizza", category: "food", occurredOn: "2026-11-13", splitAmong: [id.Dev, id.Sam] });
    await setNudges(id.Sam, "off");
    assert.deepEqual(await getNudgeSettings(B), { thresholdCents: 2000, thresholdDays: 7, enabled: true });

    inbox();
    const sunday = local(11, 15, 18, 10); // the report's default day and hour
    assert.deepEqual(await settleNudgeJob(B, local(11, 15, 17, 10)), [], "outside the report's hour");
    assert.deepEqual(await settleNudgeJob(B, sunday), [{ memberId: id.Dev, outcome: "sent" }]);
    assert.deepEqual(await settleNudgeJob(B, local(11, 15, 18, 40)), [], "once a week");
    const got = inbox();
    assert.deepEqual(got.map((s) => s.memberId), [id.Dev], "Sam opted out; Sam's $7.50 to Dev is under the line");
    assert.equal(got[0].out.text, `Quick one: you owe Maya $30.00. Tap to pay, then say "paid" here.`);
    assert.deepEqual(got[0].out.buttons, [{ text: "Pay Maya on Venmo", url: "https://venmo.com/u/maya-k?txn=pay&amount=30.00" }]);

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
    assert.deepEqual(await settleNudgeJob(B, local(11, 22, 18, 10)), []);
    assert.ok((await groupReport(B, local(11, 22, 18, 15))).parts.some((p) => p.text === "2 open balances."));
  });

  // ---------- an early nudge hour, and a nudge run that fails ----------

  test("a nudge hour inside quiet hours (7): the rent DMs go at 08:00, with the Bundle", async () => {
    C = await apt("c");
    await setRent(C.as("Maya"), { cents: 240000, dueDay: 1 }, local(10, 29, 6));
    await updateSchedule(C.as("Maya"), { nudgeHour: 7 });
    inbox();
    assert.deepEqual(await rentDmJob(C, local(10, 29, 7, 5)), [], "07:00 is quiet hours; the Bundle waits for 08:00");
    assert.deepEqual(outcomes(await rentDmJob(C, local(10, 29, 8, 5))), [`${C.id.Dev}:sent`, `${C.id.Sam}:sent`].sort());
    assert.equal(inbox().length, 2);
  });

  test("the Settle nudge: a failed run gives the week's claim back, so the next run in the hour sends", async () => {
    const c = C!;
    await logExpense(c.as("Maya"), { cents: 9000, description: "Costco", category: "groceries", occurredOn: "2026-10-30" });
    inbox();
    const sunday = local(11, 15, 18, 10);
    await assert.rejects(settleNudgeJob(c, sunday, { dms: async () => { throw new Error("the ledger read timed out"); } }), /timed out/);
    const claims = await db.select().from(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, c.groupId), eq(schema.scheduledPosts.kind, "nudge.settle")));
    assert.equal(claims.length, 0, "the claim was given back");
    const sent = await settleNudgeJob(c, local(11, 15, 18, 20));
    assert.deepEqual(outcomes(sent), [`${c.id.Dev}:sent`, `${c.id.Sam}:sent`].sort());
    assert.deepEqual(await settleNudgeJob(c, local(11, 15, 18, 40)), [], "then once a week, as before");
  });
});
