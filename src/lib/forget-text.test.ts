import { test } from "node:test";
import assert from "node:assert/strict";
import { anonymize, isLineFrom, lineBody, mentions, photoUrls, senderOf } from "./forget-text";

test("isLineFrom and senderOf read the pipeline's sender tags", () => {
  assert.ok(isLineFrom("[Maya] hi", "maya"));
  assert.ok(isLineFrom("[voice note from Maya] hi", "Maya"));
  assert.ok(!isLineFrom("[Mayank] hi", "Maya"));
  assert.ok(!isLineFrom("[Maya] hi", " "));
  assert.equal(senderOf("[+15551234567] hello"), "+15551234567");
  assert.equal(senderOf("[voice note from Sam] yo"), "Sam");
  assert.equal(senderOf("no tag"), null);
});

test("lineBody makes a memory line and its chat log row compare equal", () => {
  assert.equal(lineBody("[Maya] [photo: /uploads/tg/-1/a.jpg] split this"), "split this");
  assert.equal(lineBody("(photo) split this"), "split this");
  assert.equal(lineBody("[voice note from Sam] buy milk"), lineBody("(voice) buy milk"));
  assert.equal(lineBody("  plain  "), "plain");
});

test("photoUrls finds every photo tag", () => {
  assert.deepEqual(photoUrls("[Maya] [photo: https://roomie.fly.dev/uploads/wa/123/x.jpg] look"), ["https://roomie.fly.dev/uploads/wa/123/x.jpg"]);
  assert.deepEqual(photoUrls("[Maya] nothing"), []);
});

test("mentions matches whole words only", () => {
  assert.ok(mentions("Sam owes Maya $12", "maya"));
  assert.ok(!mentions("Mayank paid", "Maya"));
  assert.ok(mentions("ask +15551234567 later", "+15551234567"));
  assert.ok(!mentions("a b c", "a"), "one-letter names never match");
});

test("anonymize swaps every name a Member went by, longest first", () => {
  assert.equal(anonymize("Maya R added rent; Maya paid; Mayank too", ["Maya", "Maya R"], "Former member"), "Former member added rent; Former member paid; Mayank too");
  assert.equal(anonymize("+15551234567 joined", ["+15551234567"], "Former member"), "Former member joined");
  assert.equal(anonymize("nothing here", [], "Former member"), "nothing here");
});
