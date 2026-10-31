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
import { devUserId } from "@/channels/dev";
import { FakeInstacart, setInstacartClient } from "@/integrations/instacart";
import { addDaysToDay } from "@/lib/time";
import { onGroupJoined } from "@/onboarding";
import { addItems, listOpenItems, markPurchased } from "@/services/cart";
import { deleteGroup } from "@/services/groups";
import { logExpense } from "@/services/money";
import type { Ctx } from "@/services/types";
import { cartTools } from "@/toolkits/groceries/cart";
import { backfillPurchases } from "../../scripts/backfill-purchases";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";
import * as restock from "./restock";

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
      [[sam.memberId, ["oat milk"], "Probably low: oat milk. Add it?"]],
    );
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

  test("cart_checkout suggests what's probably low and not in the Cart; Sam's own only in his DM", async () => {
    await addItems(maya, { items: [{ name: "bread" }], shared: true });
    const rc = (who: Ctx, name: string, isPrivate = false) =>
      new RequestContext<unknown>([
        ["groupId", groupId],
        ["memberId", who.memberId],
        ["memberName", name],
        ["role", "member"],
        ["status", "active"],
        ["source", "chat"],
        ["isPrivate", isPrivate],
      ]);
    const checkout = cartTools.cart_checkout as unknown as { execute: (i: unknown, c: unknown) => Promise<{ suggested?: string[]; itemCount: number }> };
    const inGroup = await checkout.execute({}, { requestContext: rc(sam, "Sam") });
    assert.deepEqual(inGroup.suggested, ["milk", "dish soap"]);
    const inDm = await checkout.execute({}, { requestContext: rc(sam, "Sam", true) });
    assert.deepEqual(inDm.suggested, ["milk", "oat milk", "dish soap"]);
  });

  test('restockAddListed: "just the milk" adds only that, as shared, and it stops being low', async () => {
    assert.deepEqual(await restock.restockAddListed(dev, "shared", { only: ["the milk"], now }), ["milk"]);
    const milk = (await listOpenItems({ groupId })).find((i) => i.name === "milk");
    assert.equal(milk?.shared, true);
    assert.equal(await restock.restockBundleLine({ groupId }, now), "Probably low: dish soap. Add it?");
    assert.deepEqual(await restock.restockAddListed(sam, "mine", { now }), ["oat milk"]);
    const oat = (await listOpenItems({ groupId })).find((i) => i.name === "oat milk");
    assert.deepEqual([oat?.shared, oat?.addedBy], [false, sam.memberId]);
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
});
