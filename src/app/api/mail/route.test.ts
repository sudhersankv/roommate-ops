// The Lease Inbox webhook's front door, without a DB: Svix on the raw body (good -> 204 and queued by inbox, tampered
// or unsigned -> 401), the fake header only with MAIL_FAKE outside production, events that aren't received mail
// acknowledged and dropped. The DB side (stored once per event_id) is in services/lease-inbox-toolkit.dbtest.ts.
// Run: npx tsx --test src/app/api/mail/route.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Webhook } from "svix";
import type { MailEvent } from "@/services/lease-inbox-inbound";
import { mailWebhook, type MailWebhookDeps } from "./webhook";

const SECRET = `whsec_${Buffer.from("apt-4b-test-secret-0123456789abcdef").toString("base64")}`;

const payload = (eventId = "evt_01JBX3K7Q2", over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "event",
    event_type: "message.received",
    event_id: eventId,
    message: {
      inbox_id: "apt-4b-x7k2@agentmail.to",
      thread_id: "thd_inspection",
      message_id: "<CAF=inspection@brookfieldresidential.com>",
      from: "Brookfield Residential Leasing <leasing@brookfieldresidential.com>",
      to: ["apt-4b-x7k2@agentmail.to"],
      subject: "Annual Unit Inspection - November 3",
      text: "Dear Resident, our maintenance team will complete the annual smoke detector inspection on Tuesday, November 3.",
      timestamp: "2026-10-27T20:14:00.000Z",
      labels: ["received"],
      attachments: [{ attachment_id: "att_1", filename: "Inspection_Notice.pdf", content_type: "application/pdf", size: 48213 }],
      ...over,
    },
    thread: {},
  });

const signed = (body: string, id = "msg_2abc") => {
  const ts = new Date();
  return {
    "svix-id": id,
    "svix-timestamp": String(Math.floor(ts.getTime() / 1000)),
    "svix-signature": new Webhook(SECRET).sign(id, ts, body),
  };
};

const post = (body: string, headers: Record<string, string>) => new Request("https://roomie.example/api/mail", { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

const harness = (over: Partial<MailWebhookDeps> = {}) => {
  const queued: { key: string }[] = [];
  const handled: MailEvent[] = [];
  const deps: MailWebhookDeps = {
    secret: SECRET,
    fakeAllowed: false,
    handle: async (e) => void handled.push(e),
    queue: { push: (key, task) => void (queued.push({ key }), task()) },
    ...over,
  };
  return { deps, queued, handled };
};

describe("POST /api/mail", () => {
  test("a good signature: 204 with no body, queued by inbox id, parsed into the email", async () => {
    const h = harness();
    const body = payload();
    const res = await mailWebhook(post(body, signed(body)), h.deps);
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");
    assert.deepEqual(h.queued.map((q) => q.key), ["apt-4b-x7k2@agentmail.to"]);
    const e = h.handled[0];
    assert.equal(e.eventId, "evt_01JBX3K7Q2");
    assert.equal(e.message?.from, "Brookfield Residential Leasing <leasing@brookfieldresidential.com>");
    assert.equal(e.message?.threadId, "thd_inspection");
    assert.deepEqual(e.message?.attachments, [{ attachmentId: "att_1", filename: "Inspection_Notice.pdf", contentType: "application/pdf", size: 48213 }]);
  });

  test("204 comes back before the work is done", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const h = harness({ queue: { push: (_k, task) => void slow.then(task) } });
    const body = payload();
    const res = await mailWebhook(post(body, signed(body)), h.deps);
    assert.equal(res.status, 204);
    assert.equal(h.handled.length, 0, "not handled yet");
    release();
  });

  test("a tampered body, a wrong secret or no signature: 401, nothing queued", async () => {
    const h = harness();
    const body = payload();
    const headers = signed(body);
    assert.equal((await mailWebhook(post(body.replace("November 3", "November 4"), headers), h.deps)).status, 401);
    assert.equal((await mailWebhook(post(body, { ...headers, "svix-signature": "v1,AAAA" }), h.deps)).status, 401);
    assert.equal((await mailWebhook(post(body, {}), h.deps)).status, 401);
    assert.equal((await mailWebhook(post(body, signed(body)), { ...h.deps, secret: undefined })).status, 401, "no secret configured: nothing gets in");
    assert.equal(h.queued.length, 0);
  });

  test("the fake header counts only with MAIL_FAKE outside production", async () => {
    const body = payload();
    const off = harness();
    assert.equal((await mailWebhook(post(body, { "x-roomie-fake-mail": "1" }), off.deps)).status, 401);
    const on = harness({ fakeAllowed: true });
    assert.equal((await mailWebhook(post(body, { "x-roomie-fake-mail": "1" }), on.deps)).status, 204);
    assert.equal(on.handled.length, 1);
  });

  test("other events are acknowledged and dropped; unauthenticated mail is kept, labelled; a large body is fetched later", async () => {
    const h = harness();
    for (const type of ["message.sent", "message.delivered", "message.received.spam"]) {
      const body = JSON.stringify({ ...JSON.parse(payload()), event_type: type });
      assert.equal((await mailWebhook(post(body, signed(body)), h.deps)).status, 204);
    }
    assert.equal(h.handled.length, 0);
    const unauth = JSON.stringify({ ...JSON.parse(payload("evt_2")), event_type: "message.received.unauthenticated" });
    await mailWebhook(post(unauth, signed(unauth)), h.deps);
    assert.ok(h.handled[0].message?.labels.includes("unauthenticated"));
    const big = payload("evt_3", { text: null, body_url: "https://agentmail.example/body/abc" });
    await mailWebhook(post(big, signed(big)), h.deps);
    assert.equal(h.handled[1].message, null, "no inline body: the handler fetches it");
  });

  test("only POST", async () => {
    const res = await mailWebhook(new Request("https://roomie.example/api/mail", { method: "GET" }), harness().deps);
    assert.equal(res.status, 405);
  });
});
