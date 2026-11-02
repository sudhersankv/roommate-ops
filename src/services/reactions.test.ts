// Reactions (#77): when a run may answer with an emoji instead of a line.
// Run: npx tsx --test src/services/reactions.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerFor, choreDoneReaction, DONE, nextUpWorthSaying, OK, reactedLine, reactionOffer, readReply, settledReaction } from "./reactions";

const ACK = "👍";
// A one-person Rotation: Dev is next again, so nothing is worth saying (#70) and the done offers ✅.
const done = { tool: "log_chore", result: { chore: "Trash", doneBy: "Dev", streak: 1, added: false, react: DONE } };
const paid = { tool: "settle_up", result: { recorded: true, amount: "$20.00", stillOwed: "square now", react: OK } };

test("the tools' offers: a done on a chore already on the chart, a payment that leaves the two square", () => {
  assert.equal(choreDoneReaction({ added: false, nextUp: "Dev", doneBy: "Dev" }), DONE, "next is the same person: nothing to say");
  assert.equal(choreDoneReaction({ added: false, nextUp: null, doneBy: "Dev" }), DONE);
  assert.equal(choreDoneReaction({ added: true, nextUp: null, doneBy: "Dev" }), undefined, "a new chore on the chart is news");
  assert.equal(choreDoneReaction({ added: false, nextUp: "Sam", doneBy: "Dev" }), undefined, "#70: who's next is worth a line, so a reply instead of ✅");
  assert.equal(settledReaction({ square: true }), OK);
  assert.equal(settledReaction({ square: false }), undefined, "money still owed is worth a line");
});

test("nextUpWorthSaying (#70): someone other than whoever just did it", () => {
  assert.equal(nextUpWorthSaying({ nextUp: "Sam", doneBy: "Dev" }), "Sam");
  assert.equal(nextUpWorthSaying({ nextUp: "Dev", doneBy: "Dev" }), null);
  assert.equal(nextUpWorthSaying({ nextUp: null, doneBy: "Dev" }), null);
});

test("reactionOffer: every write offers one and nothing failed", () => {
  assert.equal(reactionOffer([done]), DONE);
  assert.equal(reactionOffer([paid]), OK);
  assert.equal(reactionOffer([{ tool: "updateWorkingMemory", result: { success: true } }, done]), DONE, "working memory isn't a write");
  assert.equal(reactionOffer([done, paid]), DONE, "the first offer wins");
  assert.equal(reactionOffer([]), null, "nothing written, nothing to react to");
  assert.equal(reactionOffer([{ tool: "updateWorkingMemory", result: {} }]), null);
  assert.equal(reactionOffer([done, { tool: "chore_status", result: { chores: [] } }]), null, "a read in the run: they asked something");
  assert.equal(reactionOffer([{ tool: "log_chore", result: { ...done.result, react: undefined, added: true } }]), null);
  assert.equal(reactionOffer([done, { tool: "log_expense", result: { error: "SplitError" } }]), null, "one failed write: reply");
  assert.equal(reactionOffer([{ tool: "log_chore", result: { ...done.result, notAllowed: true } }]), null);
  assert.equal(reactionOffer([{ tool: "log_chore", result: { ...done.result, refused: "confirm" } }]), null);
  assert.equal(reactionOffer([{ tool: "settle_up", result: { ...paid.result, links: [{ text: "Venmo", url: "https://venmo.com" }] } }]), null, "a button needs a message");
  assert.equal(reactionOffer([{ tool: "log_chore", result: null }]), null);
  assert.equal(reactionOffer([{ tool: "log_chore", result: "boom" }]), null);
});

test("readReply: what only restates the write", () => {
  for (const r of ["[react]", " [REACT]. ", "*[react]*", "[react ✅]", "", "  ", "Done.", "Got it!", "noted", "Logged.", "Done. Done.", "👍", "✅", "ok"]) assert.equal(readReply(r).restates, true, r);
  for (const r of ["Dishes done. Sam's up next.", "Done, $20.00 to Maya.", "Which trash?", "Dev still owes $5.00.", "Done: trash every 3 days."]) {
    assert.deepEqual(readReply(r), { restates: false, rest: r }, r);
  }
  assert.deepEqual(readReply("[react] wait, which trash?"), { restates: false, rest: "wait, which trash?" }, "changed its mind: the words are sent");
});

test("answerFor: a reaction only with an offer; a cheer rides along as the line", () => {
  assert.deepEqual(answerFor({ reply: "[react]", offer: DONE, ack: ACK }), { text: "", react: DONE });
  assert.deepEqual(answerFor({ reply: "", offer: OK, ack: ACK }), { text: "", react: OK });
  assert.deepEqual(answerFor({ reply: "Done.", offer: DONE, ack: ACK }), { text: "", react: DONE });
  assert.deepEqual(answerFor({ reply: "[react]", offer: DONE, cheer: "Three in a row, Dev.", ack: ACK }), { text: "Three in a row, Dev.", react: DONE });
  assert.deepEqual(answerFor({ reply: "Trash done. Sam's up next.", offer: DONE, ack: ACK }), { text: "Trash done. Sam's up next." }, "Roomie had something to say");
  assert.deepEqual(answerFor({ reply: "Trash done.", offer: DONE, cheer: "Everyone's square!", ack: ACK }), { text: "Trash done. Everyone's square!" });
  // The guard says no: the old behaviour.
  assert.deepEqual(answerFor({ reply: "[react]", offer: null, ack: ACK }), { text: ACK });
  assert.deepEqual(answerFor({ reply: "", offer: null, ack: ACK }), { text: ACK });
  assert.deepEqual(answerFor({ reply: "Done.", offer: null, ack: ACK }), { text: "Done." });
  assert.deepEqual(answerFor({ reply: "Added trash to the chart.", offer: null, ack: ACK }), { text: "Added trash to the chart." });
});

test("reactedLine", () => assert.equal(reactedLine(DONE), "(reacted ✅)"));
