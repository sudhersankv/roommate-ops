// Pins and look-ups through the real pipeline (#78) against the dev DB, in a throwaway Group (Maya, Dev, Sam). No Jev
// and no model: the Gate and the agent run are faked (setPipelineFakes); the fake agent calls the real save_place /
// look_up tools. Search is FakeSearch, caps are in memory.
// Run: npx tsx --test src/pipeline-pin.dbtest.ts   (refuses the production branch)
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { devUserId } from "@/channels/dev";
import { FakeSearch, setSearchClient } from "@/integrations/search";
import { makeCaps, setCaps } from "@/lib/caps";
import { MemoryCounters } from "@/lib/window-limit";
import type { GateRun } from "@/mastra/gate";
import { onGroupJoined } from "@/onboarding";
import { askRoomie, mediaWantedFor, respondToIncoming, setPipelineFakes } from "@/pipeline";
import { deleteGroup } from "@/services/groups";
import type { Member } from "@/services/members";
import { getPlace } from "@/services/place";
import { allTools } from "@/toolkits/registry";
import { assertNotProdDb } from "../scripts/lib/prod-guard";

const ts = Date.now();
const chatId = `pin-${ts}`;
let groupId: string;
let maya: Member;

const acts: GateRun = { speak: true, decision: "act", reason: "hard-trigger", unprompted: false, mayStaySilent: false, jev: null, jevMs: 0 };
const agentSaw: string[] = [];

type ToolLike = { execute: (input: unknown, context: unknown) => Promise<unknown> };
const tool = (id: string) => (allTools() as unknown as Record<string, ToolLike>)[id];

/** Roomie's stand-in: a [location: lat,lng ...] on the line goes to save_place; "is ... open" goes to look_up. */
async function fakeAgent(line: string, { requestContext }: { requestContext: unknown }) {
  agentSaw.push(line);
  const pin = /\[location: (-?[\d.]+),(-?[\d.]+)/.exec(line);
  if (pin) {
    const result = await tool("save_place").execute({ lat: Number(pin[1]), lng: Number(pin[2]) }, { requestContext });
    return { text: "Saved.", steps: [{ toolCalls: [{ payload: { toolName: "save_place" } }], toolResults: [{ payload: { toolName: "save_place", result } }] }] };
  }
  const result = (await tool("look_up").execute({ query: line.replace(/^\[\w+\] /, "") }, { requestContext })) as { say: string };
  return { text: result.say, steps: [{ toolCalls: [{ payload: { toolName: "look_up" } }], toolResults: [{ payload: { toolName: "look_up", result } }] }] };
}

const mayaLines = async () =>
  (await db.select({ text: schema.chatMessages.text }).from(schema.chatMessages).where(and(eq(schema.chatMessages.groupId, groupId), eq(schema.chatMessages.memberId, maya.id))).orderBy(desc(schema.chatMessages.createdAt))).map((r) => r.text);

describe("pins and look-ups through the pipeline (#78)", () => {
  before(async () => {
    await assertNotProdDb(db, "pipeline-pin.dbtest");
    setCaps(makeCaps(new MemoryCounters()));
    setSearchClient(new FakeSearch());
    setPipelineFakes({ gate: async () => acts, agent: fakeAgent });
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`pin-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: chatId, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    maya = joined.members[0];
    await db.update(schema.groups).set({ onboardedAt: new Date() }).where(eq(schema.groups.id, groupId));
    // A quiet chat: no intro line from Roomie, so no follow-up window is open.
    await db.delete(schema.chatMessages).where(eq(schema.chatMessages.groupId, groupId));
  });

  after(async () => {
    setPipelineFakes(null);
    setSearchClient(null);
    setCaps(undefined);
    if (groupId) await deleteGroup(groupId);
  });

  test("a pin nobody addressed: not wanted, logged as '(location)' with no coordinates, no run", async () => {
    assert.equal(await mediaWantedFor({ channel: "dev", chatExternalId: chatId, userExternalId: maya.channelUserId!, kind: "location" }), false);
    const r = await respondToIncoming({ channel: "dev", chatExternalId: chatId, userExternalId: maya.channelUserId!, userName: "Maya", text: "", skippedMedia: "location" });
    assert.equal(r.out, null);
    assert.equal((await mayaLines())[0], "(location)");
    assert.equal(agentSaw.length, 0);
  });

  test("'roomie this is our place' with a pin: the line carries it, save_place saves it, the chat log keeps it", async () => {
    const r = await respondToIncoming({ channel: "dev", chatExternalId: chatId, userExternalId: maya.channelUserId!, userName: "Maya", text: "roomie this is our place", location: { lat: 41.943, lng: -87.6826, name: "Home" } });
    assert.equal(agentSaw.at(-1), `[Maya] [location: 41.943,-87.6826 name="Home"] roomie this is our place`);
    assert.deepEqual(r.toolCalls, ["save_place"]);
    assert.equal((await getPlace({ groupId }))?.lat, 41.943);
    assert.equal((await mayaLines())[0], `(location) [location: 41.943,-87.6826 name="Home"] roomie this is our place`);
  });

  test("a one-place look-up: the answer, its source as a button and the pin on the Outgoing", async () => {
    const r = await respondToIncoming({ channel: "dev", chatExternalId: chatId, userExternalId: maya.channelUserId!, userName: "Maya", text: "roomie is costco open till 9?" });
    assert.match(r.out?.text ?? "", /8:30 PM/);
    assert.equal(r.out?.buttons?.length, 1);
    assert.match(r.out!.buttons![0].url, /costco\.com/);
    assert.deepEqual(r.out?.location && [r.out.location.name, typeof r.out.location.lat], ["Costco Wholesale", "number"]);
  });

  test("the dashboard's Ask: the pin is a maps button there", async () => {
    const out = await askRoomie({ groupId, memberId: maya.id, source: "ui" }, "is costco open till 9?");
    assert.equal(out.location, undefined);
    assert.ok(out.buttons?.some((b) => b.text === "Costco Wholesale" && b.url.startsWith("https://www.google.com/maps/")));
  });
});
