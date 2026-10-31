// Email to the operator (beta requests, "I want this" votes). Run: npx tsx --test src/services/operator-mail.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeMail } from "@/integrations/mail";
import { mailOperator, operatorRecipients } from "./operator-mail";

test("recipients come only from OPERATOR_EMAIL (never the code): the first is To, the rest CC", () => {
  assert.equal(operatorRecipients({}), null);
  assert.equal(operatorRecipients({ OPERATOR_EMAIL: "not-an-email" }), null);
  assert.deepEqual(operatorRecipients({ OPERATOR_EMAIL: " a@example.com " }), { to: "a@example.com", cc: [] });
  assert.deepEqual(operatorRecipients({ OPERATOR_EMAIL: "a@example.com, b@example.com ,," }), { to: "a@example.com", cc: ["b@example.com"] });
});

test("mailOperator sends from notify@ to OPERATOR_EMAIL", async () => {
  const mail = new FakeMail();
  const r = await mailOperator("Roomie beta request: Maya", "Maya, 3-4, roommates", { client: mail, env: { OPERATOR_EMAIL: "x@example.com" } });
  assert.equal(r, "sent");
  const sent = mail.sent.at(-1)!;
  assert.equal(sent.to, "x@example.com");
  assert.equal(sent.cc, undefined);
  assert.equal(sent.subject, "Roomie beta request: Maya");
  assert.match(sent.inboxId, /^notify@/);
});

test("nothing is sent without OPERATOR_EMAIL, or under the test runner without an injected client", async () => {
  const mail = new FakeMail();
  assert.equal(await mailOperator("s", "t", { client: mail, env: {} }), "skipped");
  assert.equal(mail.sent.length, 0);
  assert.equal(await mailOperator("s", "t", { env: { OPERATOR_EMAIL: "x@example.com", NODE_TEST_CONTEXT: "child" } }), "skipped");
});
