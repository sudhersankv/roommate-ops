// The Lease Inbox services against the Neon dev branch, with FakeMail and a fake classifier (no AgentMail, no model).
// Run: npx tsx --test src/services/lease-inbox.dbtest.ts   (not *.test.ts: `npm test` runs without .env)
//
// Isolation: a throwaway roommates Group (Maya the Admin, Dev, Sam) made through Onboarding on the dev Channel, plus
// an Account for Maya so her forwards are recognised; `after` deletes the Group and the Account.
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { devUserId } from "@/channels/dev";
import { onGroupJoined } from "@/onboarding";
import { deleteGroup, deleteGroupData } from "@/services/groups";
import { NotAllowedError } from "@/services/authz";
import type { Ctx } from "@/services/types";
import { FakeMail, setMailClient } from "@/integrations/mail";
import * as leaseInbox from "./lease-inbox";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

const LANDLORD = "Brookfield Residential Leasing <leasing@brookfieldresidential.com>";

const INSPECTION_FORWARD = `fyi

---------- Forwarded message ---------
From: ${LANDLORD}
Date: Tue, Oct 27, 2026 at 3:14 PM
Subject: Annual Unit Inspection - November 3
To: <maya.rao@gmail.com>

Dear Resident,

Our maintenance team will complete the annual smoke detector inspection in your unit on Tuesday, November 3
between 9:00 AM and 12:00 PM.
`;

let mail: FakeMail;
let groupId: string;
let accountId: string;
let maya: Ctx;
let dev: Ctx;
let sam: Ctx;
let inboxId: string;
let mayaEmail: string;
const classified: leaseInbox.Classification[] = [];
/** The thread of Maya's forward from the concierge (replies to it go to the concierge, not to Maya). */
let forwardThread: string;

/** The fake classifier answers from a queue the test fills; every call is recorded. */
const nextClassifications: leaseInbox.Classification[] = [];
const fakeClassifier: leaseInbox.MailClassifier = {
  async classify(input) {
    const c = nextClassifications.shift();
    if (!c) throw new Error(`unexpected classify call: ${input.subject}`);
    classified.push(c);
    return c;
  },
};

describe("Lease Inbox services against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "lease-inbox dbtest");
    mail = new FakeMail();
    setMailClient(mail);
    leaseInbox.setClassifier(fakeClassifier);
    const ts = Date.now();
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`lease-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `test-lease-${ts}`, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    await db.update(schema.groups).set({ timezone: "America/Chicago" }).where(eq(schema.groups.id, groupId));
    const id = (n: string) => joined.members.find((m) => m.displayName === n)!.id;
    maya = { groupId, memberId: id("Maya"), source: "chat" };
    dev = { groupId, memberId: id("Dev"), source: "chat" };
    sam = { groupId, memberId: id("Sam"), source: "chat" };
    mayaEmail = `maya.rao.${ts}@gmail.com`;
    const [acc] = await db.insert(schema.accounts).values({ authUserId: `lease-test-${ts}`, email: mayaEmail, name: "Maya Rao" }).returning();
    accountId = acc.id;
    await db.update(schema.members).set({ accountId }).where(eq(schema.members.id, maya.memberId));
  });

  after(async () => {
    if (groupId) await deleteGroup(groupId);
    setMailClient(null);
    leaseInbox.setClassifier(null);
    if (accountId) await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId));
    if (groupId) {
      for (const t of [schema.groupInboxes, schema.mailMessages, schema.landlordSenders, schema.workOrders, schema.sentMail, schema.mailEvents]) {
        assert.equal((await db.select().from(t).where(eq(t.groupId, groupId))).length, 0, "leftover Lease Inbox rows");
      }
    }
  });

  const deliver = async (input: Parameters<FakeMail["receive"]>[1], labels?: string[]) => {
    const m = mail.receive(inboxId, input);
    if (labels) m.labels = labels;
    return { m, result: await leaseInbox.storeInbound(groupId, m) };
  };
  const senders = async () => (await db.select({ value: schema.landlordSenders.value }).from(schema.landlordSenders).where(eq(schema.landlordSenders.groupId, groupId))).map((r) => r.value).sort();

  test("teach: the inbox is provisioned once; asking again is a no-op", async () => {
    const first = await leaseInbox.ensureInbox(maya);
    assert.equal(first.created, true);
    assert.match(first.address, /^apt-4b-\d+-[a-z0-9]{4}@agentmail\.to$/);
    inboxId = first.inboxId;
    const again = await leaseInbox.ensureInbox(dev);
    assert.deepEqual({ ...again, created: false }, again);
    assert.equal(again.address, first.address);
    assert.equal((await db.select().from(schema.groupInboxes).where(eq(schema.groupInboxes.groupId, groupId))).length, 1);
    assert.equal(mail.inboxes.size, 1);
  });

  test("a forwarded notice from someone who isn't a Member: stored, not trusted, filed as new-sender", async () => {
    const { result } = await deliver({ from: "Dana Okafor <dana.okafor@yahoo.com>", subject: "Fwd: Annual Unit Inspection - November 3", text: INSPECTION_FORWARD });
    assert.equal(result.stored, true);
    assert.equal(result.duplicate, false);
    assert.equal(result.sender, "leasing@brookfieldresidential.com");
    assert.equal(result.trusted, false);
    const [row] = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, result.id!));
    assert.equal(row.class, "new-sender");
    assert.equal(row.originalFrom, "leasing@brookfieldresidential.com");
    assert.equal(row.forwardedBy, null);
    const out = await leaseInbox.classifyInbound(groupId, result.id!);
    assert.equal(out.class, "new-sender");
    assert.equal(out.adminAsk, 'leasing@brookfieldresidential.com emailed about "Annual Unit Inspection - November 3": is that your building?');
    assert.equal(classified.length, 0, "an untrusted sender is never classified");
  });

  test("after trustSender (an Admin's yes), the whole domain is trusted", async () => {
    const yes = await leaseInbox.trustSender(maya, "leasing@brookfieldresidential.com", "admin");
    assert.equal(yes.line, "I'll treat brookfieldresidential.com as the landlord from now on.");
    assert.equal(await leaseInbox.isTrusted(groupId, "leasing@brookfieldresidential.com"), true);
    assert.equal(await leaseInbox.isTrusted(groupId, "Work Orders <WorkOrders@BrookfieldResidential.com>"), true);
    assert.equal(await leaseInbox.isTrusted(groupId, "leasing@brookfield-scam.com"), false);
    const { result } = await deliver({ from: "Dana Okafor <dana.okafor@yahoo.com>", subject: "Fwd: Annual Unit Inspection - November 3", text: INSPECTION_FORWARD });
    assert.equal(result.trusted, true);
  });

  test("only an Admin trusts a sender by hand", async () => {
    await assert.rejects(leaseInbox.trustSender(dev, "brookfieldresidential.com", "admin"), NotAllowedError);
  });

  test("a free-mail sender trusts only that address, never gmail.com", async () => {
    await leaseInbox.trustSender(maya, "Landlord Bob <bob.landlord@gmail.com>", "admin");
    assert.equal(await leaseInbox.isTrusted(groupId, "bob.landlord@gmail.com"), true);
    assert.equal(await leaseInbox.isTrusted(groupId, "someone.else@gmail.com"), false);
    await db.delete(schema.landlordSenders).where(and(eq(schema.landlordSenders.groupId, groupId), eq(schema.landlordSenders.value, "bob.landlord@gmail.com")));
  });

  test("a Member's own forward teaches the landlord (source: forward)", async () => {
    const { m, result } = await deliver({
      from: `Maya Rao <${mayaEmail}>`,
      subject: "Fwd: Package room hours",
      text: `---------- Forwarded message ---------\nFrom: Brookfield Concierge <concierge@brookfieldmgmt.com>\nSubject: Package room hours\n\nClosed at 6pm this week.`,
    });
    assert.equal(result.trusted, true);
    const [row] = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, result.id!));
    assert.equal(row.forwardedBy, maya.memberId);
    assert.equal(row.replyTo, "concierge@brookfieldmgmt.com", "replies go to whoever wrote it, not to Maya");
    const [sender] = await db
      .select()
      .from(schema.landlordSenders)
      .where(and(eq(schema.landlordSenders.groupId, groupId), eq(schema.landlordSenders.value, "brookfieldmgmt.com")));
    assert.equal(sender.source, "forward");
    forwardThread = m.threadId;
  });

  test("a spoofed forward (Maya's address on the envelope, labelled unauthenticated) teaches nothing: a new sender", async () => {
    const before = await senders();
    const { result } = await deliver(
      {
        from: `Maya Rao <${mayaEmail}>`,
        subject: "Fwd: Updated payment portal",
        text: `---------- Forwarded message ---------\nFrom: Brookfield Payments <payments@brookfield-rent-portal.com>\nSubject: Updated payment portal\n\nPlease pay this month's rent at our new portal.`,
      },
      ["received", "unauthenticated"],
    );
    assert.deepEqual([result.stored, result.trusted, result.sender], [true, false, "payments@brookfield-rent-portal.com"]);
    assert.deepEqual(await senders(), before, "landlord_senders unchanged");
    const [row] = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, result.id!));
    assert.deepEqual([row.class, row.forwardedBy], ["new-sender", null]);
  });

  test("the same email twice: a duplicate pointing at the one row", async () => {
    const m = mail.receive(inboxId, { from: LANDLORD, subject: "Pool closing Sunday", text: "The pool closes for the season on Sunday." });
    const a = await leaseInbox.storeInbound(groupId, m);
    const b = await leaseInbox.storeInbound(groupId, m);
    assert.deepEqual([a.duplicate, b.duplicate, b.stored], [false, true, false]);
    assert.equal(b.id, a.id);
    const rows = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.groupId, groupId), eq(schema.mailMessages.messageId, m.messageId)));
    assert.equal(rows.length, 1);
  });

  test("an event_id: fresh, busy while it runs, taken again after 10 minutes unprocessed, done once finished", async () => {
    const t0 = new Date("2026-11-02T16:00:00Z");
    const later = (min: number) => new Date(t0.getTime() + min * 60_000);
    assert.equal(await leaseInbox.claimMailEvent(groupId, "evt-pool-1", t0), "fresh");
    assert.equal(await leaseInbox.claimMailEvent(groupId, "evt-pool-1", later(3)), "busy");
    assert.equal(await leaseInbox.claimMailEvent(groupId, "evt-pool-1", later(11)), "retry");
    assert.equal(await leaseInbox.claimMailEvent(groupId, "evt-pool-1", later(12)), "busy", "the retry holds it now");
    await leaseInbox.finishMailEvent("evt-pool-1", later(13));
    assert.equal(await leaseInbox.claimMailEvent(groupId, "evt-pool-1", later(40)), "done");
  });

  test("a dated notice: one line, the evening-before Reminder time, urgent inside 72 hours, hooks called", async () => {
    const { result } = await deliver({ from: LANDLORD, subject: "Water shut-off Monday", text: "Water will be off Monday, November 2, 10am to 2pm." });
    nextClassifications.push({ class: "notice", date: "2026-11-02T10:00", start: "2026-11-02T10:00", end: "2026-11-02T14:00", what: "water", off: true, summary: "water off Monday Nov 2, 10am-2pm" });
    const calls: string[] = [];
    const out = await leaseInbox.classifyInbound(groupId, result.id!, {
      now: new Date("2026-10-30T17:00:00Z"), // Fri noon CDT: Mon 10:00 CST is 71 h away
      hooks: {
        remind: async (_g, at, text) => void calls.push(`remind ${at.toISOString()} ${text}`),
        urgent: async (_g, line) => void calls.push(`urgent ${line}`),
      },
    });
    assert.equal(out.class, "notice");
    assert.equal(out.line, "📬 Brookfield Residential Leasing: water off Monday Nov 2, 10am-2pm");
    assert.equal(out.urgent, true);
    // 20:00 Chicago on Sunday Nov 1, after the switch back to CST: 02:00Z on Nov 2.
    assert.equal(out.reminderAt?.toISOString(), "2026-11-02T02:00:00.000Z");
    assert.deepEqual(calls, [
      "remind 2026-11-02T02:00:00.000Z Reminder: water's off tomorrow, 10 AM to 2 PM. Shower tonight.",
      "urgent 📬 Brookfield Residential Leasing: water off Monday Nov 2, 10am-2pm",
    ]);
    const [row] = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, result.id!));
    assert.deepEqual([row.class, row.noticeDate], ["notice", "2026-11-02T10:00"]);
    assert.deepEqual(row.facts, { start: "2026-11-02T10:00", end: "2026-11-02T14:00", what: "water", off: true });
  });

  test("everything else from the landlord is one line too, like a notification (#45), and filed", async () => {
    const { result } = await deliver({ from: LANDLORD, subject: "Fall community mixer!", text: "Join us in the clubhouse." });
    nextClassifications.push({ class: "other", summary: "community mixer" });
    const out = await leaseInbox.classifyInbound(groupId, result.id!);
    assert.deepEqual([out.class, out.line], ["other", "📬 Brookfield Residential Leasing: community mixer"]);
  });

  let sinkThread: string;

  test('"the sink\'s leaking, tell them": one email signed with the Member\'s name, a work order in sent, a sent_mail row', async () => {
    const before = mail.sent.length;
    const r = await leaseInbox.reportIssue(dev, { what: "the leaking kitchen sink", instruction: "roomie the sink's leaking, tell them" });
    assert.equal(r.sent, true);
    if (!r.sent) return;
    assert.equal(r.line, "Sent: reported the leaking kitchen sink.");
    assert.equal(mail.sent.length, before + 1);
    const email = mail.sent.at(-1)!;
    assert.equal(email.to, "leasing@brookfieldresidential.com");
    assert.equal(email.subject, "Work order: the leaking kitchen sink");
    assert.ok(email.text.endsWith("at Dev's request.\nReplies reach all residents."), email.text);
    assert.ok(email.headers?.["Idempotency-Key"], "an idempotency key on every send");
    sinkThread = email.threadId;
    const [wo] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, r.workOrderId!));
    assert.deepEqual([wo.status, wo.threadId, wo.reportedBy, wo.title], ["sent", sinkThread, dev.memberId, "the leaking kitchen sink"]);
    const sent = await db.select().from(schema.sentMail).where(eq(schema.sentMail.threadId, sinkThread));
    assert.equal(sent.length, 1);
    assert.deepEqual([sent[0].memberId, sent[0].intent, sent[0].workOrderId], [dev.memberId, "maintenance", wo.id]);
  });

  test('the landlord replies "plumber Tuesday 10-12": the work order is scheduled with the date', async () => {
    const { result } = await deliver({ from: "Brookfield Work Orders <workorders@brookfieldresidential.com>", subject: "Re: Work order: the leaking kitchen sink", text: "A plumber will come Tuesday between 10 and 12.", threadId: sinkThread });
    nextClassifications.push({ class: "work-order", reply: "scheduled", date: "2026-11-03T10:00", summary: "plumber Tuesday 10-12" });
    const out = await leaseInbox.classifyInbound(groupId, result.id!);
    assert.equal(out.class, "work-order");
    assert.equal(out.line, "📬 Brookfield Work Orders on the leaking kitchen sink: plumber Tuesday 10-12");
    const status = await leaseInbox.workOrderStatus({ groupId }, { what: "sink" });
    assert.ok(status && "status" in status);
    assert.deepEqual([status.status, status.scheduledFor, status.lastReply], ["scheduled", "2026-11-03T10:00", "plumber Tuesday 10-12"]);
  });

  test("a reply in the landlord's thread sends at once and stays in the thread", async () => {
    const r = await leaseInbox.sendToLandlord(sam, {
      threadId: sinkThread,
      intent: "reply",
      body: "Thanks, someone will be home Tuesday.",
      instruction: "tell them someone will be home tuesday",
      summary: "told them someone will be home Tuesday",
    });
    assert.equal(r.sent, true);
    const email = mail.sent.at(-1)!;
    assert.equal(email.threadId, sinkThread);
    assert.equal(email.to, "Brookfield Work Orders <workorders@brookfieldresidential.com>");
  });

  test("another Member saying something else in the same thread within the hour: ask first", async () => {
    const before = mail.sent.length;
    const r = await leaseInbox.sendToLandlord(dev, {
      threadId: sinkThread,
      intent: "reply",
      body: "Actually nobody can be home, could you come another day?",
      instruction: "tell them nobody can be home",
      summary: "asked them to come another day",
    });
    assert.equal(r.sent, false);
    if (r.sent) return;
    assert.match(r.ask[0], /^Sam asked for something else \d+ min ago \("tell them someone will be home tuesday"\)/);
    assert.equal(mail.sent.length, before);
  });

  test('"tell them we\'re not renewing": a question, nothing sent', async () => {
    const before = mail.sent.length;
    const r = await leaseInbox.sendToLandlord(maya, {
      intent: "other",
      body: "Hi, we wanted to let you know we won't be renewing our lease in July.",
      instruction: "roomie tell them we're not renewing",
      summary: "told them we're not renewing",
    });
    assert.equal(r.sent, false);
    if (r.sent) return;
    assert.ok(r.ask.includes('This touches the lease ("renewing"). Send it as written?'), r.ask.join(" | "));
    assert.equal(mail.sent.length, before);
    assert.equal((await db.select().from(schema.sentMail).where(eq(schema.sentMail.instruction, "roomie tell them we're not renewing"))).length, 0);
  });

  const notRenewing = { intent: "other" as const, body: "Hi, we wanted to let you know we won't be renewing our lease in July.", summary: "told them we're not renewing" };

  test('a question or two first: "ok" before any question still gets them; after the ask, the same Member\'s yes sends it', async () => {
    const before = mail.sent.length;
    const first = await leaseInbox.sendToLandlord(sam, { ...notRenewing, instruction: "ok roomie tell them we're not renewing", approval: { latest: "ok roomie tell them we're not renewing" } });
    assert.equal(first.sent, false, "a first message with ok, nothing held: questions");
    const otherMember = await leaseInbox.sendToLandlord(dev, { ...notRenewing, instruction: "yes", approval: { latest: "yes" } });
    assert.equal(otherMember.sent, false, "Dev's yes doesn't release what Sam was asked");
    const yes = await leaseInbox.sendToLandlord(sam, { ...notRenewing, instruction: "yes send it", approval: { latest: "yes send it" } });
    assert.equal(yes.sent, true);
    assert.equal(mail.sent.length, before + 1);
    assert.equal(mail.sent.at(-1)!.to, "leasing@brookfieldresidential.com");
    const [row] = await db.select().from(schema.sentMail).where(eq(schema.sentMail.messageId, mail.sent.at(-1)!.messageId));
    assert.equal(row.instruction, "ok roomie tell them we're not renewing", "the record keeps what Sam asked, not his yes");
    const again = await leaseInbox.sendToLandlord(sam, { ...notRenewing, instruction: "yes send it", approval: { latest: "yes send it" } });
    assert.equal(again.sent, false, "a yes releases one email");
  });

  test("a changed draft after the ask gets the questions again; the dashboard's token releases only the draft it came with", async () => {
    const before = mail.sent.length;
    const ask = await leaseInbox.sendToLandlord(maya, { ...notRenewing, instruction: "tell them we're not renewing" });
    assert.ok(!ask.sent && ask.confirmToken);
    if (ask.sent) return;
    const changed = await leaseInbox.sendToLandlord(maya, { ...notRenewing, body: "We won't renew, and we'd like the deposit back by August 1.", instruction: "yes", approval: { latest: "yes" } });
    assert.equal(changed.sent, false, "another body: ask again");
    assert.equal(mail.sent.length, before);
    if (changed.sent) return;
    const stale = await leaseInbox.sendToLandlord(maya, { ...notRenewing, instruction: notRenewing.body, approval: { token: ask.confirmToken! } });
    assert.equal(stale.sent, false, "the first token went with the first ask");
    const fresh = stale.sent ? null : stale.confirmToken;
    const sent = await leaseInbox.sendToLandlord(maya, { ...notRenewing, instruction: notRenewing.body, approval: { token: fresh! } });
    assert.equal(sent.sent, true);
    assert.equal(mail.sent.length, before + 1);
  });

  test("a reply on a forwarded thread goes to the original sender, not the Member who forwarded it", async () => {
    const r = await leaseInbox.sendToLandlord(sam, { threadId: forwardThread, intent: "reply", body: "Thanks, noted.", instruction: "tell them thanks", summary: "thanked them" });
    assert.equal(r.sent, true);
    const email = mail.sent.at(-1)!;
    assert.deepEqual([email.to, email.threadId], ["concierge@brookfieldmgmt.com", forwardThread]);
  });

  test("a thread from a sender who isn't trusted is refused, approval or not; trust_sender first opens it", async () => {
    const { m } = await deliver({ from: "Two Guys Moving <quotes@twoguysmoving.biz>", subject: "Moving quote for Apt 4B", text: "Reply to confirm your July move." });
    const reply = { threadId: m.threadId, intent: "reply" as const, body: "Thanks, we got it.", instruction: "tell them thanks, we got it", summary: "thanked them", approval: { latest: "yes" } };
    const before = mail.sent.length;
    await assert.rejects(leaseInbox.sendToLandlord(dev, reply), (e) => e instanceof NotAllowedError && /only reply to the landlord/.test(e.message));
    assert.equal(mail.sent.length, before);
    await leaseInbox.trustSender(maya, "quotes@twoguysmoving.biz", "admin");
    assert.equal((await leaseInbox.sendToLandlord(dev, reply)).sent, true);
    assert.equal(mail.sent.at(-1)!.to, "Two Guys Moving <quotes@twoguysmoving.biz>");
    await db.delete(schema.landlordSenders).where(and(eq(schema.landlordSenders.groupId, groupId), inArray(schema.landlordSenders.value, ["quotes@twoguysmoving.biz", "twoguysmoving.biz"])));
  });

  test("work orders: whole words, filler ignored; the only open one wins; several open and no match -> which one", async () => {
    const weather = await leaseInbox.createWorkOrder(dev, { title: "the weather stripping on the balcony door", threadId: "wo-thread-weather" });
    const ask = await leaseInbox.workOrderStatus({ groupId }, { what: "what's up with the sink?" });
    assert.ok(ask && "status" in ask);
    assert.equal(ask.title, "the leaking kitchen sink", "'the' / 'with' don't match the weather stripping");
    const which = await leaseInbox.workOrderStatus({ groupId }, { what: "any news from them?" });
    assert.deepEqual(which, { choices: ["the weather stripping on the balcony door", "the leaking kitchen sink"] });
    await db.update(schema.workOrders).set({ status: "done" }).where(and(eq(schema.workOrders.groupId, groupId), eq(schema.workOrders.title, "the leaking kitchen sink")));
    const only = await leaseInbox.workOrderStatus({ groupId }, { what: "how's the sink going?" });
    assert.ok(only && "title" in only);
    assert.equal(only.title, weather.title, "the only open one, whatever was said");
    await db.delete(schema.workOrders).where(eq(schema.workOrders.id, weather.id));
    await db.update(schema.workOrders).set({ status: "scheduled" }).where(and(eq(schema.workOrders.groupId, groupId), eq(schema.workOrders.title, "the leaking kitchen sink")));
  });

  test("the intro email goes once per landlord domain, signed with everyone's first name", async () => {
    const first = await leaseInbox.sendIntro(sam);
    assert.equal(first.sent, true);
    const email = mail.sent.at(-1)!;
    assert.match(email.text, /Dev, Maya and Sam|Maya, Dev and Sam/);
    assert.ok(email.text.endsWith("at Sam's request.\nReplies reach all residents."));
    const again = await leaseInbox.sendIntro(maya);
    assert.deepEqual(again, { sent: false, reason: "already-sent" });
  });

  test("a Pending Member can't send, report or trust", async () => {
    const [pending] = await db
      .insert(schema.members)
      .values({ groupId, displayName: "Priya", status: "pending", channelUserId: devUserId(`lease-priya-${Date.now()}`) })
      .returning();
    const ctx = { groupId, memberId: pending.id, source: "chat" as const };
    await assert.rejects(leaseInbox.reportIssue(ctx, { what: "a broken window", instruction: "tell them the window's broken" }), NotAllowedError);
    await assert.rejects(leaseInbox.sendToLandlord(ctx, { intent: "maintenance", body: "Hi", instruction: "x", summary: "x" }), NotAllowedError);
    await assert.rejects(leaseInbox.sendIntro(ctx), NotAllowedError);
    await assert.rejects(leaseInbox.ensureInbox(ctx), NotAllowedError);
  });

  test("delete group data releases the address; a mail service that fails to delete it doesn't stop the deletion", async () => {
    class FailingMail extends FakeMail {
      async deleteInbox(): Promise<void> {
        throw new Error("AgentMail 503");
      }
    }
    setMailClient(new FailingMail());
    try {
      await deleteGroupData(maya);
    } finally {
      setMailClient(mail);
    }
    assert.equal((await db.select().from(schema.groupInboxes).where(eq(schema.groupInboxes.groupId, groupId))).length, 0, "the address row is gone");
    assert.equal((await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.groupId, groupId))).length, 0);
    // The failed release left the inbox at the mail service (logged); with it working, the address goes there too
    // (deleteGroup runs the same wipe).
    assert.equal(mail.inboxes.size, 1);
    await leaseInbox.ensureInbox(maya);
    await deleteGroupData(maya);
    assert.equal(mail.inboxes.size, 0, "released at the mail service");
    assert.equal((await db.select().from(schema.groupInboxes).where(eq(schema.groupInboxes.groupId, groupId))).length, 0);
  });
});
