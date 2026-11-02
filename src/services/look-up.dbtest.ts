// Look-up and the Group's place (#78) against the Neon dev branch, on FakeSearch and in-memory caps. A throwaway
// Group (Maya Admin, Dev, Sam Pending), deleted afterwards.
// Run: npx tsx --test src/services/look-up.dbtest.ts   (refuses the production branch)
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { FakeSearch, setSearchClient } from "@/integrations/search";
import { makeCaps, setCaps } from "@/lib/caps";
import { MemoryCounters } from "@/lib/window-limit";
import { NotAllowedError } from "./authz";
import { deleteGroup, deleteGroupData } from "./groups";
import { LOOK_UP_CAPPED, LOOK_UP_MEMBER, LOOK_UP_OFF, lookUp } from "./look-up";
import { BadPinError, getPlace, savePlace } from "./place";
import type { Ctx } from "./types";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

let groupId: string;
let maya: Ctx;
let sam: Ctx;
const search = new FakeSearch();

before(async () => {
  await assertNotProdDb(db, "the look-up dbtest");
  const [g] = await db.insert(schema.groups).values({ name: `Look-up test ${Date.now()}`, purpose: "roommates", onboardedAt: new Date() }).returning();
  groupId = g.id;
  const rows = await db
    .insert(schema.members)
    .values([
      { groupId, displayName: "Maya", role: "admin" as const, status: "active" as const },
      { groupId, displayName: "Dev Patel", role: "member" as const, status: "active" as const },
      { groupId, displayName: "Sam", role: "member" as const, status: "pending" as const },
    ])
    .returning();
  const id = (n: string) => rows.find((r) => r.displayName === n)!.id;
  maya = { groupId, memberId: id("Maya"), source: "chat" };
  sam = { groupId, memberId: id("Sam"), source: "chat" };
  setCaps(makeCaps(new MemoryCounters()));
  setSearchClient(search);
});

after(async () => {
  setSearchClient(null);
  setCaps(undefined);
  if (groupId) await deleteGroup(groupId);
  const left = await db.select().from(schema.groups).where(eq(schema.groups.id, groupId));
  assert.equal(left.length, 0);
});

describe("lookUp", () => {
  test("an answer: one or two sentences, one source as a link, a pin when it's one place", async () => {
    const r = await lookUp(maya, { query: "is Costco open till 9?" });
    assert.ok("say" in r && !("refused" in r) && !("unavailable" in r));
    assert.match(r.say, /8:30 PM/);
    assert.equal(r.links.length, 1);
    assert.match(r.links[0].url, /^https:\/\/www\.costco\.com\//);
    assert.equal(r.links[0].text, "Source: costco.com");
    assert.equal(r.location?.name, "Costco Wholesale");
    assert.equal(typeof r.location?.lat, "number");
  });

  test("never about a Member: refused before anything goes out", async () => {
    const before = search.queries.length;
    for (const query of ["look up Dev Patel", "find maya's instagram", "what's sam doing"]) {
      assert.deepEqual(await lookUp(maya, { query }), { refused: "member", say: LOOK_UP_MEMBER }, query);
    }
    assert.equal(search.queries.length, before, "nothing was searched");
  });

  test("'near us' with no saved place: searched as asked, and says there's no place", async () => {
    const r = await lookUp(maya, { query: "find a plumber near us" });
    assert.ok("links" in r);
    assert.equal(r.noPlace, true);
    assert.equal(search.queries.at(-1), "find a plumber near us");
  });

  test("this is our place: saved (any active Member), and 'near us' uses it", async () => {
    assert.equal(await getPlace(maya), null);
    const { place, replaced } = await savePlace(maya, { lat: 41.943, lng: -87.6826, name: "Home", address: "2140 W Roscoe St, Chicago" });
    assert.equal(replaced, null);
    assert.equal(place.savedBy, maya.memberId);
    const got = await getPlace(maya);
    assert.deepEqual([got?.lat, got?.lng, got?.address], [41.943, -87.6826, "2140 W Roscoe St, Chicago"]);
    const r = await lookUp(maya, { query: "find a plumber near us" });
    assert.ok("links" in r && r.usedPlace);
    assert.equal(search.queries.at(-1), "find a plumber near 2140 W Roscoe St, Chicago");
    const again = await savePlace(maya, { lat: 41.95, lng: -87.68 });
    assert.equal(again.replaced?.address, "2140 W Roscoe St, Chicago");
    // The report's schedule on the same row is left alone.
    const [row] = await db.select().from(schema.groupToolkits).where(and(eq(schema.groupToolkits.groupId, groupId), eq(schema.groupToolkits.toolkit, "core")));
    assert.ok((row.settings as { place?: unknown }).place);
    const activity = await db.select().from(schema.activity).where(eq(schema.activity.groupId, groupId));
    assert.ok(activity.some((a) => a.kind === "group.place"));
  });

  test("a pin without coordinates, or a Pending Member, saves nothing", async () => {
    await assert.rejects(savePlace(maya, { lat: "x", lng: 2 }), BadPinError);
    await assert.rejects(savePlace(sam, { lat: 1, lng: 2 }), NotAllowedError);
    assert.equal((await getPlace(maya))?.lat, 41.95);
  });

  test("delete group data takes the place off (the rest of core's settings stay)", async () => {
    await db
      .update(schema.groupToolkits)
      .set({ settings: { place: { lat: 41.95, lng: -87.68 }, report: { weekday: 0, hour: 18 } } })
      .where(and(eq(schema.groupToolkits.groupId, groupId), eq(schema.groupToolkits.toolkit, "core")));
    await deleteGroupData(maya);
    assert.equal(await getPlace(maya), null);
    const [row] = await db.select().from(schema.groupToolkits).where(and(eq(schema.groupToolkits.groupId, groupId), eq(schema.groupToolkits.toolkit, "core")));
    assert.deepEqual(row.settings, { report: { weekday: 0, hour: 18 } });
    await savePlace(maya, { lat: 41.95, lng: -87.68 });
  });

  test("30 a day per Group, then it says so", async () => {
    setCaps(makeCaps(new MemoryCounters()));
    for (let i = 0; i < 30; i++) assert.ok(!("refused" in (await lookUp(maya, { query: `ramen ${i}` }))));
    assert.deepEqual(await lookUp(maya, { query: "ramen again" }), { refused: "capped", say: LOOK_UP_CAPPED });
  });

  test("look-up off (no key, no fake): says so plainly", async () => {
    setSearchClient(null);
    const saved = { key: process.env.EXA_API_KEY, fake: process.env.SEARCH_FAKE };
    delete process.env.EXA_API_KEY;
    delete process.env.SEARCH_FAKE;
    try {
      assert.deepEqual(await lookUp(maya, { query: "is costco open" }), { refused: "off", say: LOOK_UP_OFF });
    } finally {
      if (saved.key !== undefined) process.env.EXA_API_KEY = saved.key;
      if (saved.fake !== undefined) process.env.SEARCH_FAKE = saved.fake;
      setSearchClient(search);
    }
  });
});
