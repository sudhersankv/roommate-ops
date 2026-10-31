// Grocery usuals against the Neon dev branch (#36). Run: npx tsx --test src/services/usuals.dbtest.ts
// Not *.test.ts: `npm test` runs without .env. A throwaway roommates Group (Maya the Admin, Dev, Sam) made through
// Onboarding on the dev Channel; `after` deletes the Group.
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { registerChannel } from "@/channels";
import { DevChannel, devUserId } from "@/channels/dev";
import { MemoryBlobStore, setBlobStore } from "@/integrations/blob-store";
import { onGroupJoined } from "@/onboarding";
import { addItems, addWithUsuals, listOpenItems, markPurchased, removeItemById } from "@/services/cart";
import { deleteGroup, deleteGroupData } from "@/services/groups";
import { forgetMe } from "@/services/members";
import type { Ctx } from "@/services/types";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";
import * as usuals from "./usuals";

registerChannel(new DevChannel(() => {}));
setBlobStore(new MemoryBlobStore());

let groupId: string;
let maya: Ctx;
let dev: Ctx;
let sam: Ctx;

const rows = () => db.select().from(schema.groceryUsuals).where(eq(schema.groceryUsuals.groupId, groupId));
const usualOf = async (memberId: string | null, name: string) => usuals.findUsual(groupId, name, memberId);
const clearCart = async () => {
  for (const i of await listOpenItems({ groupId })) await removeItemById(maya, { id: i.id });
};

describe("Grocery usuals against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "usuals dbtest");
    const ts = Date.now();
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`usuals-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `test-usuals-${ts}`, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    const id = (n: string) => joined.members.find((m) => m.displayName === n)!.id;
    maya = { groupId, memberId: id("Maya"), source: "chat" };
    dev = { groupId, memberId: id("Dev"), source: "chat" };
    sam = { groupId, memberId: id("Sam"), source: "chat" };
  });

  after(async () => {
    setBlobStore(null);
    if (groupId) await deleteGroup(groupId);
  });

  test("the first bare 'Pepsi' asks one question and adds nothing; the answer goes in and is remembered", async () => {
    const first = await addWithUsuals(dev, { items: [{ name: "Pepsi" }] });
    assert.deepEqual([first.added, first.needsClarification, first.say], [[], ["Pepsi: cans or a bottle, and how many?"], null]);
    assert.equal((await listOpenItems({ groupId })).length, 0);
    const answer = await addWithUsuals(dev, { items: [{ name: "Pepsi", qty: "12 × 12 oz cans" }] });
    assert.deepEqual(answer.added.map((i) => [i.name, i.qty, i.usual]), [["Pepsi", "12 × 12 oz cans", undefined]]);
    const u = await usualOf(dev.memberId, "pepsi");
    assert.deepEqual([u?.name, u?.qty, u?.quantity, u?.source], ["Pepsi", "12 × 12 oz cans", 12, "asked"]);
  });

  test("next time 'Pepsi' is Dev's usual, said back", async () => {
    await clearCart();
    const r = await addWithUsuals(dev, { items: [{ name: "pepsi" }] });
    assert.deepEqual(r.needsClarification, []);
    assert.deepEqual(r.added.map((i) => [i.name, i.qty, i.usual, i.shared]), [["Pepsi", "12 × 12 oz cans", "your usual", false]]);
    assert.equal(r.say, "Added your usual: Pepsi, 12 × 12 oz cans.");
  });

  test("clear things aren't asked about: '2 gallons of whole milk', 'dish soap'", async () => {
    const r = await addWithUsuals(maya, { items: [{ name: "whole milk", qty: "2 gallons" }, { name: "dish soap" }], shared: true });
    assert.deepEqual(r.needsClarification, []);
    assert.deepEqual(r.added.map((i) => [i.name, i.qty]), [["whole milk", "2 gallons"], ["dish soap", "1"]]);
    assert.equal(r.say, "Added whole milk (2 gallons) and dish soap.");
    assert.equal((await usualOf(null, "dish soap")), undefined, "a bare 1 isn't a usual");
  });

  test("personal usuals stay personal: Sam's 'Pepsi' asks; the house's bread applies to anyone's shared bread, not a personal one", async () => {
    assert.deepEqual((await addWithUsuals(sam, { items: [{ name: "Pepsi" }] })).needsClarification, ["Pepsi: cans or a bottle, and how many?"]);
    await addWithUsuals(maya, { items: [{ name: "Sourdough bread", qty: "1 loaf" }], shared: true });
    const shared = await addWithUsuals(sam, { items: [{ name: "bread" }], shared: true });
    assert.equal(shared.say, "Added the house's usual: Sourdough bread, 1 loaf.");
    assert.equal(shared.added[0].shared, true);
    assert.deepEqual((await addWithUsuals(sam, { items: [{ name: "bread" }] })).needsClarification, ["bread: what kind? (a sandwich loaf, sourdough…)"]);
    // Maya adding Dev's Pepsi for him uses Dev's usual.
    const forDev = await addWithUsuals(maya, { items: [{ name: "Pepsi" }], forMemberId: dev.memberId });
    assert.equal(forDev.say, "Added Dev's usual: Pepsi, 12 × 12 oz cans.");
  });

  test("'just a 2-liter this time' doesn't overwrite; 'make it 24 from now on' does", async () => {
    const once = await addWithUsuals(dev, { items: [{ name: "Pepsi", qty: "1 × 2-liter bottle" }] });
    assert.deepEqual(once.added.map((i) => [i.name, i.qty]), [["Pepsi", "1 × 2-liter bottle"]]);
    assert.equal((await usualOf(dev.memberId, "pepsi"))?.qty, "12 × 12 oz cans");
    await addWithUsuals(dev, { items: [{ name: "Pepsi", qty: "24 × 12 oz cans", remember: true }] });
    const u = await usualOf(dev.memberId, "pepsi");
    assert.deepEqual([u?.qty, u?.source], ["24 × 12 oz cans", "corrected"]);
  });

  test("a purchase teaches a purchase-learned usual and follows it; never an asked or corrected one", async () => {
    await clearCart();
    await addItems(sam, { items: [{ name: "Greek yogurt", qty: "2 tubs" }] });
    await addItems(dev, { items: [{ name: "Pepsi", qty: "1 × 2-liter bottle" }] });
    await markPurchased(maya, { totalCents: 1150 });
    const yogurt = await usualOf(sam.memberId, "greek yogurt");
    assert.deepEqual([yogurt?.qty, yogurt?.source], ["2 tubs", "purchase"]);
    assert.equal((await usualOf(dev.memberId, "pepsi"))?.qty, "24 × 12 oz cans", "Dev said 24 from now on");
    await addItems(sam, { items: [{ name: "Greek yogurt", qty: "1 big tub" }] });
    await markPurchased(sam, { totalCents: 599 });
    assert.equal((await usualOf(sam.memberId, "greek yogurt"))?.qty, "1 big tub");
    const next = await addWithUsuals(sam, { items: [{ name: "greek yogurt" }] });
    assert.equal(next.say, "Added your usual: Greek yogurt, 1 big tub.");
  });

  test("the Cart page's list: yours, then the house's; edit and remove your own or the house's, not someone else's", async () => {
    const devView = await usuals.listUsuals(dev);
    assert.deepEqual(devView.mine.map((u) => u.name), ["Pepsi"]);
    // Last used first: the bread was used after the milk went in.
    assert.deepEqual(devView.house.map((u) => [u.name, u.qty]), [["Sourdough bread", "1 loaf"], ["whole milk", "2 gallons"]]);
    const pepsi = devView.mine[0];
    await assert.rejects(usuals.updateUsual(sam, { id: pepsi.id, qty: "1 can" }), /someone else's usual/);
    await assert.rejects(usuals.removeUsual(sam, { id: pepsi.id }), /someone else's usual/);
    const edited = await usuals.updateUsual({ ...dev, source: "ui" }, { id: pepsi.id, name: "Diet Pepsi", qty: "12 × 12 oz cans" });
    assert.deepEqual([edited.item, edited.name, edited.source], ["diet pepsi", "Diet Pepsi", "corrected"]);
    const milk = devView.house.find((u) => u.name === "whole milk")!;
    assert.equal(await usuals.removeUsual(sam, { id: milk.id }), true, "the house's: any active Member");
    assert.equal(await usualOf(null, "milk"), undefined);
  });

  test("forget me clears Dev's usuals (the house's stay); delete group data clears the rest", async () => {
    assert.ok((await rows()).some((r) => r.memberId === dev.memberId));
    await forgetMe(dev);
    const left = await rows();
    assert.ok(!left.some((r) => r.memberId === dev.memberId));
    assert.ok(left.some((r) => r.memberId === null), "the house's bread stays");
    assert.ok(left.some((r) => r.memberId === sam.memberId), "Sam's yogurt stays");
    await deleteGroupData(maya);
    assert.deepEqual(await rows(), []);
  });
});
