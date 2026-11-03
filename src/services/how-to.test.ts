// "How do I ...?" from the manifests (#75). Pure. Run: npx tsx --test src/services/how-to.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { MANIFESTS } from "@/toolkits/manifests";
import { howToFor, trickFor } from "./how-to";

const ask = (q: string) => {
  const m = trickFor(q, MANIFESTS);
  assert.ok(m, `a Trick for "${q}"`);
  return howToFor(q, m);
};

test("trickFor: the Trick a question is about, by its name, tags, abilities and examples", () => {
  assert.equal(trickFor("how do I split rent?", MANIFESTS)?.id, "splitting");
  assert.equal(trickFor("how does the cart work?", MANIFESTS)?.id, "groceries");
  assert.equal(trickFor("what can you do with chores?", MANIFESTS)?.id, "house");
  assert.equal(trickFor("how do I report a leak to the landlord?", MANIFESTS)?.id, "lease-inbox");
  assert.equal(trickFor("how do I settle up?", MANIFESTS)?.id, "splitting");
  assert.equal(trickFor("how do you work?", MANIFESTS), null, "no Trick named: what can you do covers it");
  assert.equal(trickFor("how do I split rent?", MANIFESTS.filter((m) => m.id === "house")), null, "only the Tricks given");
});

test("how do I split rent? -> the rent ability and a rent phrase to try", () => {
  const h = ask("how do I split rent?");
  assert.equal(h.trick, "Money");
  assert.match(h.what, /rent/i);
  assert.match(h.tryIt, /^roomie, .*rent/i);
  assert.match(h.say, /^Track the rent[^.]*\. Just say "roomie, rent is 2400 on the 1st, Maya pays"\.$/);
});

test("how does the cart work? / what can you do with chores? -> the Trick's summary and a phrase", () => {
  const cart = ask("how does the cart work?");
  assert.equal(cart.what, "One shared Cart, recipes for the group, and an Instacart list.");
  assert.match(cart.say, /Just say "roomie, [^"]+"\.$/);
  assert.ok(!/\(/.test(cart.tryIt), "never an example with a stage direction in it");
  const chores = ask("what can you do with chores?");
  assert.equal(chores.trick, "House");
  assert.match(chores.say, /^The chore chart[^.]*\. Just say "roomie, [^"]+"\.$/);
});

test("a specific question picks the matching ability and example; admin-only ones lose ties", () => {
  const settle = ask("how do I settle up with Sam?");
  assert.match(settle.what, /^Settle up with pay links/);
  assert.equal(settle.tryIt, "roomie, settle up with Sam");
  const receipt = ask("how do receipts work?");
  assert.match(receipt.what, /receipt/i);
  const skip = ask("how do I skip my turn on trash?");
  assert.match(skip.what, /^Pass your turn/);
  assert.equal(skip.tryIt, "roomie, skip my turn on trash");
  const say = ask("how do I split rent?").say.split(". ");
  assert.ok(say.length <= 3, "one or two lines");
});
