// Polls, pure (ADR 0018): majority, the 2 hours, the asker's text, who's in. Run: npx tsx --test src/services/poll-rules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { numberVote, pollMajority, pollOutcome, POLL_TTL_MS, whoIn } from "./poll-rules";

const MAYA = { id: "maya", displayName: "Maya" };
const DEV = { id: "dev", displayName: "Dev" };
const SAM = { id: "sam", displayName: "Sam" };
const PRIYA = { id: "priya", displayName: "Priya" };
const APT_4B = [MAYA, DEV, SAM];

test("majority of active Members: 2 of 2, 2 of 3, 3 of 4, 3 of 5", () => {
  assert.deepEqual([2, 3, 4, 5].map(pollMajority), [2, 2, 3, 3]);
});

test("a Poll resolves on a majority, after 2 hours, or when the asker's text closes it (that wins)", () => {
  const asked = new Date("2026-10-30T19:00:00Z");
  const resolvesAt = new Date(asked.getTime() + POLL_TTL_MS);
  const at = (min: number) => new Date(asked.getTime() + min * 60_000);
  assert.equal(pollOutcome({ activeCount: 3, voters: 1, now: at(5), resolvesAt }), null, "Dev voted, Maya and Sam haven't");
  assert.equal(pollOutcome({ activeCount: 3, voters: 2, now: at(6), resolvesAt }), "majority");
  assert.equal(pollOutcome({ activeCount: 4, voters: 2, now: at(6), resolvesAt }), null, "half isn't a majority");
  assert.equal(pollOutcome({ activeCount: 4, voters: 2, now: at(119), resolvesAt }), null);
  assert.equal(pollOutcome({ activeCount: 4, voters: 2, now: at(120), resolvesAt }), "expired", "one slow roommate doesn't block the ledger");
  assert.equal(pollOutcome({ activeCount: 3, voters: 0, now: at(121), resolvesAt }), "expired");
  assert.equal(pollOutcome({ activeCount: 3, voters: 2, now: at(3), resolvesAt, closed: true }), "closed", "\"just me and Dev\" wins");
});

test("who's in: 'I'm in' voters plus the payer (unless they voted out), payer first", () => {
  const options = ["I'm in", "Not me"];
  assert.deepEqual(whoIn({ options, votes: [{ memberId: "sam", optionIds: [0] }, { memberId: "dev", optionIds: [0] }], members: APT_4B, payerId: "maya" }), ["maya", "dev", "sam"]);
  assert.deepEqual(whoIn({ options, votes: [{ memberId: "sam", optionIds: [1] }, { memberId: "dev", optionIds: [0] }], members: APT_4B, payerId: "maya" }), ["maya", "dev"]);
  assert.deepEqual(whoIn({ options, votes: [{ memberId: "maya", optionIds: [1] }, { memberId: "dev", optionIds: [0] }], members: APT_4B, payerId: "maya" }), ["dev"], "paid but didn't eat");
});

test("who's in: options that are names put those Members in, whoever ticked them", () => {
  const options = ["Maya", "Dev", "Sam", "Priya"];
  const r = whoIn({ options, votes: [{ memberId: "dev", optionIds: [1, 2] }, { memberId: "sam", optionIds: [2] }], members: [...APT_4B, PRIYA], payerId: "maya" });
  assert.deepEqual(r, ["maya", "dev", "sam"]);
});

test("a bare number answers a text Poll: 1-based in, 0-based out; out of range or several on a single-choice poll: not a vote", () => {
  assert.deepEqual(numberVote("2", 3, false), [1]);
  assert.deepEqual(numberVote(" 1, 3 ", 3, true), [0, 2]);
  assert.deepEqual(numberVote("1 and 2", 3, true), [0, 1]);
  assert.equal(numberVote("1 3", 3, false), null);
  assert.equal(numberVote("4", 3, false), null);
  assert.equal(numberVote("0", 3, false), null);
  assert.equal(numberVote("2 slices left", 3, false), null);
  assert.equal(numberVote("I paid 60", 3, false), null);
});
