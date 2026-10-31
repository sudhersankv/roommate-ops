// The Lease Inbox classifier's contract: the model's JSON is validated here; a bad answer gets one retry, then the
// email is filed as other. No model, no DB. Run: npx tsx --test src/services/mail-classifier.test.ts
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { classifierPrompt, classifyWith, FALLBACK, keywordClassifier, parseClassification } from "./mail-classifier";
import type { ClassifyInput } from "./lease-inbox";

const input = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  from: "Brookfield Residential Leasing <leasing@brookfieldresidential.com>",
  subject: "Annual Unit Inspection - November 3",
  text: "Our maintenance team will complete the annual smoke detector inspection in your unit on Tuesday, November 3 between 9:00 AM and 12:00 PM.",
  timezone: "America/Chicago",
  now: new Date("2026-10-30T15:00:00Z"),
  workOrderTitle: null,
  ...over,
});

describe("parseClassification", () => {
  test("a notice with a local date", () => {
    assert.deepEqual(parseClassification(`{"class":"notice","date":"2026-11-03T09:00","summary":"smoke detector inspection Tuesday Nov 3, 9am-noon"}`), {
      class: "notice",
      date: "2026-11-03T09:00",
      summary: "smoke detector inspection Tuesday Nov 3, 9am-noon",
    });
  });

  test("amounts as written become cents in code; prose around the JSON is ignored", () => {
    const c = parseClassification(`Here you go:\n{"class":"rent-lease","amount":"$2,550.00","summary":"rent goes to $2,550 from January 1"}`);
    assert.equal(c.amountCents, 255_000);
    assert.equal(parseClassification(`{"class":"other","amount":92.4,"utility":"electric","summary":"ComEd bill"}`).amountCents, 9240);
  });

  test("a bad date or reply is dropped, not fatal; nulls are left out", () => {
    const c = parseClassification(`{"class":"notice","date":"next Tuesday","reply":"maybe","utility":null,"summary":"pest control visit"}`);
    assert.deepEqual(c, { class: "notice", summary: "pest control visit" });
  });

  test("an unknown class, no summary or no JSON is a format error", () => {
    assert.throws(() => parseClassification(`{"class":"spam","summary":"x"}`), /class/);
    assert.throws(() => parseClassification(`{"class":"other"}`), /summary/);
    assert.throws(() => parseClassification("It's a notice about an inspection."), /JSON/);
  });
});

describe("classifyWith", () => {
  test("one retry with the error as feedback, then the good answer", async () => {
    const prompts: string[] = [];
    const answers = ["sure! it's a notice", `{"class":"notice","date":"2026-11-03","summary":"smoke detector inspection Nov 3"}`];
    const c = await classifyWith(async (p) => (prompts.push(p), answers.shift()!), input());
    assert.equal(c.class, "notice");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1], /Your last answer was rejected: The answer wasn't a JSON object/);
  });

  test("two bad answers -> other, with the subject as the summary", async () => {
    let calls = 0;
    const c = await classifyWith(async () => (calls++, `{"class":"urgent"}`), input());
    assert.equal(calls, 2);
    assert.deepEqual(c, FALLBACK(input()));
    assert.deepEqual(c, { class: "other", summary: "Annual Unit Inspection - November 3" });
  });

  test("a failed call -> other", async () => {
    const c = await classifyWith(async () => { throw new Error("gateway 529"); }, input());
    assert.equal(c.class, "other");
  });

  test("a work-order answer without a work order is other", async () => {
    const c = await classifyWith(async () => `{"class":"work-order","reply":"scheduled","summary":"plumber Tuesday"}`, input());
    assert.equal(c.class, "other");
  });

  test("the prompt carries today in the Group's zone and the work order", () => {
    const p = classifierPrompt(input({ workOrderTitle: "the leaking kitchen sink" }));
    assert.match(p, /Today is Friday, October 30, 2026/);
    assert.match(p, /"the leaking kitchen sink"/);
  });
});

describe("keywordClassifier (evals)", () => {
  test("inspection -> notice, rent -> rent-lease, a bill -> other with the utility", async () => {
    assert.equal((await keywordClassifier.classify(input())).class, "notice");
    const rent = await keywordClassifier.classify(input({ subject: "Lease renewal", text: "Your rent will be $2,550.00 from January 1." }));
    assert.deepEqual([rent.class, rent.amountCents], ["rent-lease", 255_000]);
    const bill = await keywordClassifier.classify(input({ subject: "Your ComEd statement", text: "Your electric bill is ready. Amount due: $92.40" }));
    assert.deepEqual([bill.class, bill.utility, bill.amountCents], ["other", "electric", 9240]);
  });
});
