// The Lease Inbox services against the Neon dev branch, with FakeMail and a fake classifier (no AgentMail, no model).
// Run: npx tsx --test src/services/lease-inbox.dbtest.ts   (not *.test.ts: `npm test` runs without .env)
//
// Isolation: a throwaway roommates Group (Maya the Admin, Dev, Sam) made through Onboarding on the dev Channel, plus
// an Account for Maya so her forwards are recognised; `after` deletes the Group and the Account.
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { devUserId } from "@/channels/dev";
import { onGroupJoined } from "@/onboarding";
import { deleteGroup } from "@/services/groups";
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
    setMailClient(null);
    leaseInbox.setClassifier(null);
    if (groupId) await deleteGroup(groupId);
    if (accountId) await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId));
    if (groupId) {
      for (const t of [schema.groupInboxes, schema.mailMessages, schema.landlordSenders, schema.workOrders, schema.sentMail, schema.mailEvents]) {
        assert.equal((await db.select().from(t).where(eq(t.groupId, groupId))).length, 0, "leftover Lease Inbox rows");
      }
    }
  });

  const deliver = async (input: Parameters<FakeMail["receive"]>[1], eventId = `evt-${Math.random()}`) => {
    const m = mail.receive(inboxId, input);
    return { m, result: await leaseInbox.storeInbound(groupId, m, { eventId }) };
  };

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
    const { result } = await deliver({
      from: `Maya Rao <${mayaEmail}>`,
      subject: "Fwd: Package room hours",
      text: `---------- Forwarded message ---------\nFrom: Brookfield Concierge <concierge@brookfieldmgmt.com>\nSubject: Package room hours\n\nClosed at 6pm this week.`,
    });
    assert.equal(result.trusted, true);
    const [row] = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, result.id!));
    assert.equal(row.forwardedBy, maya.memberId);
    const [sender] = await db
      .select()
      .from(schema.landlordSenders)
      .where(and(eq(schema.landlordSenders.groupId, groupId), eq(schema.landlordSenders.value, "brookfieldmgmt.com")));
    assert.equal(sender.source, "forward");
  });

  test("the same event_id twice: duplicate, one row", async () => {
    const m = mail.receive(inboxId, { from: LANDLORD, subject: "Pool closing Sunday", text: "The pool closes for the season on Sunday." });
    const a = await leaseInbox.storeInbound(groupId, m, { eventId: "evt-pool-1" });
    const b = await leaseInbox.storeInbound(groupId, m, { eventId: "evt-pool-1" });
    assert.deepEqual([a.duplicate, b.duplicate], [false, true]);
    assert.equal(b.stored, false);
    const rows = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.groupId, groupId), eq(schema.mailMessages.messageId, m.messageId)));
    assert.equal(rows.length, 1);
  });

  test("a dated notice: one line, the evening-before Reminder time, urgent inside 72 hours, hooks called", async () => {
    const { result } = await deliver({ from: LANDLORD, subject: "Water shut-off Monday", text: "Water will be off Monday, November 2, 10am to 2pm." });
    nextClassifications.push({ class: "notice", date: "2026-11-02T10:00", summary: "water off Monday Nov 2, 10am-2pm" });
    const calls: string[] = [];
    const out = await leaseInbox.classifyInbound(groupId, result.id!, {
      now: new Date("2026-10-30T17:00:00Z"), // Fri noon CDT: Mon 10:00 CST is 71 h away
      hooks: {
        remind: async (_g, at, text) => void calls.push(`remind ${at.toISOString()} ${text}`),
        urgent: async (_g, line) => void calls.push(`urgent ${line}`),
      },
    });
    assert.equal(out.class, "notice");
    assert.equal(out.line, "Notice from the landlord: water off Monday Nov 2, 10am-2pm");
    assert.equal(out.urgent, true);
    // 18:00 Chicago on Sunday Nov 1, after the switch back to CST: 00:00Z on Nov 2.
    assert.equal(out.reminderAt?.toISOString(), "2026-11-02T00:00:00.000Z");
    assert.deepEqual(calls, ["remind 2026-11-02T00:00:00.000Z Water off Monday Nov 2, 10am-2pm", "urgent Notice from the landlord: water off Monday Nov 2, 10am-2pm"]);
    const [row] = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, result.id!));
    assert.deepEqual([row.class, row.noticeDate], ["notice", "2026-11-02T10:00"]);
  });

  test("everything else is filed quietly", async () => {
    const { result } = await deliver({ from: LANDLORD, subject: "Fall community mixer!", text: "Join us in the clubhouse." });
    nextClassifications.push({ class: "other", summary: "community mixer" });
    const out = await leaseInbox.classifyInbound(groupId, result.id!);
    assert.deepEqual([out.class, out.line], ["other", null]);
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
    assert.equal(out.line, "Update on the leaking kitchen sink: plumber Tuesday 10-12");
    const status = await leaseInbox.workOrderStatus({ groupId }, { what: "sink" });
    assert.ok(status);
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
});
