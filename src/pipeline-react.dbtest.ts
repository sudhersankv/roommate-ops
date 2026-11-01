// Reactions (#77) through the real pipeline against the dev DB, in a throwaway Group (Maya, Dev, Sam). No Jev and no
// model: the Gate acts and a fake agent calls the real tools (log_chore, settle_up), then answers what the skills say.
// The record is made either way; only how Roomie answers changes.
// Run: npx tsx --test src/pipeline-react.dbtest.ts   (NEVER against production: check .env's DATABASE_URL first)
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { devUserId } from "@/channels/dev";
import { makeCaps, setCaps } from "@/lib/caps";
import { MemoryCounters } from "@/lib/window-limit";
import type { GateRun } from "@/mastra/gate";
import { onGroupJoined } from "@/onboarding";
import { askRoomie, respondToIncoming, setPipelineFakes } from "@/pipeline";
import { chores, money } from "@/services";
import { deleteGroup } from "@/services/groups";
import type { Member } from "@/services/members";
import { allTools } from "@/toolkits/registry";
import { assertNotProdDb } from "../scripts/lib/prod-guard";

const ts = Date.now();
const chatId = `react-${ts}`;
let groupId: string;
let maya: Member;
let dev: Member;

const acts: GateRun = { speak: true, decision: "act", reason: "hard-trigger", unprompted: false, mayStaySilent: false, jev: null, jevMs: 0 };

/** What the fake agent does next: which tool with what input, and what it answers. */
let plan: { tool: string; input: unknown; reply: string }[] = [];

async function fakeAgent(_line: string, { requestContext }: { requestContext: unknown }) {
  const steps = [];
  let text = "";
  for (const p of plan) {
    const tool = (allTools() as Record<string, unknown>)[p.tool] as { execute: (input: unknown, context: unknown) => Promise<unknown> };
    const result = await tool.execute(p.input, { requestContext }).catch((e: Error) => ({ error: e.message }));
    steps.push({ toolCalls: [{ payload: { toolName: p.tool } }], toolResults: [{ payload: { toolName: p.tool, result } }] });
    text = p.reply;
  }
  steps.push({ text });
  return { text, steps };
}

const from = (m: Member, text: string) => respondToIncoming({ channel: "dev", chatExternalId: chatId, userExternalId: m.channelUserId!, userName: m.displayName, text, messageExternalId: `m-${Math.random()}` });
const roomieLines = async () =>
  (await db.select({ text: schema.chatMessages.text }).from(schema.chatMessages).where(and(eq(schema.chatMessages.groupId, groupId), isNull(schema.chatMessages.memberId))).orderBy(desc(schema.chatMessages.createdAt))).map((r) => r.text);

describe("reactions through the pipeline (#77)", () => {
  before(async () => {
    await assertNotProdDb(db, "pipeline-react.dbtest");
    setCaps(makeCaps(new MemoryCounters()));
    setPipelineFakes({ gate: async () => acts, agent: fakeAgent });
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`react-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: chatId, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    [maya, dev] = joined.members;
    await db.update(schema.groups).set({ onboardedAt: new Date() }).where(eq(schema.groups.id, groupId));
    await chores.addChore({ groupId, memberId: maya.id, source: "chat" }, { name: "Take out trash", everyDays: 3 });
  });

  after(async () => {
    setPipelineFakes(null);
    setCaps(undefined);
    if (groupId) await deleteGroup(groupId);
  });

  test("'trash done' with [react]: the chore is logged and the answer is a ✅ on the message, no text", async () => {
    plan = [{ tool: "log_chore", input: { chore: "trash" }, reply: "[react]" }];
    const r = await from(dev, "roomie trash done");
    assert.deepEqual(r.out, { text: "", react: "✅" });
    assert.equal((await chores.choreStatus({ groupId })).find((c) => /trash/i.test(c.name))?.lastDoneBy, "Dev", "the record is made");
    assert.equal((await roomieLines())[0], "(reacted ✅)", "logged as Roomie's line");
  });

  test("a bare 'Done.' after a plain done is the reaction too; words with something in them are sent", async () => {
    plan = [{ tool: "log_chore", input: { chore: "trash" }, reply: "Done." }];
    assert.deepEqual((await from(maya, "roomie took out the trash")).out, { text: "", react: "✅" });
    plan = [{ tool: "log_chore", input: { chore: "trash" }, reply: "Trash done. Sam's up next." }];
    assert.deepEqual((await from(maya, "roomie trash done")).out, { text: "Trash done. Sam's up next." });
  });

  test("a chore new to the chart offers no reaction: [react] there is the plain 👍 line", async () => {
    plan = [{ tool: "log_chore", input: { chore: "mop the floors" }, reply: "[react]" }];
    const r = await from(dev, "roomie mopped the floors");
    assert.equal(r.out?.react, undefined);
    assert.equal(r.out?.text, "👍");
  });

  test("a payment that leaves the two square: 👍; one that leaves money owed must be said", async () => {
    await money.logExpense({ groupId, memberId: maya.id, source: "chat" }, { cents: 6000, description: "internet", category: "utilities" });
    plan = [{ tool: "settle_up", input: { with: "Maya", paid: true, amount: 5 }, reply: "[react]" }];
    const partial = await from(dev, "roomie paid Maya 5");
    assert.equal(partial.out?.react, undefined, "$15 still owed: no reaction");
    plan = [{ tool: "settle_up", input: { with: "Maya", paid: true, amount: 15 }, reply: "[react]" }];
    const square = await from(dev, "roomie paid Maya back the rest");
    assert.equal(square.out?.react, "👍");
  });

  test("a failed write never reacts", async () => {
    plan = [{ tool: "settle_up", input: { with: "Nobody", paid: true, amount: 5 }, reply: "[react]" }];
    const r = await from(dev, "roomie paid nobody");
    assert.equal(r.out?.react, undefined);
  });

  test("a streak milestone: the reaction plus the cheer as the line (Maya's third trash in a row)", async () => {
    plan = [{ tool: "log_chore", input: { chore: "trash" }, reply: "[react]" }];
    const r = await from(maya, "roomie trash done again");
    assert.equal(r.out?.react, "✅");
    assert.match(r.out?.text ?? "", /3/, `the streak line: ${r.out?.text}`);
  });

  test("the dashboard can't react: the emoji comes back as the answer's text", async () => {
    await chores.addChore({ groupId, memberId: maya.id, source: "chat" }, { name: "Dishes", everyDays: 1 });
    plan = [{ tool: "log_chore", input: { chore: "dishes" }, reply: "[react]" }];
    const out = await askRoomie({ groupId, memberId: dev.id, source: "ui" }, "did the dishes");
    assert.deepEqual(out, { text: "✅" });
  });
});
