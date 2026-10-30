import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { AgentMailClient, FakeMail, mailClient, setMailClient } from "./mail";

const GROUP = "6f1c2a7e-0000-4000-8000-000000000001";

describe("FakeMail", () => {
  test("creates one inbox per Group: the same Group gets the same inbox back", async () => {
    const mail = new FakeMail();
    const a = await mail.createInbox(GROUP, "apt-4b-k2x9");
    const b = await mail.createInbox(GROUP, "apt-4b-zzzz");
    assert.deepEqual(a, { inboxId: "apt-4b-k2x9@agentmail.to", address: "apt-4b-k2x9@agentmail.to" });
    assert.deepEqual(b, a);
    assert.equal(mail.inboxes.size, 1);
  });

  test("records sends with deterministic ids and starts a thread", async () => {
    const mail = new FakeMail();
    const { inboxId } = await mail.createInbox(GROUP, "apt-4b-k2x9");
    const sent = await mail.send(inboxId, { to: "leasing@brookfieldresidential.com", subject: "Leaking kitchen sink", text: "Hi," });
    assert.deepEqual(sent, { messageId: "fake-msg-1", threadId: "fake-thread-1" });
    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0].to, "leasing@brookfieldresidential.com");
    assert.equal(mail.sent[0].threadId, "fake-thread-1");
  });

  test("a reply stays in the thread of the message it answers and goes to its sender", async () => {
    const mail = new FakeMail();
    const { inboxId } = await mail.createInbox(GROUP, "apt-4b-k2x9");
    const inbound = mail.receive(inboxId, {
      from: "Brookfield Leasing <leasing@brookfieldresidential.com>",
      subject: "Annual inspection, Nov 3",
      text: "We will be inspecting smoke detectors on November 3 between 9am and noon.",
    });
    const r = await mail.reply(inboxId, inbound.messageId, { text: "Thanks, could it be Thursday instead?" });
    assert.equal(r.threadId, inbound.threadId);
    assert.equal(mail.sent[0].to, "Brookfield Leasing <leasing@brookfieldresidential.com>");
    assert.equal(mail.sent[0].subject, "Re: Annual inspection, Nov 3");
  });

  test("getMessage returns an inbound message with its attachments; fetchAttachment returns the bytes", async () => {
    const mail = new FakeMail();
    const { inboxId } = await mail.createInbox(GROUP, "apt-4b-k2x9");
    const m = mail.receive(inboxId, {
      from: "leasing@brookfieldresidential.com",
      subject: "Your lease",
      text: "Attached.",
      attachments: [{ filename: "lease.pdf", contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7 lease") }],
    });
    const got = await mail.getMessage(inboxId, m.messageId);
    assert.equal(got.subject, "Your lease");
    assert.equal(got.attachments.length, 1);
    const link = await mail.getAttachment(inboxId, m.messageId, got.attachments[0].attachmentId);
    assert.equal((await mail.fetchAttachment(link.downloadUrl)).toString(), "%PDF-1.7 lease");
  });

  test("an unknown message is an error, not undefined", async () => {
    const mail = new FakeMail();
    await assert.rejects(mail.getMessage("nope@agentmail.to", "fake-msg-9"), /No such message/);
  });
});

describe("mailClient()", () => {
  const saved = { fake: process.env.MAIL_FAKE, key: process.env.AGENTMAIL_API_KEY };
  afterEach(() => {
    setMailClient(null);
    process.env.MAIL_FAKE = saved.fake;
    process.env.AGENTMAIL_API_KEY = saved.key;
    if (saved.fake === undefined) delete process.env.MAIL_FAKE;
    if (saved.key === undefined) delete process.env.AGENTMAIL_API_KEY;
  });

  test("is the fake without a key or with MAIL_FAKE=1, AgentMail with a key", () => {
    delete process.env.MAIL_FAKE;
    delete process.env.AGENTMAIL_API_KEY;
    assert.equal(mailClient().kind, "fake");
    process.env.AGENTMAIL_API_KEY = "am_test_key";
    assert.ok(mailClient() instanceof AgentMailClient);
    process.env.MAIL_FAKE = "1";
    assert.equal(mailClient().kind, "fake");
  });

  test("setMailClient wins", () => {
    const mine = new FakeMail();
    setMailClient(mine);
    assert.equal(mailClient(), mine);
  });
});
