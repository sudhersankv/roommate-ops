// Restock against the Neon dev branch (#26). Run: npx tsx --test src/services/restock.dbtest.ts
// Not *.test.ts: `npm test` runs without .env. A throwaway roommates Group (Maya the Admin, Dev, Sam) made through
// Onboarding on the dev Channel, Instacart on its fake; `after` deletes the Group. History is seeded relative to the
// Group's real local today, because cart_checkout reads the clock.
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, asc, eq } from "drizzle-orm";
import { RequestContext } from "@mastra/core/request-context";
import { db, schema } from "@/db";
import { registerChannel } from "@/channels";
import { DevChannel, devUserId, type DevOutput } from "@/channels/dev";
import { MemoryBlobStore, setBlobStore } from "@/integrations/blob-store";
import { FakeInstacart, setInstacartClient } from "@/integrations/instacart";
import { addDaysToDay, zonedParts, zonedTimeToUtc } from "@/lib/time";
import { onGroupJoined } from "@/onboarding";
import * as cart from "@/services/cart";
import { addItems, listOpenItems, markPurchased } from "@/services/cart";
import { deleteGroup, deleteGroupData } from "@/services/groups";
import { logExpense } from "@/services/money";
import * as receipts from "@/services/receipts";
import type { Ctx } from "@/services/types";
import { cartTools } from "@/toolkits/groceries/cart";
import { restockTools } from "@/toolkits/groceries/restock";
import { groceries } from "@/toolkits/groceries/server";
import { receiptTools } from "@/toolkits/splitting/receipts";
import { backfillPurchases } from "../../scripts/backfill-purchases";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";
import * as restock from "./restock";

const outbox: DevOutput[] = [];
registerChannel(new DevChannel((o) => outbox.push(o)));
setBlobStore(new MemoryBlobStore());

const CHI = "America/Chicago";
const todayParts = zonedParts(CHI, new Date());
/** A wall-clock time today in Chicago (the Group's zone). */
const local = (hour: number, minute = 0) => zonedTimeToUtc(CHI, { year: todayParts.year, month: todayParts.month, day: todayParts.day, hour, minute });

const rc = (who: Ctx, name: string, isPrivate = false) =>
  new RequestContext<unknown>([
    ["groupId", who.groupId],
    ["memberId", who.memberId],
    ["memberName", name],
    ["role", "member"],
    ["status", "active"],
    ["source", isPrivate ? "dm" : "chat"],
    ["isPrivate", isPrivate],
  ]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;
/** Run a tool as `who` (in the group chat, or their DM). */
const run = (tool: unknown, input: unknown, who: Ctx, name: string, isPrivate = false) =>
  (tool as { execute: (i: unknown, c: unknown) => Promise<AnyResult> }).execute(input, { requestContext: rc(who, name, isPrivate) });

let groupId: string;
let maya: Ctx;
let dev: Ctx;
let sam: Ctx;
let today: string;
const now = new Date();
const dayBefore = new Date(now.getTime() - 24 * 3600_000);

const eventsOf = () =>
  db.select().from(schema.purchaseEvents).where(eq(schema.purchaseEvents.groupId, groupId)).orderBy(asc(schema.purchaseEvents.createdAt), asc(schema.purchaseEvents.item));
const clearEvents = () => db.delete(schema.purchaseEvents).where(eq(schema.purchaseEvents.groupId, groupId));

/** Purchases of `item` every `gap` days, the last one `lastAgo` days before today, going back ~90 days. */
const habit = (item: string, gap: number, lastAgo: number, memberId: string | null = null): restock.PurchaseInput[] => {
  const out: restock.PurchaseInput[] = [];
  for (let ago = lastAgo; ago <= 90; ago += gap) out.push({ name: item, memberId, occurredOn: addDaysToDay(today, -ago), source: "cart", sourceId: null });
  return out;
};

describe("Restock against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "restock dbtest");
    setInstacartClient(new FakeInstacart());
    const ts = Date.now();
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`restock-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `test-restock-${ts}`, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    await db.update(schema.groups).set({ timezone: "America/Chicago" }).where(eq(schema.groups.id, groupId));
    const id = (n: string) => joined.members.find((m) => m.displayName === n)!.id;
    maya = { groupId, memberId: id("Maya"), source: "chat" };
    dev = { groupId, memberId: id("Dev"), source: "chat" };
    sam = { groupId, memberId: id("Sam"), source: "chat" };
    today = await restock.localDay(groupId, now);
  });

  after(async () => {
    setInstacartClient(null);
    setBlobStore(null);
    if (groupId) {
      await deleteGroup(groupId);
      assert.equal((await eventsOf()).length, 0, "purchase events go with the Group");
    }
  });

  test("markPurchased writes one event per item: shared -> null, personal -> whoever added it", async () => {
    await addItems(maya, { items: [{ name: "Milk", qty: "1 gal" }], shared: true });
    await addItems(sam, { items: [{ name: "Oat milk", qty: "2 cartons" }] });
    await addItems(dev, { items: [{ name: "chips" }] });
    const open = await listOpenItems({ groupId });
    await markPurchased(maya, { totalCents: 2450 });
    const events = await eventsOf();
    assert.deepEqual(
      events.map((e) => [e.item, e.memberId, e.occurredOn, e.source]).sort(),
      [
        ["chips", dev.memberId, today, "cart"],
        ["milk", null, today, "cart"],
        ["oat milk", sam.memberId, today, "cart"],
      ],
    );
    assert.deepEqual(new Set(events.map((e) => e.sourceId)), new Set(open.map((i) => i.id)));
  });

  test("a failed purchase writes no events (they roll back with it)", async () => {
    const before = (await eventsOf()).length;
    await assert.rejects(markPurchased(maya, { totalCents: 1000 }), /cart is empty/);
    assert.equal((await eventsOf()).length, before);
  });

  test("recordReceiptPurchases: one event per line on the Expense's day, claimed -> personal; once per Expense", async () => {
    const e = await logExpense(maya, { cents: 1899, description: "Target run", category: "groceries", occurredOn: addDaysToDay(today, -1) });
    const n = await restock.recordReceiptPurchases(maya, e.id, [{ name: "Dawn dish soap 2 pack" }, { name: "Oat Milk 64 oz", claimedBy: sam.memberId }]);
    assert.equal(n, 2);
    const rows = (await eventsOf()).filter((x) => x.sourceId === e.id);
    assert.deepEqual(rows.map((x) => [x.item, x.memberId, x.occurredOn, x.source]).sort(), [
      ["dawn dish soap", null, addDaysToDay(today, -1), "receipt"],
      ["oat milk", sam.memberId, addDaysToDay(today, -1), "receipt"],
    ]);
    assert.equal(await restock.recordReceiptPurchases(maya, e.id, [{ name: "Dawn dish soap" }]), 0);
  });

  test("90 days of history: the Bundle line on the day it's due, not the day before; Sam's oat milk is his", async () => {
    await clearEvents();
    await restock.recordPurchases(maya, [
      ...habit("milk", 9, 8), // floor(0.9 x 9) = 8: due today
      ...habit("dish soap", 14, 12), // floor(0.9 x 14) = 12: due today
      ...habit("eggs", 10, 3), // not yet
      ...habit("oat milk", 7, 6, sam.memberId), // Sam's own: due today
    ]);
    assert.equal(await restock.restockBundleLine({ groupId }, now), "Probably low: milk, dish soap. Add them?");
    assert.equal(await restock.restockBundleLine({ groupId }, dayBefore), null);
    const personal = await restock.personalCandidates({ groupId }, now);
    assert.deepEqual(
      personal.map((p) => [p.memberId, p.candidates.map((c) => c.item), p.line]),
      [[sam.memberId, ["oat milk"], "Probably low: your oat milk. Add it?"]],
    );
  });

  test("restockDmJob: Sam's own by DM, only in the Bundle's hour, once a day; nobody else hears it", async () => {
    outbox.length = 0;
    assert.deepEqual(await restock.restockDmJob({ groupId }, local(8, 30)), [], "before the nudge hour (9)");
    const sent = await restock.restockDmJob({ groupId }, local(9, 5));
    assert.deepEqual(sent.map((s) => [s.memberId, s.outcome]), [[sam.memberId, "sent"]]);
    assert.deepEqual(outbox.map((o) => [o.to, o.msg.text]), [["private", "Probably low: your oat milk. Add it?"]]);
    assert.deepEqual(await restock.restockDmJob({ groupId }, local(9, 40)), [], "claimed for the day");
    const claims = await db.select().from(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, groupId), eq(schema.scheduledPosts.kind, "restock.dm")));
    assert.deepEqual(claims.map((c) => c.period), [`${today}:${sam.memberId}`]);
    // Groceries' bundle() runs the job and still returns only the shared line.
    assert.equal(await groceries.bundle!({ groupId }, local(9, 50)), "Probably low: milk, dish soap. Add them?");
    assert.equal(outbox.length, 1, "no second DM");
  });

  test("a mute persists and the next run leaves it out; unmute brings it back", async () => {
    const m = await restock.mute(dev, "Dish soap");
    assert.equal(m.item, "dish soap");
    assert.deepEqual(await restock.getMutes({ groupId }), ["dish soap"]);
    assert.equal(await restock.restockBundleLine({ groupId }, now), "Probably low: milk. Add it?");
    const u = await restock.unmute(sam, "dish soap");
    assert.equal(u.unmuted, true);
    assert.equal(await restock.restockBundleLine({ groupId }, now), "Probably low: milk, dish soap. Add them?");
    assert.equal((await restock.unmute(sam, "dish soap")).unmuted, false);
  });

  test("cart_checkout asks about what's probably low before the link; Sam's own only in his DM; skip_suggestions checks out", async () => {
    await addItems(maya, { items: [{ name: "bread" }], shared: true });
    const inGroup = await run(cartTools.cart_checkout, {}, sam, "Sam");
    assert.deepEqual([inGroup.askFirst, inGroup.suggested, inGroup.say, inGroup.links], [true, ["milk", "dish soap"], "Want me to add milk and dish soap? They're probably low.", undefined]);
    assert.ok(!(await cart.lastUnpaidCheckout({ groupId })), "no list before they answer");
    const inDm = await run(cartTools.cart_checkout, {}, sam, "Sam", true);
    assert.deepEqual(inDm.suggested, ["milk", "oat milk", "dish soap"]);
    const just = await run(cartTools.cart_checkout, { skip_suggestions: true }, sam, "Sam");
    assert.deepEqual([just.askFirst, just.suggested, just.itemCount, just.links?.length], [undefined, undefined, 1, 1]);
  });

  test('restockAddListed: "just the milk" adds only that, as shared, and it stops being low', async () => {
    assert.deepEqual((await restock.restockAddListed(dev, "shared", { only: ["the milk"], now })).added, ["milk"]);
    const milk = (await listOpenItems({ groupId })).find((i) => i.name === "milk");
    assert.equal(milk?.shared, true);
    assert.equal(await restock.restockBundleLine({ groupId }, now), "Probably low: dish soap. Add it?");
    assert.deepEqual(await restock.restockAddListed({ ...sam, source: "dm" }, "mine", { now }), { added: ["oat milk"], say: "Added oat milk for you." });
    const oat = (await listOpenItems({ groupId })).find((i) => i.name === "oat milk");
    assert.deepEqual([oat?.shared, oat?.addedBy], [false, sam.memberId]);
  });

  test("restock_add_listed: one line back; something bought since the line isn't added again", async () => {
    await restock.recordPurchases(dev, [{ name: "Dish soap", memberId: null, occurredOn: today, source: "cart", sourceId: null }]);
    const r = await run(restockTools.restock_add_listed, { scope: "shared" }, dev, "Dev");
    assert.deepEqual([r.added, r.say], [[], "Nothing to add: none of that is still low."]);
    assert.ok(!(await listOpenItems({ groupId })).some((i) => i.name === "dish soap"));
  });

  test("expense_from_receipt writes purchase events: the claimed line is Sam's, the rest shared; a restaurant receipt writes none", async () => {
    await clearEvents();
    receipts.setReceiptReader({
      read: async () => ({
        readable: true,
        merchant: "Target",
        date: null,
        items: [{ name: "Dawn dish soap", price: "3.99" }, { name: "Oat milk 64 oz", price: "4.50" }, { name: "Paper towels", price: "12.00" }],
        tax: null,
        tip: null,
        total: "20.49",
      }),
    });
    try {
      const photo = await receipts.saveUpload({ groupId }, Buffer.from("target receipt"), "image/jpeg");
      // Sam's oat milk is in the Cart, so this receipt closes it (#39): the lines it didn't have are answered here.
      const assignments = [{ item: "oat milk", who: ["Sam"] }, { item: "dish soap", who: ["everyone"] }, { item: "paper towels", who: ["everyone"] }];
      const done = await run(receiptTools.expense_from_receipt, { receipt_url: photo.path, assignments, category: "groceries", confirm: true }, maya, "Maya");
      assert.equal(done.logged, true);
      const rows = (await eventsOf()).filter((e) => e.sourceId === done.id);
      assert.deepEqual(rows.map((e) => [e.item, e.memberId, e.source]).sort(), [
        ["dawn dish soap", null, "receipt"],
        ["oat milk", sam.memberId, "receipt"],
        ["paper towels", null, "receipt"],
      ]);
      receipts.setReceiptReader({ read: async () => receipts.SAMPLE_RECEIPT });
      const dinner = await receipts.saveUpload({ groupId }, Buffer.from("luigi's receipt"), "image/jpeg");
      const food = await run(receiptTools.expense_from_receipt, { receipt_url: dinner.path, confirm: true }, maya, "Maya");
      assert.equal(food.logged, true);
      assert.equal((await eventsOf()).filter((e) => e.sourceId === food.id).length, 0, "a restaurant's steak isn't restocked");
    } finally {
      receipts.setReceiptReader(null);
    }
  });

  test("probablyLowView: shared items and the viewer's own", async () => {
    await clearEvents();
    await restock.recordPurchases(maya, [...habit("dish soap", 14, 12), ...habit("coffee", 7, 6, sam.memberId), ...habit("protein bars", 7, 6, dev.memberId)]);
    const view = await restock.probablyLowView(sam, now);
    assert.deepEqual(view.map((v) => [v.item, v.scope]), [["coffee", "mine"], ["dish soap", "shared"]]); // Dev's protein bars aren't Sam's business
    assert.ok(view.every((v) => v.lastBought <= today));
  });

  test("a Pending Member can't mute or record purchases", async () => {
    const [p] = await db.insert(schema.members).values({ groupId, displayName: "Priya", status: "pending", channelUserId: devUserId(`restock-priya-${Date.now()}`) }).returning();
    const ctx = { groupId, memberId: p.id, source: "chat" as const };
    await assert.rejects(restock.mute(ctx, "milk"), /approve/);
    await assert.rejects(restock.recordPurchases(ctx, habit("milk", 9, 8)), /approve/);
  });

  test("the backfill writes events for purchased items that have none, once", async () => {
    await clearEvents();
    const [a, b] = await db
      .insert(schema.cartItems)
      .values([
        { groupId, name: "Paper towels", addedBy: maya.memberId, shared: true, status: "purchased" },
        { groupId, name: "Greek yogurt", addedBy: dev.memberId, status: "purchased" },
      ])
      .returning();
    const first = await backfillPurchases({ groupId });
    assert.ok(first.written >= 2, JSON.stringify(first));
    const mine = (await eventsOf()).filter((e) => e.sourceId === a.id || e.sourceId === b.id);
    assert.deepEqual(mine.map((e) => [e.item, e.memberId, e.occurredOn]).sort(), [
      ["greek yogurt", dev.memberId, today],
      ["paper towels", null, today],
    ]);
    const second = await backfillPurchases({ groupId });
    assert.equal(second.written, 0);
    assert.equal(second.skipped, first.purchased);
    const all = await db.select().from(schema.purchaseEvents).where(and(eq(schema.purchaseEvents.groupId, groupId)));
    assert.equal(new Set(all.map((e) => e.sourceId)).size, all.length, "one event per item");
  });

  test("restock_add_listed 'mine' in the group chat adds nothing and names nothing; in Sam's DM it adds his own", async () => {
    await clearEvents();
    await restock.recordPurchases(maya, habit("protein bars", 7, 6, sam.memberId));
    const inGroup = await run(restockTools.restock_add_listed, { scope: "mine" }, sam, "Sam");
    assert.deepEqual(inGroup, { added: [], say: "Your own list stays between us: DM me and say yes there." });
    assert.ok(!(await listOpenItems({ groupId })).some((i) => i.name === "protein bars"), "nothing went in the Cart");
    const inDm = await run(restockTools.restock_add_listed, { scope: "mine" }, sam, "Sam", true);
    assert.deepEqual(inDm, { added: ["protein bars"], say: "Added protein bars for you." });
    const bars = (await listOpenItems({ groupId })).find((i) => i.name === "protein bars");
    assert.deepEqual([bars?.shared, bars?.addedBy], [false, sam.memberId]);
  });

  test("two receipt writes for one Expense at once: one set of events", async () => {
    const e = await logExpense(maya, { cents: 1250, description: "Jewel-Osco", category: "groceries", occurredOn: today });
    const lines = [{ name: "Bananas" }, { name: "Greek yogurt", claimedBy: dev.memberId }];
    const [a, b] = await Promise.all([restock.recordReceiptPurchases(maya, e.id, lines), restock.recordReceiptPurchases(dev, e.id, lines)]);
    assert.equal(a + b, 2, `wrote ${a} + ${b}`);
    const rows = (await eventsOf()).filter((x) => x.sourceId === e.id);
    assert.deepEqual(rows.map((x) => [x.item, x.memberId]).sort(), [["bananas", null], ["greek yogurt", dev.memberId]]);
  });

  test("a purchase dated after today doesn't hide what's low today", async () => {
    await clearEvents();
    await restock.recordPurchases(maya, [...habit("coffee filters", 9, 8), { name: "coffee filters", memberId: null, occurredOn: addDaysToDay(today, 5), source: "cart", sourceId: null }]);
    assert.deepEqual((await restock.candidates({ groupId }, now)).map((c) => [c.item, c.lastBought]), [["coffee filters", addDaysToDay(today, -8)]]);
  });

  test("delete group data takes the purchase history with it: nothing is probably low afterwards", async () => {
    assert.ok((await eventsOf()).length > 0);
    await deleteGroupData(maya);
    assert.equal((await eventsOf()).length, 0);
    assert.deepEqual(await restock.candidates({ groupId }, now), []);
  });
});
