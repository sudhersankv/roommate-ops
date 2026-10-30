import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { datesIn, sendRule, signature, type SendContext, type SendDraft } from "./send-rule";

const NOW = new Date("2026-10-30T15:00:00Z");
const LANDLORD = ["brookfieldresidential.com"];

const ctx = (over: Partial<SendContext> = {}): SendContext => ({
  intent: "reply",
  knownSenders: LANDLORD,
  memberText: "roomie ask them to move the inspection to Thursday",
  memberId: "maya",
  others: [],
  now: NOW,
  ...over,
});
const draft = (body: string, over: Partial<SendDraft> = {}): SendDraft => ({ to: "leasing@brookfieldresidential.com", body, ...over });

describe("sendRule: simple mail sends at once", () => {
  test("a reply in the landlord's thread", () => {
    assert.deepEqual(sendRule(draft("Hi, could the inspection move to Thursday instead? Thanks."), ctx()), { ok: true });
  });
  test("a new maintenance request", () => {
    const c = ctx({ intent: "maintenance", memberText: "roomie the sink's leaking, tell them" });
    assert.deepEqual(sendRule(draft("Hi, the kitchen sink in Apt 4B is leaking under the cabinet. Could someone take a look?"), c), { ok: true });
  });
  test("the intro email", () => {
    assert.deepEqual(sendRule(draft("Hi, this is the shared address for the residents of Apt 4B."), ctx({ intent: "intro", memberText: "send it" })), { ok: true });
  });
  test("a known address on the landlord's domain, any sender there", () => {
    assert.deepEqual(sendRule(draft("Thanks!", { to: "Priya <priya.s@brookfieldresidential.com>" }), ctx()), { ok: true });
  });
  test("a date the Member said, in other words", () => {
    const c = ctx({ memberText: "tell them thurs works, nov 5" });
    assert.deepEqual(sendRule(draft("Thursday, November 5 works for us."), c), { ok: true });
  });
});

describe("sendRule: complex mail asks first", () => {
  const asks = (d: SendDraft, c: SendContext) => {
    const r = sendRule(d, c);
    assert.equal(r.ok, false);
    return (r as { ok: false; ask: string[] }).ask;
  };

  test("a new email that isn't a work order", () => {
    const ask = asks(draft("Hi, we'd like to know if we can paint the living room."), ctx({ intent: "other", memberText: "ask them if we can paint" }));
    assert.deepEqual(ask, ["This isn't a reply or a work order. Send it to leasing@brookfieldresidential.com as it is?"]);
  });

  test("a new recipient", () => {
    const ask = asks(draft("Hi, the sink is leaking.", { to: "help@citywideplumbing.com" }), ctx({ intent: "maintenance" }));
    assert.deepEqual(ask, ["help@citywideplumbing.com hasn't emailed us before. Send it there anyway?"]);
  });

  test("no landlord known yet: every recipient is new", () => {
    assert.equal(asks(draft("Hi"), ctx({ knownSenders: [] })).length, 1);
  });

  test("a currency amount", () => {
    const ask = asks(draft("We'd like the $200 cleaning charge taken off."), ctx({ memberText: "tell them to take the cleaning charge off" }));
    assert.deepEqual(ask, ["It mentions $200. OK to put that amount in writing?"]);
  });

  for (const amount of ["$1,250.00", "1250 dollars", "USD 75", "€40"]) {
    test(`amounts written as ${amount}`, () => {
      assert.equal(asks(draft(`The charge was ${amount}.`), ctx()).length, 1);
    });
  }

  test("a date the Member didn't say", () => {
    const ask = asks(draft("Could the inspection move to Thursday, November 5?"), ctx({ memberText: "ask them to move the inspection" }));
    assert.deepEqual(ask, ['It says "Thursday", "November 5", which you didn\'t say. Is that right?']);
  });

  test("a weekday said, but the draft adds a calendar date", () => {
    const ask = asks(draft("Could it move to Thursday, Nov 5?"), ctx());
    assert.deepEqual(ask, ['It says "Nov 5", which you didn\'t say. Is that right?']);
  });

  const TERMS: [string, string][] = [
    ["We won't be renewing our lease.", "renewing"],
    ["We'd like to terminate the lease early.", "terminate"],
    ["Please treat this as our 60-day notice.", "notice"],
    ["We plan to vacate on the 31st.", "vacate"],
    ["When will the deposit be returned?", "deposit"],
    ["Could you waive the late fee?", "late fee"],
    ["Can Sam sublet his room?", "sublet"],
  ];
  for (const [body, term] of TERMS) {
    test(`lease term: ${term}`, () => {
      const ask = asks(draft(body), ctx({ memberText: "tell them" }));
      assert.ok(ask.some((q) => q.includes(`"${term}"`)), ask.join(" | "));
    });
  }

  test("a lease term in what the Member said counts even when the draft avoids it", () => {
    const ask = asks(draft("We won't be staying past July."), ctx({ memberText: "roomie tell them we're not renewing" }));
    assert.deepEqual(ask, ['This touches the lease ("renewing"). Send it as written?']);
  });

  test("another Member said something else within the hour", () => {
    const c = ctx({ others: [{ memberId: "sam", name: "Sam", text: "keep the inspection on Tuesday", at: new Date(NOW.getTime() - 20 * 60_000) }] });
    assert.deepEqual(asks(draft("Could the inspection move to Thursday instead?"), c), [
      'Sam asked for something else 20 min ago ("keep the inspection on Tuesday"). Which one should I send?',
    ]);
  });

  test("several reasons: one question each", () => {
    const ask = asks(draft("We'll pay the $50 late fee by Friday.", { to: "billing@payrent.example" }), ctx({ memberText: "tell them" }));
    assert.equal(ask.length, 4);
  });
});

describe("sendRule: the conflict window", () => {
  test("the same Member, or another Member over an hour ago, is no conflict", () => {
    const mine = { memberId: "maya", name: "Maya", text: "move it to Tuesday", at: new Date(NOW.getTime() - 5 * 60_000) };
    const old = { memberId: "sam", name: "Sam", text: "keep Tuesday", at: new Date(NOW.getTime() - 61 * 60_000) };
    assert.deepEqual(sendRule(draft("Could it move to Thursday?"), ctx({ others: [mine, old] })), { ok: true });
  });
  test("another Member asking for the same thing is no conflict", () => {
    const same = { memberId: "sam", name: "Sam", text: "ask them to move the inspection to Thursday", at: new Date(NOW.getTime() - 5 * 60_000) };
    assert.deepEqual(sendRule(draft("Could it move to Thursday?"), ctx({ others: [same] })), { ok: true });
  });
});

describe("datesIn", () => {
  test("weekdays, month days, numeric dates and relative days, normalized", () => {
    assert.deepEqual(
      datesIn("Thurs Nov 5, or 11/6, or 2026-11-07, or tomorrow; the 3rd of December").map((d) => d.key),
      ["wd:thursday", "md:11-5", "md:11-6", "md:11-7", "rel:tomorrow", "md:12-3"],
    );
  });
  test("ordinary numbers and words aren't dates", () => {
    assert.deepEqual(datesIn("Apt 4B, unit 12, may we paint? march on"), []);
  });
});

describe("signature", () => {
  test("two lines naming the Group and the Member", () => {
    assert.equal(
      signature("Apt 4B", "Maya Rao"),
      "Sent by Roomie, the shared inbox for the residents of Apt 4B, at Maya Rao's request.\nReplies reach all residents.",
    );
  });
});
