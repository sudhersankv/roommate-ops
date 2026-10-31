// The Lease Inbox Trick end to end against the Neon dev branch: teaching it, the webhook storing mail once per
// event_id, every class's hook (Reminder, urgent slot, Documents, the Admin's DMs, the rent proposal, the utility
// prefill), work orders, the Bundle line, ask_lease, release and forget me. FakeMail and a fake classifier; the Chat
// and DMs go to a capturing dev Channel. Apt 4B in Chicago; the landlord is leasing@brookfieldresidential.com.
// Run: npx tsx --test src/services/lease-inbox-toolkit.dbtest.ts   (not *.test.ts: `npm test` runs without .env)
import "@/lib/env";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import { Webhook } from "svix";
import { db, schema } from "@/db";
import { registerChannel } from "@/channels";
import { DevChannel, devUserId, type DevOutput } from "@/channels/dev";
import { mailQueue, mailWebhook } from "@/app/api/mail/webhook";
import { FakeMail, setMailClient } from "@/integrations/mail";
import { zonedTimeToUtc } from "@/lib/time";
import { onGroupJoined } from "@/onboarding";
import { deleteGroup } from "./groups";
import * as core from "./lease-inbox";
import { handleMailEvent, processInbound } from "./lease-inbox-inbound";
import { anonymizeMailMember, inboxData, leaseBundleLine, leaseReportParts, releaseInbox, sendForMember, trustAsked } from "./lease-inbox-toolkit";
import { askLease, setLeaseAnswerer, setTextReader } from "./lease-text";
import { forgetMe } from "./members";
import { setVariableExpense } from "./recurring";
import { getRent, setRent } from "./rent";
import { setToolkit } from "./toolkits";
import type { Ctx } from "./types";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

const TZ = "America/Chicago";
const local = (month: number, day: number, hour: number, minute = 0) => zonedTimeToUtc(TZ, { year: 2026, month, day, hour, minute });
// Monday Nov 2 2026, 10:00 in Chicago: daytime, so lines post rather than wait for 08:00.
const MONDAY = local(11, 2, 10);
const LANDLORD = "Brookfield Residential Leasing <leasing@brookfieldresidential.com>";
const SECRET = `whsec_${Buffer.from("apt-4b-dbtest-secret-0123456789").toString("base64")}`;

const forward = (from: string, subject: string, body: string) => `fyi\n\n---------- Forwarded message ---------\nFrom: ${from}\nDate: Tue, Oct 27, 2026 at 3:14 PM\nSubject: ${subject}\nTo: <maya.rao@gmail.com>\n\n${body}\n`;

const out: DevOutput[] = [];
const memberOf = new Map<string, string>();
const take = () => out.splice(0);
/** The next chat line fails to send (a Channel outage halfway through a run). */
let failChat = false;
const chatLines = (o: DevOutput[]) => o.filter((x) => x.to === "chat").map((x) => x.msg.text);
const dmsTo = (o: DevOutput[], memberId: string) => o.filter((x) => x.to === "private" && memberOf.get(x.userExternalId) === memberId).map((x) => x.msg.text);

const queue: core.Classification[] = [];
const classifier: core.MailClassifier = {
  async classify(input) {
    const c = queue.shift();
    if (!c) throw new Error(`unexpected classify call: ${input.subject}`);
    return c;
  },
};

const LEASE_TEXT = `RESIDENTIAL LEASE AGREEMENT - Apt 4B\n\nSection 14.2 Notice to Vacate. Resident shall give Landlord not less than sixty (60) days' written notice before vacating.\n\nSection 9 Pets. No pets without written consent.`;

let mail: FakeMail;
let groupId: string;
let accountId: string;
let maya: Ctx;
let dev: Ctx;
let sam: Ctx;
let inboxId: string;
let mayaEmail: string;

describe("the Lease Inbox Trick against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "lease-inbox-toolkit dbtest");
    process.env.MAIL_FAKE = "1";
    mail = new FakeMail();
    setMailClient(mail);
    core.setClassifier(classifier);
    setTextReader(async (f) => (/lease/i.test(f.filename ?? "") ? LEASE_TEXT : `Text of ${f.filename}`));
    registerChannel(
      new DevChannel((o) => {
        if (failChat && o.to === "chat") {
          failChat = false;
          throw new Error("Telegram 502");
        }
        out.push(o);
      }),
    );
    const ts = Date.now();
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`lit-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `test-lit-${ts}`, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    await db.update(schema.groups).set({ timezone: TZ, onboardedAt: new Date() }).where(eq(schema.groups.id, groupId));
    const id = (n: string) => joined.members.find((m) => m.displayName === n)!.id;
    for (const p of people) memberOf.set(p.userExternalId, id(p.name));
    maya = { groupId, memberId: id("Maya"), source: "chat" };
    dev = { groupId, memberId: id("Dev"), source: "chat" };
    sam = { groupId, memberId: id("Sam"), source: "chat" };
    mayaEmail = `maya.rao.${ts}@gmail.com`;
    const [acc] = await db.insert(schema.accounts).values({ authUserId: `lit-test-${ts}`, email: mayaEmail, name: "Maya Rao" }).returning();
    accountId = acc.id;
    await db.update(schema.members).set({ accountId }).where(eq(schema.members.id, maya.memberId));
    take();
  });

  after(async () => {
    if (groupId) await deleteGroup(groupId);
    setMailClient(null);
    core.setClassifier(null);
    setTextReader(null);
    setLeaseAnswerer(null);
    if (accountId) await db.delete(schema.accounts).where(eq(schema.accounts.id, accountId));
  });

  const receive = (input: Parameters<FakeMail["receive"]>[1]) => mail.receive(inboxId, input);

  test('teach: "roomie, learn lease inbox" makes the address and posts it with the three ways to connect', async () => {
    const r = await setToolkit(maya, { toolkit: "lease inbox", enabled: true });
    assert.equal(r.changed, true);
    const [row] = await db.select().from(schema.groupInboxes).where(eq(schema.groupInboxes.groupId, groupId));
    assert.ok(row, "an inbox row");
    inboxId = row.inboxId;
    assert.equal(mail.inboxes.size, 1);
    const lines = chatLines(take());
    assert.equal(lines.length, 1);
    assert.match(lines[0], new RegExp(`Our email address is ${row.address.replace(/[.]/g, "\\.")}\\. To connect the landlord: forward me the lease or their last email, CC this address`));
  });

  test("the webhook: a signed delivery is stored once; the same event_id again adds no row", async () => {
    const m = receive({ from: LANDLORD, subject: "Brookfield Community Newsletter - November", text: "Join us for the fall mixer in the lobby!" });
    const body = JSON.stringify({
      type: "event",
      event_type: "message.received",
      event_id: `evt-${m.messageId}`,
      message: { inbox_id: inboxId, thread_id: m.threadId, message_id: m.messageId, from: m.from, to: m.to, subject: m.subject, text: m.text, timestamp: m.receivedAt.toISOString(), labels: ["received"], attachments: [] },
    });
    const sign = (id: string) => {
      const now = new Date();
      return { "svix-id": id, "svix-timestamp": String(Math.floor(now.getTime() / 1000)), "svix-signature": new Webhook(SECRET).sign(id, now, body) };
    };
    const deps = { secret: SECRET, fakeAllowed: false, handle: (e: Parameters<typeof handleMailEvent>[0]) => handleMailEvent(e, MONDAY), queue: mailQueue };
    const req = (h: Record<string, string>) => new Request("https://roomie.example/api/mail", { method: "POST", body, headers: h });
    // Not trusted yet (no landlord known): filed as new-sender. That's fine for this test: what counts is one row.
    queue.length = 0;
    assert.equal((await mailWebhook(req(sign("msg_a")), deps)).status, 204);
    assert.equal((await mailWebhook(req(sign("msg_b")), deps)).status, 204, "a retry, same event_id");
    assert.equal((await mailWebhook(req({ ...sign("msg_c"), "svix-signature": "v1,bad" }), deps)).status, 401);
    await mailQueue.idle();
    const rows = await db.select().from(schema.mailMessages).where(and(eq(schema.mailMessages.groupId, groupId), eq(schema.mailMessages.messageId, m.messageId)));
    assert.equal(rows.length, 1);
    assert.equal((await db.select().from(schema.mailEvents).where(eq(schema.mailEvents.eventId, `evt-${m.messageId}`))).length, 1);
    take();
  });

  let noticeDoc: string;

  test("Maya forwards the inspection notice: the landlord is learned, one group line, a Reminder at 18:00 the evening before, the PDF filed and read", async () => {
    const m = receive({
      from: `Maya Rao <${mayaEmail}>`,
      subject: "Fwd: Annual Unit Inspection - November 12",
      text: forward(LANDLORD, "Annual Unit Inspection - November 12", "Our maintenance team will complete the annual smoke detector inspection in your unit on Thursday, November 12 between 9:00 AM and 12:00 PM."),
      attachments: [{ filename: "Inspection_Notice_Nov12.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7 inspection notice") }],
    });
    queue.push({ class: "notice", date: "2026-11-12T09:00", summary: "smoke detector inspection Thursday Nov 12, 9am-noon" });
    const r = await processInbound(groupId, m, { eventId: `evt-${m.messageId}`, now: MONDAY });
    assert.ok(!r.duplicate);
    if (r.duplicate) return;
    assert.equal(r.class, "notice");
    assert.equal(r.urgent, false);
    assert.equal(await core.isTrusted(groupId, "workorders@brookfieldresidential.com"), true, "the whole domain");
    const o = take();
    assert.deepEqual(chatLines(o), ["Notice from the landlord: smoke detector inspection Thursday Nov 12, 9am-noon"]);
    // The forward taught the landlord: Maya (the Admin) is offered the intro, privately.
    assert.match(dmsTo(o, maya.memberId).join("\n"), /Got it: brookfieldresidential\.com is the landlord now\. Want me to send them a short intro/);
    const [rem] = await db.select().from(schema.reminders).where(eq(schema.reminders.groupId, groupId));
    assert.equal(rem.memberId, null, "the whole Group");
    assert.equal(rem.dueAt.toISOString(), local(11, 11, 18).toISOString());
    assert.equal(rem.text, "Tomorrow: smoke detector inspection Thursday Nov 12, 9am-noon");
    const [mm] = await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.id, r.mailId));
    assert.equal(mm.documentIds.length, 1);
    const [doc] = await db.select().from(schema.documents).where(eq(schema.documents.id, mm.documentIds[0]));
    assert.deepEqual([doc.kind, doc.title, doc.source, doc.uploadedBy, doc.text], ["notice", "Inspection Notice Nov12", { table: "mail_messages", id: r.mailId }, maya.memberId, "Text of Inspection_Notice_Nov12.pdf"]);
    noticeDoc = doc.id;
  });

  test("a notice dated tomorrow takes the day's urgent slot (posted once, not twice)", async () => {
    const m = receive({ from: LANDLORD, subject: "Water shut-off tomorrow 9am-1pm", text: "Water will be shut off on Tuesday, November 3 from 9:00 AM to 1:00 PM for a riser repair." });
    queue.push({ class: "notice", date: "2026-11-03T09:00", summary: "water off Tuesday Nov 3, 9am-1pm" });
    const r = await processInbound(groupId, m, { now: MONDAY });
    assert.ok(!r.duplicate && r.urgent && r.posted === "urgent");
    const [claim] = await db.select().from(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, groupId), eq(schema.scheduledPosts.kind, "urgent")));
    assert.equal(claim?.period, "2026-11-02");
    assert.deepEqual(chatLines(take()), ["Notice from the landlord: water off Tuesday Nov 3, 9am-1pm"]);
  });

  test("a rent change: the Admin gets the proposal privately; the group one line; the rent Expense unchanged", async () => {
    await setRent(maya, { cents: 240000, dueDay: 1 }, MONDAY);
    take();
    const m = receive({ from: LANDLORD, subject: "Lease Renewal Offer - Apt 4B", text: "Your renewal rent will be $2,550.00 per month starting January 1, 2027." });
    queue.push({ class: "rent-lease", amountCents: 255000, summary: "rent goes to $2,550 a month from Jan 1, 2027" });
    const r = await processInbound(groupId, m, { now: MONDAY });
    assert.ok(!r.duplicate && r.class === "rent-lease");
    const o = take();
    assert.deepEqual(chatLines(o), ["The landlord emailed about the rent or the lease. An admin has the details."]);
    const dm = dmsTo(o, maya.memberId).join("\n");
    assert.match(dm, /rent goes to \$2,550 a month from Jan 1, 2027/);
    assert.match(dm, /say "roomie, update the rent to \$2,550"/);
    assert.match(dm, /\(it's \$2,400 now\)/);
    assert.deepEqual(dmsTo(o, dev.memberId), [], "only Admins");
    assert.equal((await getRent({ groupId }))?.cents, 240000, "nothing changes until the Admin says so");
  });

  test("a utility bill from the landlord pre-fills the variable Expense's month", async () => {
    const parent = await setVariableExpense(dev, { description: "Electric", dueDay: 20 });
    const m = receive({ from: "Brookfield Billing <billing@brookfieldresidential.com>", subject: "Your October electric bill", text: "Amount due: $92.40 by November 20." });
    queue.push({ class: "other", utility: "electric", amountCents: 9240, summary: "October electric bill, $92.40" });
    await processInbound(groupId, m, { now: MONDAY });
    const [p] = await db.select().from(schema.pendingAmounts).where(eq(schema.pendingAmounts.expenseId, parent.id));
    assert.equal(p?.prefillCents, 9240);
    assert.deepEqual(chatLines(take()), [], "other mail is filed quietly");
  });

  test("a new sender: filed, the Admin asked once per domain; yes trusts it", async () => {
    const first = receive({ from: "City Parking <permits@cityparkingllc.com>", subject: "Residential parking permits for Apt 4B", text: "Renew your permit by Nov 30." });
    const a = await processInbound(groupId, first, { now: MONDAY });
    assert.ok(!a.duplicate && a.class === "new-sender");
    const o = take();
    assert.deepEqual(chatLines(o), [], "strangers never reach the chat");
    assert.deepEqual(dmsTo(o, maya.memberId), ['permits@cityparkingllc.com emailed about "Residential parking permits for Apt 4B": is that your building? If it is, say "yes" and I\'ll treat cityparkingllc.com as the landlord from now on.']);
    const second = receive({ from: "City Parking <billing@cityparkingllc.com>", subject: "Invoice", text: "..." });
    await processInbound(groupId, second, { now: MONDAY });
    assert.deepEqual(dmsTo(take(), maya.memberId), [], "once per domain");
    const yes = await trustAsked(maya);
    assert.equal(yes.trusted.at(-1), "cityparkingllc.com", "the newest one asked about, at its widest: the domain");
    assert.equal(await core.isTrusted(groupId, "permits@cityparkingllc.com"), true);
  });

  let sinkThread: string;

  test('"the sink\'s leaking, tell them": FakeMail has it with Dev\'s signature; a work order in sent', async () => {
    const r = await core.reportIssue(dev, { what: "the leaking kitchen sink", instruction: "roomie the sink's leaking, tell them" });
    assert.ok(r.sent);
    if (!r.sent) return;
    assert.equal(r.line, "Sent: reported the leaking kitchen sink.");
    const email = mail.sent.at(-1)!;
    assert.equal(email.to, "leasing@brookfieldresidential.com");
    assert.match(email.text, /at Dev's request\.\nReplies reach all residents\.$/);
    sinkThread = email.threadId;
    const [wo] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.id, r.workOrderId!));
    assert.equal(wo.status, "sent");
  });

  test("the landlord replies \"we'll come Tuesday at 10\": scheduled, one line; Monday's Bundle says the visit is tomorrow", async () => {
    const m = receive({ from: "Brookfield Work Orders <workorders@brookfieldresidential.com>", subject: "Re: Work order: the leaking kitchen sink", text: "We'll come Tuesday at 10.", threadId: sinkThread });
    queue.push({ class: "work-order", reply: "scheduled", date: "2026-11-03T10:00", summary: "plumber Tuesday at 10" });
    const r = await processInbound(groupId, m, { now: local(11, 1, 15) });
    assert.ok(!r.duplicate && r.class === "work-order");
    assert.deepEqual(chatLines(take()), ["Update on the leaking kitchen sink: plumber Tuesday at 10"]);
    const [wo] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.threadId, sinkThread));
    assert.deepEqual([wo.status, wo.scheduledFor], ["scheduled", "2026-11-03T10:00"]);
    assert.equal(await leaseBundleLine({ groupId }, MONDAY), "🔧 The landlord's coming tomorrow (10am) about the leaking kitchen sink. Someone be home?");
  });

  test("a reply in the landlord's thread goes at once; \"tell them we're not renewing\" asks and sends nothing", async () => {
    const before = mail.sent.length;
    const ok = await sendForMember(sam, { intent: "reply", about: "the sink", body: "Tuesday at 10 works, someone will be home.", summary: "told them Tuesday at 10 works", instruction: "roomie tell them tuesday at 10 works" }, MONDAY);
    assert.ok(ok.sent);
    assert.equal(mail.sent.at(-1)!.threadId, sinkThread);
    const no = await sendForMember(sam, { intent: "new", body: "We will not be renewing our lease.", summary: "told them we're not renewing", instruction: "roomie tell them we're not renewing" }, MONDAY);
    assert.equal(no.sent, false);
    if (no.sent) return;
    assert.ok(no.ask.some((q) => /lease/.test(q)), no.ask.join(" | "));
    assert.equal(mail.sent.length, before + 1, "only the reply went");
  });

  test("ask_lease: none filed -> says so; a forwarded lease PDF is read and answers with the clause", async () => {
    const none = await askLease({ groupId }, { question: "what's the notice period?" }, { address: "x@agentmail.to" });
    assert.deepEqual(none, { found: false, line: "No lease filed yet. Forward the lease PDF to x@agentmail.to and I'll read it." });
    const m = receive({ from: `Maya Rao <${mayaEmail}>`, subject: "Fwd: Your lease", text: forward(LANDLORD, "Your lease", "Attached is your signed lease."), attachments: [{ filename: "Lease_Agreement_Apt4B_2026.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7 lease") }] });
    queue.push({ class: "other", summary: "the signed lease" });
    await processInbound(groupId, m, { now: MONDAY });
    take();
    let seen = "";
    setLeaseAnswerer(async ({ question, text }) => {
      seen = text;
      return { answer: `60 days' written notice (${question}).`, clause: "Section 14.2, Notice to Vacate", quote: "not less than sixty (60) days' written notice" };
    });
    const a = await askLease({ groupId }, { question: "what's the notice period?" });
    assert.ok(a.found);
    if (!a.found) return;
    assert.equal(a.clause, "Section 14.2, Notice to Vacate");
    assert.equal(a.document, "Lease Agreement Apt4B 2026");
    assert.equal(seen, LEASE_TEXT);
  });

  test("the weekly report counts what came in; the dashboard sees it all", async () => {
    // FakeMail stamps mail with the real clock. Notices: the inspection and the water; the rest but the rent email and
    // the work-order reply: the newsletter, the bill, two parking emails, the lease.
    assert.deepEqual(await leaseReportParts({ groupId }, new Date()), [{ icon: "📬", text: "Lease inbox: 2 notices, 5 other emails" }]);
    const data = await inboxData(dev);
    assert.ok(data.address);
    assert.ok(data.mail.some((m) => m.documentIds.includes(noticeDoc)));
    assert.equal(data.workOrders[0].reportedBy, "Dev");
  });

  test("a delivery whose run failed halfway (the chat line didn't go) is processed again by a retry 10+ minutes later, once", async () => {
    const m = receive({ from: LANDLORD, subject: "Hallway painting Nov 18", text: "Painters will be in the 4th floor hallway on Wednesday, November 18." });
    const eventId = `evt-${m.messageId}`;
    const classify = () => queue.push({ class: "notice", date: "2026-11-18T09:00", summary: "hallway painting Wednesday Nov 18" });
    classify();
    failChat = true;
    await assert.rejects(processInbound(groupId, m, { eventId, now: MONDAY }), /Telegram 502/);
    const [ev] = await db.select().from(schema.mailEvents).where(eq(schema.mailEvents.eventId, eventId));
    assert.equal(ev.processedAt, null, "received, not processed");
    assert.ok((await processInbound(groupId, m, { eventId, now: new Date(MONDAY.getTime() + 5 * 60_000) })).duplicate, "inside 10 minutes: still taken");
    classify();
    const r = await processInbound(groupId, m, { eventId, now: new Date(MONDAY.getTime() + 11 * 60_000) });
    assert.ok(!r.duplicate && r.posted === "posted");
    assert.deepEqual(chatLines(take()), ["Notice from the landlord: hallway painting Wednesday Nov 18"]);
    const reminders = await db.select().from(schema.reminders).where(and(eq(schema.reminders.groupId, groupId), eq(schema.reminders.text, "Tomorrow: hallway painting Wednesday Nov 18")));
    assert.equal(reminders.length, 1, "the first run's Reminder isn't set twice");
    assert.ok((await processInbound(groupId, m, { eventId, now: new Date(MONDAY.getTime() + 30 * 60_000) })).duplicate, "processed: done");
    assert.deepEqual(chatLines(take()), []);
  });

  test("ask_lease: a lease that couldn't be read when it came in is read when asked; still unreadable says so", async () => {
    let failures = 2;
    setTextReader(async (f) => {
      if (failures-- > 0) throw new Error("gateway 502");
      return /lease/i.test(f.filename ?? "") ? LEASE_TEXT : `Text of ${f.filename}`;
    });
    try {
      const m = receive({ from: `Maya Rao <${mayaEmail}>`, subject: "Fwd: Signed renewal", text: forward(LANDLORD, "Signed renewal", "Attached is the signed renewal."), attachments: [{ filename: "Lease_Renewal_2027.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7 renewal") }] });
      queue.push({ class: "other", summary: "the signed renewal" });
      await processInbound(groupId, m, { now: MONDAY });
      take();
      const [doc] = await db.select().from(schema.documents).where(and(eq(schema.documents.groupId, groupId), eq(schema.documents.title, "Lease Renewal 2027")));
      assert.equal(doc.text, null, "the read failed when it was filed");
      assert.deepEqual(await askLease({ groupId }, { question: "what's the notice period?" }), { found: false, line: "I couldn't read the lease yet. Try me again in a bit." });
      const a = await askLease({ groupId }, { question: "what's the notice period?" });
      assert.ok(a.found);
      if (!a.found) return;
      assert.equal(a.document, "Lease Renewal 2027");
      const [read] = await db.select({ text: schema.documents.text }).from(schema.documents).where(eq(schema.documents.id, doc.id));
      assert.equal(read.text, LEASE_TEXT, "kept for next time");
    } finally {
      setTextReader(async (f) => (/lease/i.test(f.filename ?? "") ? LEASE_TEXT : `Text of ${f.filename}`));
    }
  });

  test("forget me: Dev's name comes off the work order and the sent mail; the emails stay", async () => {
    await forgetMe(dev);
    const [wo] = await db.select().from(schema.workOrders).where(eq(schema.workOrders.threadId, sinkThread));
    assert.equal(wo.reportedBy, null);
    assert.equal((await db.select().from(schema.sentMail).where(and(eq(schema.sentMail.groupId, groupId), eq(schema.sentMail.memberId, dev.memberId)))).length, 0);
    assert.ok((await db.select().from(schema.sentMail).where(eq(schema.sentMail.threadId, sinkThread))).length >= 1, "the records stay");
    assert.equal(await anonymizeMailMember(groupId, dev.memberId), 0, "twice is a no-op");
  });

  test("release: the AgentMail inbox and the row go; what was filed stays", async () => {
    await assert.rejects(releaseInbox(sam), /admin/i);
    const r = await releaseInbox(maya);
    assert.ok(r.released);
    assert.equal(mail.inboxes.size, 0);
    assert.equal((await db.select().from(schema.groupInboxes).where(eq(schema.groupInboxes.groupId, groupId))).length, 0);
    assert.ok((await db.select().from(schema.mailMessages).where(eq(schema.mailMessages.groupId, groupId))).length > 0);
  });
});
