// A grocery receipt closes the Cart (#39), against the Neon dev branch. Run: npx tsx --test src/services/cart-receipt.dbtest.ts
// Not *.test.ts: `npm test` runs without .env. A throwaway roommates Group (Maya the Admin, Dev, Sam) made through
// Onboarding on the dev Channel, Instacart on its fake, the receipt reader faked; `after` deletes the Group.
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { RequestContext } from "@mastra/core/request-context";
import { db, schema } from "@/db";
import { registerChannel } from "@/channels";
import { DevChannel, devUserId } from "@/channels/dev";
import { MemoryBlobStore, setBlobStore } from "@/integrations/blob-store";
import { FakeInstacart, setInstacartClient } from "@/integrations/instacart";
import { onGroupJoined } from "@/onboarding";
import { addAsSaid, addItems, checkout, listOpenItems, removeItemById } from "@/services/cart";
import { deleteGroup } from "@/services/groups";
import * as receipts from "@/services/receipts";
import type { Ctx } from "@/services/types";
import { cartTools } from "@/toolkits/groceries/cart";
import { receiptTools } from "@/toolkits/splitting/receipts";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

registerChannel(new DevChannel(() => {}));
setBlobStore(new MemoryBlobStore());

let groupId: string;
let maya: Ctx;
let dev: Ctx;
let sam: Ctx;

const rc = (who: Ctx, name: string) =>
  new RequestContext<unknown>([
    ["groupId", who.groupId],
    ["memberId", who.memberId],
    ["memberName", name],
    ["role", "member"],
    ["status", "active"],
    ["source", "chat"],
  ]);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = Record<string, any>;
const run = (tool: unknown, input: unknown, who: Ctx, name: string) => (tool as { execute: (i: unknown, c: unknown) => Promise<AnyResult> }).execute(input, { requestContext: rc(who, name) });

/** Trader Joe's: $28.75 of items + $1.20 tax = $29.95. */
const TRADER_JOES: receipts.RawReceipt = {
  readable: true,
  merchant: "Trader Joe's",
  date: null,
  items: [
    { name: "PEPSI 12PK 12OZ CANS", price: "7.99" },
    { name: "WHOLE MILK 1 GAL", price: "4.29" },
    { name: "OAT MILK 64 OZ", price: "4.99" },
    { name: "SOURDOUGH LOAF", price: "5.49" },
    { name: "DORITOS NACHO", price: "5.99" },
  ],
  tax: "1.20",
  tip: null,
  total: "29.95",
};

describe("A grocery receipt closes the Cart (dev DB)", () => {
  before(async () => {
    await assertNotProdDb(db, "cart-receipt dbtest");
    setInstacartClient(new FakeInstacart());
    receipts.setReceiptReader({ read: async () => TRADER_JOES });
    const ts = Date.now();
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`cartrcpt-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `test-cartrcpt-${ts}`, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    const id = (n: string) => joined.members.find((m) => m.displayName === n)!.id;
    maya = { groupId, memberId: id("Maya"), source: "chat" };
    dev = { groupId, memberId: id("Dev"), source: "chat" };
    sam = { groupId, memberId: id("Sam"), source: "chat" };
  });

  after(async () => {
    receipts.setReceiptReader(null);
    setInstacartClient(null);
    setBlobStore(null);
    if (groupId) await deleteGroup(groupId);
  });

  test("the breakdown first, with one question about the line the Cart didn't have; then the Cart closes", async () => {
    await addItems(dev, { items: [{ name: "Pepsi", qty: "12 × 12 oz cans" }] });
    await addItems(sam, { items: [{ name: "Oat milk", qty: "2 cartons" }] });
    await addItems(maya, { items: [{ name: "Whole milk", qty: "1 gallon" }, { name: "Sourdough bread" }, { name: "Dish soap" }], shared: true });
    const c = await checkout(maya);
    const photo = await receipts.saveUpload({ groupId }, Buffer.from("trader joe's receipt"), "image/jpeg");

    const first = await run(receiptTools.expense_from_receipt, { receipt_url: photo.path, category: "groceries", confirm: true }, maya, "Maya");
    assert.equal(first.logged, false, "an unmatched line is asked about, not guessed");
    assert.equal(first.closesCart, true);
    assert.equal(first.ask, "Not on the Cart: DORITOS NACHO ($5.99). Shared, or whose?");
    assert.deepEqual(first.staysInCart, ["Dish soap"]);
    assert.deepEqual(
      first.items.map((i: AnyResult) => [i.name, i.who, i.cartItem ?? null]),
      [
        ["PEPSI 12PK 12OZ CANS", ["Dev"], "Pepsi"],
        ["WHOLE MILK 1 GAL", "everyone", "Whole milk"],
        ["OAT MILK 64 OZ", ["Sam"], "Oat milk"],
        ["SOURDOUGH LOAF", "everyone", "Sourdough bread"],
        ["DORITOS NACHO", "everyone", null],
      ],
    );
    assert.equal((await listOpenItems({ groupId })).length, 5, "nothing written yet");

    // "the chips were mine" (Dev): Dev 7.99 + 5.99 + a third of 4.29 + 5.49 = 17.24, Sam 4.99 + 3.26 = 8.25, Maya 3.26;
    // the $1.20 tax in proportion: Dev 17.96, Sam 8.59, Maya 3.40 = 29.95.
    const done = await run(receiptTools.expense_from_receipt, { receipt_url: photo.path, category: "groceries", assignments: [{ item: "doritos", who: ["Dev"] }], confirm: true }, maya, "Maya");
    assert.equal(done.logged, true);
    assert.equal(done.closedCart, true);
    assert.equal(done.purchased, 4);
    assert.equal(done.checkoutPaid, true);
    assert.deepEqual(done.staysInCart, ["Dish soap"]);
    const splits = await db.select().from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, done.id));
    const cents = Object.fromEntries(splits.map((s) => [s.memberId, s.cents]));
    assert.deepEqual([cents[dev.memberId], cents[sam.memberId], cents[maya.memberId]], [1796, 859, 340]);
    const [e] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, done.id));
    assert.deepEqual([e.cents, e.category, e.splitMethod, e.payerId, e.description], [2995, "groceries", "exact", maya.memberId, "Trader Joe's"]);
    assert.ok(e.receiptDocumentId, "the receipt is the Expense's Document");
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, e.receiptDocumentId!));
    assert.equal(doc.kind, "receipt");

    assert.deepEqual((await listOpenItems({ groupId })).map((i) => i.name), ["Dish soap"], "matched items are bought; the rest stays");
    const [paid] = await db.select().from(schema.cartCheckouts).where(eq(schema.cartCheckouts.id, c.id));
    assert.deepEqual([paid.expenseId, !!paid.paidAt], [done.id, true]);

    const events = await db.select().from(schema.purchaseEvents).where(and(eq(schema.purchaseEvents.groupId, groupId), eq(schema.purchaseEvents.sourceId, done.id)));
    assert.deepEqual(events.map((x) => [x.item, x.memberId, x.source]).sort(), [
      ["doritos nacho", dev.memberId, "receipt"],
      ["milk", null, "receipt"],
      ["oat milk", sam.memberId, "receipt"],
      ["pepsi", dev.memberId, "receipt"],
      ["sourdough bread", null, "receipt"],
    ]);
    assert.equal((await db.select().from(schema.groceryUsuals).where(eq(schema.groceryUsuals.groupId, groupId))).length, 0, "a receipt writes no usual rows");
    assert.deepEqual((await addAsSaid(sam, { items: [{ name: "oat milk" }] })).usedUsual, [{ name: "oat milk", qty: "2 cartons" }], "what was bought is the usual (history)");
    for (const i of (await listOpenItems({ groupId })).filter((x) => x.name === "oat milk")) await removeItemById(maya, { id: i.id });
  });

  test("the same receipt again closes nothing more; a receipt with nothing from the Cart is an ordinary Expense", async () => {
    const photo = await receipts.saveUpload({ groupId }, Buffer.from("trader joe's receipt"), "image/jpeg");
    const again = await run(receiptTools.expense_from_receipt, { receipt_url: photo.path, category: "groceries" }, maya, "Maya");
    assert.equal(again.closesCart, undefined, "nothing on it is still in the Cart");
    const gone = (await listOpenItems({ groupId }))[0];
    await removeItemById(maya, { id: gone.id });
  });

  test("'I paid 84' is unchanged: cart_purchased splits by item", async () => {
    await addItems(dev, { items: [{ name: "Pepsi", qty: "12 × 12 oz cans" }] });
    await addItems(maya, { items: [{ name: "Paper towels" }], shared: true });
    const r = await run(cartTools.cart_purchased, { total: 84 }, sam, "Sam");
    // Two items, $42 each: the Pepsi is Dev's, the paper towels a third each ($14).
    assert.deepEqual(Object.fromEntries((r.splits as { memberId: string; cents: number }[]).map((s) => [s.memberId, s.cents])), { [dev.memberId]: 5600, [sam.memberId]: 1400, [maya.memberId]: 1400 });
  });
});
