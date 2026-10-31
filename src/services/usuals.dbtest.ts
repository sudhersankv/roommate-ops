// Grocery usuals against the Neon dev branch (#36 combined with #62): the row someone said beats Cart history, history
// beats the question, one question at most. Run: npx tsx --test src/services/usuals.dbtest.ts
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
import { addAsSaid, addItems, listOpenItems, markPurchased, pageUsuals, removeItemById } from "@/services/cart";
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
const rowOf = async (memberId: string | null, item: string) => (await rows()).find((r) => r.memberId === memberId && r.item === item);
const clearCart = async () => {
  for (const i of await listOpenItems({ groupId })) await removeItemById(maya, { id: i.id });
};
const said = (r: { added: { name: string; qty: string }[] }) => r.added.map((i) => [i.name, i.qty]);

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

  test("a bare 'Pepsi' asks once; Dev's answer writes his row; the next bare 'Pepsi' uses it, no second question", async () => {
    const first = await addAsSaid(dev, { items: [{ name: "Pepsi" }] });
    assert.deepEqual([first.added, first.needsClarification], [[], ["Pepsi: 12-pack of cans or a 2-liter?"]]);
    assert.equal((await listOpenItems({ groupId })).length, 0);
    // The answer, without remember: the question was just asked about Pepsi for Dev, so it's remembered.
    const answer = await addAsSaid(dev, { items: [{ name: "Pepsi", qty: "12 × 12 oz cans" }] });
    assert.deepEqual([said(answer), answer.usedUsual], [[["Pepsi", "12 × 12 oz cans"]], []]);
    const row = await rowOf(dev.memberId, "pepsi");
    assert.deepEqual([row?.name, row?.qty, Number(row?.quantity)], ["Pepsi", "12 × 12 oz cans", 12]);
    await clearCart();
    const next = await addAsSaid(dev, { items: [{ name: "pepsi" }] });
    assert.deepEqual([said(next), next.needsClarification, next.usedUsual], [[["Pepsi", "12 × 12 oz cans"]], [], [{ name: "Pepsi", qty: "12 × 12 oz cans" }]]);
  });

  test("a plain clear add is history, not a row: '2 gallons of whole milk' goes in and writes nothing", async () => {
    const r = await addAsSaid(maya, { items: [{ name: "whole milk", qty: "2 gallons" }, { name: "dish soap" }], shared: true });
    assert.deepEqual([said(r), r.needsClarification], [[["whole milk", "2 gallons"], ["dish soap", "1"]], []]);
    assert.equal(await rowOf(null, "milk"), undefined);
  });

  test("history is used when there's no row: the house's milk is 2 gallons like last time", async () => {
    const r = await addAsSaid(sam, { items: [{ name: "whole milk" }], shared: true });
    assert.deepEqual([said(r), r.usedUsual, r.needsClarification], [[["whole milk", "2 gallons"]], [{ name: "whole milk", qty: "2 gallons" }], []]);
  });

  test("a row beats history: 'make it 1 gallon from now on', then a bare milk is 1 gallon though history says 2", async () => {
    await addAsSaid(maya, { items: [{ name: "whole milk", qty: "1 gallon", remember: true }], shared: true });
    assert.equal((await rowOf(null, "milk"))?.qty, "1 gallon");
    await clearCart();
    await addItems(maya, { items: [{ name: "whole milk", qty: "2 gallons" }, { name: "whole milk", qty: "2 gallons" }], shared: true });
    const r = await addAsSaid(dev, { items: [{ name: "whole milk" }], shared: true });
    assert.deepEqual(r.usedUsual, [{ name: "whole milk", qty: "1 gallon" }]);
  });

  test("'just a 2-liter this time' doesn't overwrite Dev's row; remember true does", async () => {
    await addAsSaid(dev, { items: [{ name: "Pepsi", qty: "1 × 2-liter bottle" }] });
    assert.equal((await rowOf(dev.memberId, "pepsi"))?.qty, "12 × 12 oz cans");
    await addAsSaid(dev, { items: [{ name: "Pepsi", qty: "1 × 2-liter bottle", remember: false }] });
    assert.equal((await rowOf(dev.memberId, "pepsi"))?.qty, "12 × 12 oz cans");
    await addAsSaid(dev, { items: [{ name: "Pepsi", qty: "24 × 12 oz cans", remember: true }] });
    assert.equal((await rowOf(dev.memberId, "pepsi"))?.qty, "24 × 12 oz cans");
  });

  test("each scope stays separate: Dev's Pepsi isn't Sam's; the house's bread isn't anyone's own; for Dev uses Dev's", async () => {
    assert.deepEqual((await addAsSaid(sam, { items: [{ name: "Pepsi" }] })).needsClarification, ["Pepsi: 12-pack of cans or a 2-liter?"]);
    await addAsSaid(maya, { items: [{ name: "Sourdough bread", qty: "1 loaf", remember: true }], shared: true });
    const shared = await addAsSaid(sam, { items: [{ name: "bread" }], shared: true });
    assert.deepEqual(shared.usedUsual, [{ name: "Sourdough bread", qty: "1 loaf" }], "a bare bread finds the house's sourdough");
    const own = await addAsSaid(sam, { items: [{ name: "bread" }] });
    assert.deepEqual([own.usedUsual, own.needsClarification, own.added.map((i) => i.name)], [[], [], ["bread"]], "Sam's own bread is just bread, not the house's sourdough");
    const forDev = await addAsSaid(maya, { items: [{ name: "Pepsi" }], forMemberId: dev.memberId });
    assert.deepEqual(forDev.usedUsual, [{ name: "Pepsi", qty: "24 × 12 oz cans" }]);
  });

  test("an answer from the dashboard counts too; a quantity long after the question is a plain add", async () => {
    const ui = { ...sam, source: "ui" as const };
    assert.deepEqual((await addAsSaid(ui, { items: [{ name: "coffee" }] })).needsClarification, ["coffee: beans or ground?"]);
    await addAsSaid(ui, { items: [{ name: "coffee", qty: "1 lb ground" }] });
    assert.equal((await rowOf(sam.memberId, "coffee"))?.qty, "1 lb ground");
    usuals.noteAsked(groupId, sam.memberId, ["seltzer"], Date.now() - usuals.ANSWER_MS - 1000);
    await addAsSaid(sam, { items: [{ name: "seltzer", qty: "8 cans" }] });
    assert.equal(await rowOf(sam.memberId, "seltzer"), undefined);
  });

  test("purchases write no rows: 'I paid' leaves the table alone (history covers it)", async () => {
    await clearCart();
    const before = (await rows()).length;
    await addItems(sam, { items: [{ name: "Greek yogurt", qty: "2 tubs" }] });
    await markPurchased(maya, { totalCents: 650 });
    assert.equal((await rows()).length, before);
    const next = await addAsSaid(sam, { items: [{ name: "greek yogurt" }] });
    assert.deepEqual(next.usedUsual, [{ name: "greek yogurt", qty: "2 tubs" }]);
  });

  test("the Cart page: rows are pinned (edit, remove); history ones are 'from what you bought', and editing one pins it", async () => {
    const page = await pageUsuals(sam);
    const coffee = page.find((u) => u.name === "coffee");
    const yogurt = page.find((u) => u.name.toLowerCase() === "greek yogurt");
    assert.deepEqual([coffee?.scope, coffee?.pinned, yogurt?.scope, yogurt?.pinned, yogurt?.qty], ["mine", true, "mine", false, "2 tubs"]);
    assert.ok(page.some((u) => u.scope === "shared" && u.name === "Sourdough bread" && u.pinned));
    assert.ok(!page.some((u) => u.name === "Pepsi" && u.scope === "mine"), "Dev's Pepsi isn't on Sam's page");
    const pinned = await usuals.pinUsual({ ...sam, source: "ui" }, { name: "Greek yogurt", qty: "1 big tub", shared: false });
    assert.equal((await addAsSaid(sam, { items: [{ name: "greek yogurt" }] })).usedUsual[0].qty, "1 big tub");
    await assert.rejects(usuals.updateUsual(dev, { id: pinned.id, qty: "1 cup" }), /someone else's usual/);
    await assert.rejects(usuals.removeUsual(dev, { id: pinned.id }), /someone else's usual/);
    const edited = await usuals.updateUsual(sam, { id: pinned.id, qty: "2 big tubs" });
    assert.equal(edited.qty, "2 big tubs");
    assert.equal(await usuals.removeUsual(sam, { id: pinned.id }), true);
    // Back to history: the latest three adds were 1 big tub, 2 tubs, 2 tubs.
    assert.equal((await addAsSaid(sam, { items: [{ name: "greek yogurt" }] })).usedUsual[0].qty, "2 tubs", "back to history");
  });

  test("forget me clears Dev's rows (the house's stay); delete group data clears the rest", async () => {
    assert.ok((await rows()).some((r) => r.memberId === dev.memberId));
    await forgetMe(dev);
    const left = await rows();
    assert.ok(!left.some((r) => r.memberId === dev.memberId));
    assert.ok(left.some((r) => r.memberId === null), "the house's bread stays");
    assert.ok(left.some((r) => r.memberId === sam.memberId), "Sam's coffee stays");
    await deleteGroupData(maya);
    assert.deepEqual(await rows(), []);
  });
});
