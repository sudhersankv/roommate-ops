// The dashboard dock per Member (#46) against the dev DB, in a throwaway Group (Apt 4B: Maya, Dev, Sam; Money,
// Groceries, House and Lease Inbox learned).
// Run: npx tsx --test src/services/dock.dbtest.ts   (NEVER against production: check .env's DATABASE_URL first)
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { setDock } from "./dock";
import { deleteGroup, initToolkits } from "./groups";
import { getMember, type Member } from "./members";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

const ts = Date.now();
let groupId: string;
let maya: Member, dev: Member, sam: Member;
const as = (m: Member) => ({ groupId, memberId: m.id, source: "ui" as const });

describe("setDock against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "dock.dbtest");
    const [g] = await db.insert(schema.groups).values({ name: `Apt 4B dock ${ts}`, purpose: "roommates", currency: "USD", timezone: "America/Chicago" }).returning();
    groupId = g.id;
    await initToolkits(groupId, ["splitting", "groceries", "house", "lease-inbox"]);
    [maya, dev, sam] = await db
      .insert(schema.members)
      .values(["Maya", "Dev", "Sam"].map((displayName, i) => ({ groupId, displayName, role: i === 0 ? ("admin" as const) : ("member" as const), status: "active" as const })))
      .returning();
  });
  after(async () => {
    await deleteGroup(groupId);
  });

  test("Maya puts Cart left and Inbox right; it's saved on her row and nobody else's", async () => {
    assert.deepEqual(await setDock(as(maya), { tricks: ["groceries", "lease-inbox"] }), { dock: ["groceries", "lease-inbox"] });
    assert.deepEqual((await getMember({ groupId }, maya.id))!.dock, ["groceries", "lease-inbox"]);
    assert.equal((await getMember({ groupId }, dev.id))!.dock, null, "Dev's dock is untouched");
  });

  test("repeats and unknown ids are dropped before saving; nothing usable is refused and nothing changes", async () => {
    assert.deepEqual(await setDock(as(dev), { tricks: ["house", "house", "trips"] }), { dock: ["house", "splitting"] });
    assert.deepEqual((await getMember({ groupId }, dev.id))!.dock, ["house"]);
    await assert.rejects(setDock(as(dev), { tricks: ["trips", "core"] }), /hasn't learned that/);
    assert.deepEqual((await getMember({ groupId }, dev.id))!.dock, ["house"]);
  });

  test("an empty choice goes back to the default: the first two by nav order", async () => {
    await setDock(as(sam), { tricks: ["lease-inbox", "groceries"] });
    assert.deepEqual(await setDock(as(sam), { tricks: [] }), { dock: ["splitting", "house"] });
    assert.equal((await getMember({ groupId }, sam.id))!.dock, null);
  });

  test("a Trick the Group forgot can't be put in the dock", async () => {
    await initToolkits(groupId, ["splitting", "groceries", "house"]);
    await assert.rejects(setDock(as(sam), { tricks: ["lease-inbox"] }), /hasn't learned that/);
    assert.deepEqual(await setDock(as(sam), { tricks: ["lease-inbox", "groceries"] }), { dock: ["groceries", "splitting"] });
  });

  test("a removed Member can't save a dock", async () => {
    await db.update(schema.members).set({ status: "removed" }).where(eq(schema.members.id, sam.id));
    await assert.rejects(setDock(as(sam), { tricks: ["groceries"] }), /not in this group/);
  });
});
