// A captioned photo nobody addressed to Roomie (#40), through the real pipeline against the dev DB, in a throwaway
// Group (Apt 4B: Maya, Sreyas, Dev). No Jev and no model: the Gate's decision and the agent run are faked
// (setPipelineFakes); the fake agent calls the real receipt tool with whatever photo link it was given. The "adapter"
// here is a fake Channel message whose late fetch asks mediaWantedFor again, as the real adapters do.
// Run: npx tsx --test src/pipeline-photo.dbtest.ts   (NEVER against production: check .env's DATABASE_URL first)
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { devUserId } from "@/channels/dev";
import type { IncomingMessage } from "@/channels/types";
import { MemoryBlobStore, setBlobStore } from "@/integrations/blob-store";
import { makeCaps, setCaps } from "@/lib/caps";
import { MemoryCounters } from "@/lib/window-limit";
import type { GateRun } from "@/mastra/gate";
import { onGroupJoined } from "@/onboarding";
import { mediaWantedFor, respondToIncoming, setPipelineFakes } from "@/pipeline";
import { deleteGroup } from "@/services/groups";
import type { Member } from "@/services/members";
import { SAMPLE_RECEIPT, saveUpload, setReceiptReader } from "@/services/receipts";
import { allTools } from "@/toolkits/registry";
import { assertNotProdDb } from "../scripts/lib/prod-guard";

const ts = Date.now();
const chatId = `photo-${ts}`;
let groupId: string;
let sreyas: Member;

const acts: GateRun = { speak: true, decision: "act", reason: "jev-act", unprompted: true, mayStaySilent: false, jev: null, jevMs: 0 };
const staysQuiet: GateRun = { speak: false, decision: "ignore", reason: "jev-ignore", unprompted: false, mayStaySilent: false, jev: null, jevMs: 0 };

let gateSaid: GateRun = acts;
const gateSawPhoto: boolean[] = [];
const agentSaw: { line: string; earlier: string[] }[] = [];
let fetched = 0;

/** Roomie's stand-in: the newest "[photo: <url>]" it was given (this message first, then the chat) goes to the receipt tool. */
async function fakeAgent(line: string, { requestContext, earlier }: { requestContext: unknown; earlier: string[] }) {
  agentSaw.push({ line, earlier });
  const url = /\[photo: ([^\]\s]+)\]/.exec([line, ...earlier.slice().reverse()].join("\n"))?.[1];
  if (!url) return { text: "I can't see the photo." };
  const tool = allTools().expense_from_receipt as unknown as { execute: (input: unknown, context: unknown) => Promise<{ total: string }> };
  const result = await tool.execute({ receipt_url: url }, { requestContext });
  return {
    text: `That bill is ${result.total}. Split it?`,
    steps: [{ toolCalls: [{ payload: { toolName: "expense_from_receipt" } }], toolResults: [{ payload: { toolName: "expense_from_receipt", result } }] }],
  };
}

/** A photo with a caption, as an adapter passes one it skipped: its late fetch asks the pipeline again first. */
function skippedPhoto(caption: string): IncomingMessage {
  const q = { channel: "dev" as const, chatExternalId: chatId, userExternalId: sreyas.channelUserId!, kind: "photo" as const, caption };
  return {
    channel: "dev",
    chatExternalId: chatId,
    userExternalId: sreyas.channelUserId!,
    userName: "Sreyas",
    text: caption,
    skippedMedia: "photo",
    fetchSkippedPhoto: async () => {
      if (!(await mediaWantedFor({ ...q, gateActed: true }))) return null;
      fetched++;
      return (await saveUpload({ groupId }, Buffer.from(`photo ${fetched}`), "image/jpeg")).url;
    },
  };
}

const sreyasLines = async () =>
  (await db.select({ text: schema.chatMessages.text }).from(schema.chatMessages).where(and(eq(schema.chatMessages.groupId, groupId), eq(schema.chatMessages.memberId, sreyas.id))).orderBy(desc(schema.chatMessages.createdAt))).map((r) => r.text);
const documents = async () => Number((await db.select({ n: sql<number>`count(*)::int` }).from(schema.documents).where(eq(schema.documents.groupId, groupId)))[0].n);

describe("a captioned photo is seen when Roomie answers its caption (#40)", () => {
  before(async () => {
    await assertNotProdDb(db, "pipeline-photo.dbtest");
    setBlobStore(new MemoryBlobStore());
    setCaps(makeCaps(new MemoryCounters()));
    setReceiptReader({ read: async () => SAMPLE_RECEIPT });
    setPipelineFakes({
      gate: async (input) => {
        gateSawPhoto.push(!!input.hasPhoto);
        return gateSaid;
      },
      agent: fakeAgent,
    });
    const people = ["Maya", "Sreyas", "Dev"].map((name) => ({ userExternalId: devUserId(`photo-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: chatId, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    sreyas = joined.members[1];
    // A quiet chat: no intro line from Roomie, so no follow-up window is open (the photo really is unaddressed).
    await db.delete(schema.chatMessages).where(eq(schema.chatMessages.groupId, groupId));
  });

  after(async () => {
    setPipelineFakes(null);
    setCaps(undefined);
    setReceiptReader(null);
    setBlobStore(null);
    if (groupId) await deleteGroup(groupId);
  });

  test("a photo the Gate stays quiet on is never fetched: the caption is logged, nothing is stored", async () => {
    gateSaid = staysQuiet;
    const msg = skippedPhoto("look at this sunset");
    assert.equal(await mediaWantedFor({ channel: "dev", chatExternalId: chatId, userExternalId: sreyas.channelUserId!, kind: "photo", caption: msg.text }), false, "the adapter's first ask: no");
    const r = await respondToIncoming(msg);
    assert.equal(r.out, null);
    assert.equal(fetched, 0);
    assert.equal(await documents(), 0);
    assert.equal((await sreyasLines())[0], "(photo) look at this sunset");
    assert.equal(agentSaw.length, 0);
  });

  test("'Your bill sreyas, you owe' (no 'roomie'): the Gate acts, the photo is fetched, and it reaches the receipt tool", async () => {
    gateSaid = acts;
    const r = await respondToIncoming(skippedPhoto("Your bill sreyas, you owe"));
    assert.equal(fetched, 1, "fetched once the Gate decided to answer");
    assert.equal(gateSawPhoto.at(-1), true, "the Gate knows a photo came with it (its tools stay wide)");
    assert.deepEqual(r.toolCalls, ["expense_from_receipt"]);
    assert.equal(r.out?.text, "That bill is $137.97. Split it?");
    const url = /\[photo: ([^\]\s]+)\]/.exec(agentSaw.at(-1)!.line)?.[1];
    assert.ok(url, "the agent's line carries the photo");
    assert.equal(agentSaw.at(-1)!.line, `[Sreyas] [photo: ${url}] Your bill sreyas, you owe`);
    assert.equal((await sreyasLines())[0], `(photo) [photo: ${url}] Your bill sreyas, you owe`, "the chat log keeps the link");
  });

  test("'I paid for that' right after: the photo's link is in the recent chat, so it reaches the receipt tool again", async () => {
    const r = await respondToIncoming({ channel: "dev", chatExternalId: chatId, userExternalId: sreyas.channelUserId!, userName: "Sreyas", text: "I paid for that" });
    assert.deepEqual(r.toolCalls, ["expense_from_receipt"]);
    assert.notEqual(r.out?.text, "I can't see the photo.");
    assert.ok(agentSaw.at(-1)!.earlier.some((l) => /^\[Sreyas\] \(photo\) \[photo: \S+\] Your bill sreyas, you owe$/.test(l)));
    assert.equal(fetched, 1, "nothing new fetched");
  });
});
