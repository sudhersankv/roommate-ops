// Core slots against the Neon dev branch (#24A): the Bundle once per local day, the urgent slot and quiet hours with
// pending_posts, private nudges, Documents (receipts, forget me, delete group data, Pending Members) and the
// /api/docs/[id] route. Apt 4B: Maya (Admin), Dev and Sam, in Chicago; files go to a MemoryBlobStore.
// Run: npx tsx --test src/services/core-slots.dbtest.ts   (refuses the production branch)
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { registerChannel } from "@/channels";
import { DevChannel, devUserId, type DevOutput } from "@/channels/dev";
import { CantMessagePrivatelyError, type Outgoing, type Sent } from "@/channels/types";
import { MemoryBlobStore, setBlobStore } from "@/integrations/blob-store";
import { bundleJob } from "@/jobs/scheduler";
import { zonedParts, zonedTimeToUtc } from "@/lib/time";
import { inFollowUpWindow } from "@/mastra/gate/policy";
import { onGroupJoined } from "@/onboarding";
import { lastRoomieReplyAt, recentChatter, roomieLines } from "./chatlog";
import { deleteGroup, deleteGroupData, groupsWithChat, updateGroupSettings } from "./groups";
import * as documents from "./documents";
import { forgetMe } from "./members";
import { logExpense, updateExpense } from "./money";
import { sendNudge } from "./nudges";
import { saveUpload } from "./receipts";
import { setReminder } from "./reminders";
import { flushPendingPosts, postUrgent } from "./urgent";
import type { Ctx } from "./types";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

const CHI = "America/Chicago";
/** A MemoryBlobStore whose next `failDeletes` deletes are refused (object storage having a bad minute). */
const blobs = new (class extends MemoryBlobStore {
  failDeletes = 0;
  override async delete(key: string) {
    if (this.failDeletes > 0) {
      this.failDeletes--;
      throw new Error("storage 503");
    }
    return super.delete(key);
  }
})();
setBlobStore(blobs);
const outbox: DevOutput[] = [];
const devChannel = new DevChannel((o) => outbox.push(o));
registerChannel(devChannel);

/** The dev Channel, but private messages are refused (Telegram before Start) or every send fails (Roomie removed). */
class RefusingChannel extends DevChannel {
  constructor(private readonly mode: "no-dm" | "down") {
    super((o) => outbox.push(o));
  }
  override async sendPrivate(userExternalId: string, msg: Outgoing): Promise<Sent> {
    if (this.mode === "no-dm") throw new CantMessagePrivatelyError("Tap @roomie and press Start.");
    throw new Error("Forbidden: bot was kicked from the group chat");
  }
  override async sendToChat(chatExternalId: string, msg: Outgoing): Promise<Sent> {
    if (this.mode === "down") throw new Error("Forbidden: bot was kicked from the group chat");
    return super.sendToChat(chatExternalId, msg);
  }
}
async function withChannel<T>(channel: DevChannel, run: () => Promise<T>): Promise<T> {
  registerChannel(channel);
  try {
    return await run();
  } finally {
    registerChannel(devChannel);
  }
}

let groupId: string;
let otherGroupId: string;
let m: Record<"Maya" | "Dev" | "Sam" | "Priya", string>;
const ctxOf = (memberId: string): Ctx => ({ groupId, memberId, source: "chat" });

/** A local wall-clock time in Chicago, `dayOffset` days from today. */
const today = zonedParts(CHI, new Date());
const at = (hour: number, minute = 0, dayOffset = 0) => zonedTimeToUtc(CHI, { year: today.year, month: today.month, day: today.day + dayOffset, hour, minute });
const chatPosts = () => outbox.filter((o) => o.to === "chat");

describe("core slots against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "core-slots.dbtest");
    const ts = Date.now();
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`slots-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `slots-${ts}`, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    const ids = Object.fromEntries(joined.members.map((r) => [r.displayName, r.id]));
    const [priya] = await db.insert(schema.members).values({ groupId, displayName: "Priya", status: "pending", channelUserId: devUserId(`slots-priya-${ts}`) }).returning();
    m = { Maya: ids.Maya, Dev: ids.Dev, Sam: ids.Sam, Priya: priya.id };
    await updateGroupSettings(ctxOf(m.Maya), { purpose: "roommates", currency: "USD", timezone: CHI });
    const other = await onGroupJoined({ channel: "dev", externalId: `slots-other-${ts}`, title: `Lisbon trip ${ts}` }, [people[0]], people[0]);
    otherGroupId = other.group.id;
  });

  after(async () => {
    if (groupId) await deleteGroup(groupId);
    if (otherGroupId) await deleteGroup(otherGroupId);
    setBlobStore(null);
  });

  /* ---------- the Bundle ---------- */

  test("the Bundle: House's line, then core's Reminders line; claimed once across two ticks and two processes", async () => {
    await db.delete(schema.scheduledPosts).where(eq(schema.scheduledPosts.groupId, groupId));
    await setReminder(ctxOf(m.Maya), { text: "Trash goes out", dueAt: at(20) }, at(8));
    const [g] = await groupsWithChat(groupId);
    outbox.length = 0;
    assert.equal(await bundleJob(g, at(8, 30)), null, "before the nudge hour");
    const [a, b] = await Promise.all([bundleJob(g, at(9, 1)), bundleJob(g, at(9, 1))]);
    const text = a ?? b;
    assert.ok(!(a && b), "two processes in the same window: one posts");
    assert.match(text ?? "", /^🧹 On the chart today: .*\n⏰ Today: Trash goes out \(8 PM\)\.$/);
    assert.equal(await bundleJob(g, at(9, 40)), null, "a later tick in the same hour");
    assert.equal(chatPosts().length, 1);
    const claims = await db.select().from(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, groupId), eq(schema.scheduledPosts.kind, "bundle")));
    assert.equal(claims.length, 1);
  });

  test("the Bundle is logged as Roomie's chat line, so a 'yes' right after it is in the follow-up window", async () => {
    await db.delete(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, groupId), eq(schema.scheduledPosts.kind, "bundle")));
    await db.delete(schema.chatMessages).where(eq(schema.chatMessages.groupId, groupId));
    assert.equal(await lastRoomieReplyAt(groupId), null);
    const [g] = await groupsWithChat(groupId);
    const text = await bundleJob(g, at(9, 2));
    assert.ok(text, "the Bundle went out");
    const last = await lastRoomieReplyAt(groupId);
    assert.ok(last, "Roomie's line is logged");
    assert.equal(inFollowUpWindow({ lastRoomieAt: last, humanSinceRoomie: 1 }), true);
    assert.equal((await recentChatter(groupId)).at(-1), `[Roomie] ${text}`, "the agent sees it in the earlier chat");
    assert.equal(await bundleJob(g, at(9, 30)), null);
    assert.equal((await roomieLines(groupId)).length, 1, "logged once, with the post");
  });

  /* ---------- the urgent slot and quiet hours ---------- */

  test("urgent at 23:00 waits for 08:00, takes that morning's slot, and the flush delivers it once", async () => {
    await db.delete(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, groupId), eq(schema.scheduledPosts.kind, "urgent")));
    outbox.length = 0;
    const night = await postUrgent(groupId, "📬 Water's off tomorrow 9-12 (from the landlord).", at(23));
    assert.deepEqual(night, { posted: false, reason: "quiet", dueAt: at(8, 0, 1) });
    assert.equal(chatPosts().length, 0, "nothing at night");
    assert.equal(await flushPendingPosts(at(7, 59, 1)), 0, "07:59: still quiet");
    assert.equal(await flushPendingPosts(at(8, 0, 1)), 1);
    assert.equal(await flushPendingPosts(at(8, 1, 1)), 0, "once");
    assert.deepEqual(chatPosts().map((o) => o.msg.text), ["📬 Water's off tomorrow 9-12 (from the landlord)."]);
    assert.deepEqual(await postUrgent(groupId, "📬 Inspection today.", at(10, 0, 1)), { posted: false, reason: "claimed" }, "that day's slot is taken");
    assert.deepEqual(await postUrgent(groupId, "📬 Inspection tomorrow.", at(10, 0, 2)), { posted: true });
    assert.equal(chatPosts().length, 2);
  });

  test("a paused Group: no urgent post, no nudge, and held posts wait", async () => {
    await db.update(schema.groups).set({ pausedAt: new Date() }).where(eq(schema.groups.id, groupId));
    try {
      outbox.length = 0;
      assert.deepEqual(await postUrgent(groupId, "📬 Gas check.", at(11, 0, 5)), { posted: false, reason: "paused" });
      assert.deepEqual(await sendNudge(m.Dev, { text: "You owe Maya $24." }, at(11, 0, 5)), { sent: false, reason: "paused" });
      assert.equal(outbox.length, 0);
    } finally {
      await db.update(schema.groups).set({ pausedAt: null }).where(eq(schema.groups.id, groupId));
    }
  });

  test("sendNudge: quiet hours hold the DM until 08:00; 'stop nudging me' skips it", async () => {
    outbox.length = 0;
    const r = await sendNudge(m.Dev, { text: "You owe Maya $24." }, at(22, 30, 10));
    assert.deepEqual(r, { sent: false, reason: "quiet", dueAt: at(8, 0, 11) });
    assert.equal(await flushPendingPosts(at(8, 0, 11)), 1);
    assert.deepEqual(outbox.map((o) => [o.to, o.msg.text]), [["private", "You owe Maya $24."]]);
    assert.deepEqual(await sendNudge(m.Dev, { text: "Again" }, at(12, 0, 11)), { sent: true });
    await db.insert(schema.memberNotes).values({ memberId: m.Sam, note: { nudges: "off" } }).onConflictDoUpdate({ target: schema.memberNotes.memberId, set: { note: sql`${schema.memberNotes.note} || '{"nudges":"off"}'::jsonb` } });
    assert.deepEqual(await sendNudge(m.Sam, { text: "You owe Maya $10." }, at(12, 0, 11)), { sent: false, reason: "off" });
    assert.equal(outbox.length, 2);
  });

  test("a held DM to Dev, who never pressed Start: 08:00 posts the neutral Start line in the group, never the amount", async () => {
    outbox.length = 0;
    assert.equal((await sendNudge(m.Dev, { text: "You owe Maya $24." }, at(23, 0, 20))).sent, false);
    await withChannel(new RefusingChannel("no-dm"), () => flushPendingPosts(at(8, 0, 21)));
    assert.deepEqual(chatPosts().map((o) => o.msg.text), ["Dev, I've got something for you; open a chat with me and press Start."]);
    assert.ok(!outbox.some((o) => o.msg.text.includes("$24")), "the content stays private");
    assert.equal((await db.select().from(schema.pendingPosts).where(eq(schema.pendingPosts.memberId, m.Dev))).length, 0, "not held again");
  });

  test("a failed queue write gives the urgent slot back: the retry is held, not refused", async () => {
    await db.delete(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, groupId), eq(schema.scheduledPosts.kind, "urgent")));
    // Postgres refuses a NUL byte in text: the pending_posts insert fails after the claim.
    await assert.rejects(postUrgent(groupId, "📬 Water's off\u0000 tomorrow.", at(23, 0, 30)));
    const claims = await db.select().from(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, groupId), eq(schema.scheduledPosts.kind, "urgent")));
    assert.equal(claims.length, 0, "the slot is unclaimed");
    assert.deepEqual(await postUrgent(groupId, "📬 Water's off tomorrow 9-12.", at(23, 5, 30)), { posted: false, reason: "quiet", dueAt: at(8, 0, 31) });
    await db.delete(schema.pendingPosts).where(eq(schema.pendingPosts.groupId, groupId));
  });

  test("a held post that keeps failing is put back, then dropped once it's a day old", async () => {
    await db.delete(schema.pendingPosts).where(eq(schema.pendingPosts.groupId, groupId));
    await db.insert(schema.pendingPosts).values([
      { groupId, kind: "urgent", text: "📬 Fresh notice.", dueAt: at(8, 0, 40), createdAt: at(23, 0, 39) },
      { groupId, kind: "urgent", text: "📬 Old notice.", dueAt: at(8, 0, 40), createdAt: at(7, 0, 39) },
    ]);
    const sent = await withChannel(new RefusingChannel("down"), () => flushPendingPosts(at(9, 0, 40)));
    assert.equal(sent, 0);
    const left = await db.select().from(schema.pendingPosts).where(eq(schema.pendingPosts.groupId, groupId));
    assert.deepEqual(left.map((p) => [p.text, p.dueAt.getTime()]), [["📬 Fresh notice.", at(9, 5, 40).getTime()]], "the fresh one retries in 5 minutes; the 26-hour-old one is gone");
    await db.delete(schema.pendingPosts).where(eq(schema.pendingPosts.groupId, groupId));
  });

  /* ---------- Documents ---------- */

  test("a receipt saved through saveUpload is a Document and a blob; the Expense points at it", async () => {
    const photo = await saveUpload(`g-${groupId}`, Buffer.from("receipt jpeg"), "image/jpeg");
    assert.equal(photo.path, `/api/docs/${photo.id}`);
    assert.deepEqual(await blobs.get(`g/${groupId}/${photo.id}`), { bytes: Buffer.from("receipt jpeg"), contentType: "image/jpeg" });
    assert.equal((await documents.listDocuments({ groupId })).length, 0, "an unkept photo isn't on the Docs list");
    const e = await logExpense(ctxOf(m.Dev), { cents: 6000, description: "Luigi's", receiptUrl: photo.path });
    const [row] = await db.select().from(schema.expenses).where(eq(schema.expenses.id, e.id));
    assert.equal(row.receiptDocumentId, photo.id);
    const doc = (await documents.getDocument({ groupId }, photo.id))!;
    assert.deepEqual([doc.kind, doc.title, doc.source, doc.uploadedBy, doc.filed], ["receipt", "Receipt: Luigi's", { table: "expenses", id: e.id }, m.Dev, true]);
    assert.deepEqual((await documents.findDocuments({ groupId }, "luigi's receipt")).map((d) => d.id), [photo.id]);
    const same = await saveUpload(`g-${groupId}`, Buffer.from("receipt jpeg"), "image/jpeg", "tg-file-1");
    assert.equal((await saveUpload(`g-${groupId}`, Buffer.from("receipt jpeg"), "image/jpeg", "tg-file-1")).id, same.id, "the same Channel file is stored once");
  });

  test("a receipt belongs to one Expense: attaching it to another moves it, and the first loses it", async () => {
    const photo = await saveUpload({ groupId }, Buffer.from("pizza receipt"), "image/jpeg");
    const first = await logExpense(ctxOf(m.Dev), { cents: 4500, description: "Pizza", receiptUrl: photo.path });
    const second = await logExpense(ctxOf(m.Sam), { cents: 4500, description: "Pizza night", receiptUrl: photo.path });
    const row = async (id: string) => (await db.select().from(schema.expenses).where(eq(schema.expenses.id, id)))[0];
    assert.deepEqual([(await row(first.id)).receiptDocumentId, (await row(first.id)).receiptUrl], [null, null], "the first Expense lost it");
    assert.deepEqual([(await row(second.id)).receiptDocumentId, (await row(second.id)).receiptUrl], [photo.id, photo.path]);
    let doc = (await documents.getDocument({ groupId }, photo.id))!;
    assert.deepEqual([doc.title, doc.source], ["Receipt: Pizza night", { table: "expenses", id: second.id }]);

    await updateExpense(ctxOf(m.Dev), { expenseId: first.id, receiptUrl: photo.path });
    assert.equal((await row(first.id)).receiptDocumentId, photo.id, "moved back by an edit");
    assert.deepEqual([(await row(second.id)).receiptDocumentId, (await row(second.id)).receiptUrl], [null, null]);
    doc = (await documents.getDocument({ groupId }, photo.id))!;
    assert.deepEqual(doc.source, { table: "expenses", id: first.id });
  });

  test("the same photo sent again after it was deleted comes back as a Document", async () => {
    const sent = await saveUpload(`g-${groupId}`, Buffer.from("fridge shelf"), "image/jpeg", "tg-file-again", { uploadedBy: m.Dev });
    await documents.deleteDocument(ctxOf(m.Maya), sent.id);
    assert.equal(await documents.getDocument({ groupId }, sent.id), null);
    const again = await saveUpload(`g-${groupId}`, Buffer.from("fridge shelf, again"), "image/jpeg", "tg-file-again", { uploadedBy: m.Sam });
    assert.equal(again.id, sent.id, "the same stable id");
    const doc = (await documents.getDocument({ groupId }, again.id))!;
    assert.deepEqual([doc.kind, doc.filed, doc.uploadedBy, doc.size], ["photo", false, m.Sam, "fridge shelf, again".length]);
    assert.equal((await blobs.get(`g/${groupId}/${again.id}`))?.bytes.toString(), "fridge shelf, again");
  });

  test("a file the store won't delete keeps its row (soft-deleted) until a later delete gets it", async () => {
    const photo = await saveUpload({ groupId }, Buffer.from("blurry selfie"), "image/jpeg");
    const key = `g/${groupId}/${photo.id}`;
    const rowOf = async () => (await db.select().from(schema.documents).where(eq(schema.documents.id, photo.id)))[0];
    blobs.failDeletes = 1;
    assert.equal(await documents.deleteUnfiledByUrl(groupId, [photo.path]), 0);
    assert.ok((await rowOf())?.deletedAt, "the row stays, soft-deleted");
    assert.ok(await blobs.get(key), "the file is still there");
    assert.equal(await documents.getDocument({ groupId }, photo.id), null, "nobody sees it");
    // Retention, once the soft delete is 30 days old.
    await db.update(schema.documents).set({ deletedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) }).where(eq(schema.documents.id, photo.id));
    assert.ok((await documents.purgeOldDocuments()) >= 1);
    assert.equal(await rowOf(), undefined);
    assert.equal(await blobs.get(key), null);
  });

  test("keep and find: 'roomie keep this, it's the lease' files it; find returns it newest first; another Group's link is refused", async () => {
    const pdf = await saveUpload({ groupId }, Buffer.from("lease scan"), "image/png", undefined, { uploadedBy: m.Sam });
    const kept = await documents.keepDocument(ctxOf(m.Sam), { url: pdf.url || pdf.path, title: "Lease 2026-27", kind: "lease" });
    assert.deepEqual([kept.kind, kept.title, kept.filed], ["lease", "Lease 2026-27", true]);
    assert.deepEqual((await documents.findDocuments({ groupId }, "the lease")).map((d) => d.title), ["Lease 2026-27"]);
    const view = await documents.documentsView({ ctx: ctxOf(m.Maya) });
    assert.ok(view.some((v) => v.href === `/api/docs/${kept.id}` && v.kind === "lease"));
    assert.deepEqual(await documents.documentsView({ ctx: ctxOf(m.Priya) }), [], "a Pending Member sees none");
    const theirs = await saveUpload({ groupId: otherGroupId }, Buffer.from("their photo"), "image/jpeg");
    await assert.rejects(documents.keepDocument(ctxOf(m.Sam), { url: theirs.path }), /only keep photos and files sent in this group's chat/);
    const { readGroceryPhoto } = await import("./grocery-photos");
    await assert.rejects(readGroceryPhoto(theirs.path, groupId), /only read photos sent in this group's chat/);
  });

  test("readDocument refuses a Pending Member and serves an active one", async () => {
    const photo = await saveUpload({ groupId }, Buffer.from("wifi bill"), "image/jpeg");
    await assert.rejects(documents.readDocument(ctxOf(m.Priya), photo.id), /approve you first/);
    const read = await documents.readDocument(ctxOf(m.Maya), photo.id);
    assert.deepEqual([read?.bytes.toString(), read?.contentType], ["wifi bill", "image/jpeg"]);
  });

  test("/api/docs/[id]: 404 unknown, 403 for a non-Member and a Pending one, 200 with the content type for a Member", async () => {
    const { GET } = await import("@/app/api/docs/[id]/route");
    const { upsertAccount } = await import("./claims");
    const get = (id: string) => GET(new Request(`http://localhost/api/docs/${id}`), { params: Promise.resolve({ id }) });
    const photo = await saveUpload({ groupId }, Buffer.from("the lease"), "image/png");
    const ts = Date.now();
    const as = async (email: string, memberId?: string) => {
      process.env.DEV_AUTH_EMAIL = email;
      const account = await upsertAccount({ id: `dev:${email}`, email, name: email.split("@")[0] });
      if (memberId) await db.update(schema.members).set({ accountId: account.id }).where(eq(schema.members.id, memberId));
    };
    try {
      await as(`stranger-${ts}@example.com`);
      assert.equal((await get(crypto.randomUUID())).status, 404);
      assert.equal((await get(photo.id)).status, 403, "signed in, not a Member");
      await as(`priya-${ts}@example.com`, m.Priya);
      assert.equal((await get(photo.id)).status, 403, "Pending");
      await as(`maya-${ts}@example.com`, m.Maya);
      const ok = await get(photo.id);
      assert.equal(ok.status, 200);
      assert.equal(ok.headers.get("content-type"), "image/png");
      assert.match(ok.headers.get("cache-control") ?? "", /^private/);
      assert.equal(Buffer.from(await ok.arrayBuffer()).toString(), "the lease");
    } finally {
      delete process.env.DEV_AUTH_EMAIL;
      await db.update(schema.members).set({ accountId: null }).where(eq(schema.members.groupId, groupId));
      await db.delete(schema.accounts).where(sql`${schema.accounts.email} like ${`%-${ts}@example.com`}`);
    }
  });

  test("forget me: Sam's own photos go (row and file), his name comes off the lease", async () => {
    const mine = await saveUpload({ groupId }, Buffer.from("sam's selfie"), "image/jpeg", undefined, { uploadedBy: m.Sam });
    await documents.keepDocument(ctxOf(m.Sam), { url: mine.path });
    const lease = (await documents.findDocuments({ groupId }, "lease"))[0];
    assert.equal(lease.uploadedBy, m.Sam);
    await forgetMe(ctxOf(m.Sam));
    assert.equal(await documents.getDocument({ groupId }, mine.id), null);
    assert.equal(await blobs.get(`g/${groupId}/${mine.id}`), null);
    const after = (await documents.getDocument({ groupId }, lease.id))!;
    assert.deepEqual([after.title, after.uploadedBy], ["Lease 2026-27", null]);
  });

  test("delete group data empties the Group's Documents and their files", async () => {
    const keys = (await db.select({ k: schema.documents.storageKey }).from(schema.documents).where(eq(schema.documents.groupId, groupId))).map((r) => r.k);
    assert.ok(keys.length > 0);
    await deleteGroupData(ctxOf(m.Maya));
    assert.equal((await db.select().from(schema.documents).where(eq(schema.documents.groupId, groupId))).length, 0);
    for (const k of keys) assert.equal(await blobs.get(k), null, k);
    assert.ok((await db.select().from(schema.documents).where(eq(schema.documents.groupId, otherGroupId))).length > 0, "the other Group's stay");
  });
});
