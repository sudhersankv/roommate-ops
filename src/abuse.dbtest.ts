// DB-backed checks for the audit's abuse fixes (B3 caps, H1 pause, H2 media, H3 wa_contacts, H4 allowlist), against
// the dev DB in .env, in throwaway Groups. No LLM or Jev call: every path here stops before the model (the caps run on
// in-memory counters with the Jev budget already used up, so the Gate never calls Jev).
// Run: npx tsx --test src/abuse.dbtest.ts   (NEVER against production: check .env's DATABASE_URL first)
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { devUserId } from "@/channels/dev";
import { deleteContactFor, pruneNonMemberContacts } from "@/channels/whatsapp-store";
import { BREATHER_MEMBER, CAPS, makeCaps, setCaps } from "@/lib/caps";
import { pgCounters } from "@/lib/rate-counters";
import { MemoryCounters } from "@/lib/window-limit";
import { JoinRefusedError, onGroupJoined } from "@/onboarding";
import { mediaWantedFor, respond } from "@/pipeline";
import { logMessage } from "@/services/chatlog";
import { deleteGroup } from "@/services/groups";
import { listGroupsForOperator, pausedGroupIds, setGroupPaused } from "@/services/operator-groups";
import { whatsappAdmission } from "@/services/whatsapp-access";
import { assertNotProdDb } from "../scripts/lib/prod-guard";

const ts = Date.now();
const op = { email: "operator@example.com" };
let groupId: string;
let admin: { id: string; displayName: string; role: "admin" | "member"; status: "active" | "pending" | "removed" };
let sam: typeof admin;
let samExternal: string;
const lastLine = async () => (await db.select({ text: schema.chatMessages.text }).from(schema.chatMessages).where(eq(schema.chatMessages.groupId, groupId)).orderBy(desc(schema.chatMessages.createdAt)).limit(1))[0]?.text;
const chat = (member: typeof admin, text: string, extra: Partial<Parameters<typeof respond>[0]> = {}) => respond({ groupId, member, text, source: "chat", channel: "dev", ...extra });

describe("abuse fixes against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "abuse.dbtest");
    const people = ["Maya", "Sam"].map((name) => ({ userExternalId: devUserId(`abuse-${name}-${ts}`), name }));
    samExternal = people[1].userExternalId;
    const joined = await onGroupJoined({ channel: "dev", externalId: `abuse-${ts}`, title: `Abuse test ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    [admin, sam] = joined.members;
  });

  after(async () => {
    setCaps(undefined);
    if (groupId) await deleteGroup(groupId);
    await db.delete(schema.rateCounters).where(eq(schema.rateCounters.key, `test:${ts}`));
  });

  test("rate_counters: fixed-window counts, nothing past the max", async () => {
    const start = new Date(Math.floor(Date.now() / 60_000) * 60_000);
    assert.equal(await pgCounters.hit(`test:${ts}`, start, 2), true);
    assert.equal(await pgCounters.hit(`test:${ts}`, start, 2), true);
    assert.equal(await pgCounters.hit(`test:${ts}`, start, 2), false);
    assert.equal(await pgCounters.count(`test:${ts}`, start), 2);
  });

  test("a voice note nobody addressed is logged as (voice note) and goes no further", async () => {
    const r = await chat(sam, "", { skippedMedia: "voice" });
    assert.equal(r.out, null);
    assert.equal(r.gate.reason, "media");
    assert.equal(await lastLine(), "(voice note)");
    const p = await chat(sam, "", { skippedMedia: "photo" });
    assert.equal(p.gate.reason, "media");
    assert.equal(await lastLine(), "(photo)");
  });

  test("mediaWantedFor: setup pending for the Admin, the follow-up window for others", async () => {
    const q = (userExternalId: string) => ({ channel: "dev" as const, chatExternalId: `abuse-${ts}`, userExternalId, kind: "voice" as const });
    await logMessage(groupId, null, "Roomie said something");
    assert.equal(await mediaWantedFor(q(samExternal)), true, "right after Roomie spoke");
    for (let i = 0; i < 4; i++) await logMessage(groupId, sam.id, `chatter ${i}`);
    assert.equal(await mediaWantedFor(q(samExternal)), false, "the window closed");
    assert.equal(await mediaWantedFor(q(devUserId(`abuse-Maya-${ts}`))), true, "setup is waiting on the Admin");
    assert.equal(await mediaWantedFor({ ...q(samExternal), kind: "photo", caption: "roomie split this" }), true);
    assert.equal(await mediaWantedFor(q("dev:nobody")), false, "not a Member");
  });

  test("a paused Group: the line is logged (cut to 2,000 characters), Roomie stays quiet; the scheduler skips it", async () => {
    assert.equal(await setGroupPaused(op, groupId, true), true);
    assert.ok((await pausedGroupIds()).has(groupId));
    const r = await chat(admin, `roomie ${"x".repeat(5000)}`);
    assert.equal(r.out, null);
    assert.equal(r.gate.reason, "paused");
    assert.equal((await lastLine())?.length, 2000);
    const addressedPhoto = { channel: "dev" as const, chatExternalId: `abuse-${ts}`, userExternalId: samExternal, kind: "photo" as const, caption: "roomie split this", mentionsRoomie: true };
    assert.equal(await mediaWantedFor(addressedPhoto), false, "a paused Group's media isn't fetched, addressed or not");
    const list = await listGroupsForOperator(op, { perPage: 500 });
    assert.ok(list.total >= 1 && list.paused >= 1);
    const row = list.rows.find((g) => g.id === groupId);
    assert.ok(row?.pausedAt);
    assert.equal(row?.members, 2);
    await assert.rejects(() => setGroupPaused(null, groupId, false), /people who run Roomie/);
    assert.equal(await setGroupPaused(op, groupId, false), true);
    assert.ok(!(await pausedGroupIds()).has(groupId));
    const acts = await db.select({ kind: schema.activity.kind }).from(schema.activity).where(eq(schema.activity.groupId, groupId));
    assert.ok(acts.some((a) => a.kind === "group.paused") && acts.some((a) => a.kind === "group.resumed"));
  });

  test("over the Member's daily cap: the breather once, then silence; no model call", async () => {
    const store = new MemoryCounters();
    const caps = makeCaps(store);
    for (let i = 0; i < CAPS.jevDay.max; i++) await caps.jev(groupId); // Jev's budget gone too: the Gate makes no call
    for (let i = 0; i < CAPS.memberDay.max; i++) await caps.run(`other-${i}-${groupId}`, admin.id);
    setCaps(caps);
    const first = await chat(admin, "roomie hi");
    assert.equal(first.capped, "member");
    assert.equal(first.out?.text.toLowerCase(), BREATHER_MEMBER.toLowerCase(), "about them, not 'Roomie is gone for everyone'");
    const second = await chat(admin, "roomie hi again");
    assert.equal(second.capped, "member");
    assert.equal(second.out, null, "once a day per Member");
    setCaps(undefined);
  });

  test("new Groups per adder: past the cap, no Group or Chat is created", async () => {
    const externalId = `abuse-refused-${ts}`;
    await assert.rejects(
      () => onGroupJoined({ channel: "telegram", externalId, title: "Refused" }, [], { userExternalId: `tg-${ts}`, name: "Spammer" }, { newGroupAllowed: async () => false }),
      (e: unknown) => e instanceof JoinRefusedError,
    );
    assert.equal((await db.select().from(schema.chats).where(and(eq(schema.chats.channel, "telegram"), eq(schema.chats.externalId, externalId)))).length, 0);
  });

  test("wa_contacts: a non-Member's row is counted by the prune (dry run) and deleteContactFor removes it", async () => {
    const lid = `99${ts}@lid`;
    await db.insert(schema.waContacts).values({ lid, pn: `1555${String(ts).slice(-7)}@s.whatsapp.net`, name: "Stranger" });
    const dry = await pruneNonMemberContacts({ dryRun: true });
    assert.ok(dry.stale >= 1 && dry.deleted === 0);
    assert.equal(await deleteContactFor(lid), 1);
    assert.equal(await deleteContactFor(lid), 0);
  });

  test("the WhatsApp allowlist: WHATSAPP_ALLOWED_ADDERS numbers only, once it's set", async () => {
    const before = process.env.WHATSAPP_ALLOWED_ADDERS;
    try {
      process.env.WHATSAPP_ALLOWED_ADDERS = "15551230000";
      assert.deepEqual(await whatsappAdmission({ userExternalId: "15551230000@s.whatsapp.net" }), { ok: true });
      const no = await whatsappAdmission({ userExternalId: "15559870000@s.whatsapp.net" });
      assert.equal(no.ok, false);
      assert.equal((await whatsappAdmission({ userExternalId: "8800001@lid" })).ok, false, "a hidden number isn't on any list");
    } finally {
      if (before === undefined) delete process.env.WHATSAPP_ALLOWED_ADDERS;
      else process.env.WHATSAPP_ALLOWED_ADDERS = before;
    }
  });
});
