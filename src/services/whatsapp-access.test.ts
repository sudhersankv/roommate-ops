// The WhatsApp beta allowlist, pure parts (no DB). Run: npx tsx --test src/services/whatsapp-access.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { adderAllowed, envAdders, jidDigits } from "./whatsapp-access";

test("no allowlist at all: anyone may add Roomie (today's behaviour until the operator sets one)", () => {
  assert.equal(adderAllowed("15551234567", []), true);
  assert.equal(adderAllowed(undefined, []), true);
});

test("with one: listed numbers only; a hidden number (LID only) is refused", () => {
  const list = envAdders(" +1 555 123 4567, 4915112345678 ,, 12");
  assert.deepEqual(list, ["15551234567", "4915112345678"], "digits only, junk dropped");
  assert.equal(adderAllowed("15551234567", list), true);
  assert.equal(adderAllowed("4915112345678", list), true);
  assert.equal(adderAllowed("15559999999", list), false);
  assert.equal(adderAllowed(undefined, list), false);
});

test("an entry without the country code (10+ digits) matches the end of the number; short ones never do", () => {
  assert.equal(adderAllowed("15551234567", ["5551234567"]), true);
  assert.equal(adderAllowed("15551234567", ["1234567"]), false);
});

test("jidDigits: the number behind a phone JID, nothing for a LID", () => {
  assert.equal(jidDigits("15551234567@s.whatsapp.net"), "15551234567");
  assert.equal(jidDigits("15551234567:3@s.whatsapp.net"), "15551234567");
  assert.equal(jidDigits("880000000000001@lid"), undefined);
});
