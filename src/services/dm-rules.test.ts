// DMs, pure (ADR 0020): which Group a DM is about, the prefix, the Start hint, the Echo rule.
// Run: npx tsx --test src/services/dm-rules.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { afterPrivateRun, groupPrefix, matchGroupName, NUDGE_CONTEXT_MS, pickDmGroup, startHint, startHintDue, START_HINT_MS, type RunChange } from "./dm-rules";

const APT = { groupId: "apt", name: "Apt 4B", memberId: "dev-apt" };
const LISBON = { groupId: "lis", name: "Lisbon trip", memberId: "dev-lis" };
const now = new Date("2026-10-30T18:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

test("which Group: a fresh nudge, then the last DM'd Group, then the only one, else ask once", () => {
  const both = [APT, LISBON];
  assert.deepEqual(pickDmGroup({ candidates: both, nudge: { groupId: "lis", at: ago(60_000) }, lastDm: { groupId: "apt", at: ago(1000) }, now }), { groupId: "lis", via: "nudge" });
  assert.deepEqual(pickDmGroup({ candidates: both, nudge: { groupId: "lis", at: ago(NUDGE_CONTEXT_MS + 1) }, lastDm: { groupId: "apt", at: ago(1000) }, now }), { groupId: "apt", via: "dm" }, "a day-old nudge no longer counts");
  assert.deepEqual(pickDmGroup({ candidates: [APT], now }), { groupId: "apt", via: "only" });
  assert.deepEqual(pickDmGroup({ candidates: both, now }), { ask: "Which group is this about: Apt 4B or Lisbon trip?" });
  assert.deepEqual(pickDmGroup({ candidates: both, lastDm: { groupId: "gone", at: ago(1) }, now }), { ask: "Which group is this about: Apt 4B or Lisbon trip?" }, "a Group they left");
});

test("'for Lisbon: what do I owe' switches explicitly; the answer to 'which group' is matched by name", () => {
  const both = [APT, LISBON];
  assert.deepEqual(groupPrefix("for Lisbon: what do I owe", both), { group: LISBON, rest: "what do I owe" });
  assert.deepEqual(groupPrefix("For apt 4b: paid Maya", both), { group: APT, rest: "paid Maya" });
  assert.equal(groupPrefix("for real: what do I owe", both), null);
  assert.equal(groupPrefix("what do I owe", both), null);
  assert.equal(matchGroupName("lisbon", both), LISBON);
  assert.equal(matchGroupName("the apt 4b one", both), APT);
  assert.equal(matchGroupName("Apt 4B!", both), APT);
  assert.equal(matchGroupName("no idea", both), null);
});

test("the Start hint: at most once in 7 days, never an amount", () => {
  assert.equal(startHintDue(undefined, now), true);
  assert.equal(startHintDue(ago(START_HINT_MS - 1).toISOString(), now), false);
  assert.equal(startHintDue(ago(START_HINT_MS), now), true);
  const line = startHint("Dev", "imroomiebot");
  assert.equal(line, "Dev, I've got something for you; tap @imroomiebot and press Start.");
  assert.ok(!/\$|\d/.test(line.replace("imroomiebot", "")));
});

test("the Echo rule: shared Expense -> one group line; Settlement -> a private line to the other person; personal -> nothing", () => {
  const dev = { actorId: "dev", actorName: "Dev" };
  const pizza: RunChange = { ...dev, kind: "expense.added", summary: "added pizza, $40.00", expense: { description: "pizza", cents: 4000, shareCount: 3 } };
  const paidMaya: RunChange = { ...dev, kind: "settlement.added", summary: "paid Maya $20.00", settlement: { fromId: "dev", fromName: "Dev", toId: "maya", toName: "Maya", cents: 2000 } };
  const oatMilk: RunChange = { ...dev, kind: "cart.added", summary: "added oat milk (personal)" };
  const justMine: RunChange = { ...dev, kind: "expense.added", summary: "added gym, $30.00", expense: { description: "gym", cents: 3000, shareCount: 1 } };
  const fixed: RunChange = { ...dev, kind: "expense.changed", summary: "changed pizza: $40.00 -> $45.00", expense: { description: "pizza", cents: 4500, shareCount: 3 } };

  assert.deepEqual(afterPrivateRun([pizza]), { echo: "Dev logged $40.00 pizza, split 3 ways.", privately: [] });
  assert.deepEqual(afterPrivateRun([paidMaya]), { echo: null, privately: [{ memberId: "maya", text: "Dev paid you $20.00." }] });
  assert.deepEqual(afterPrivateRun([oatMilk]), { echo: null, privately: [] });
  assert.deepEqual(afterPrivateRun([justMine]), { echo: null, privately: [] }, "only Dev's Share: nobody else's Balance moved");
  assert.equal(afterPrivateRun([pizza, fixed, oatMilk]).echo, "Dev logged $40.00 pizza, split 3 ways; changed pizza: $40.00 -> $45.00.", "one line for the run");
  const mayaNotes: RunChange = { actorId: "maya", actorName: "Maya", kind: "settlement.added", summary: "recorded Dev paying Maya $20.00", settlement: { fromId: "dev", fromName: "Dev", toId: "maya", toName: "Maya", cents: 2000 } };
  assert.deepEqual(afterPrivateRun([mayaNotes]).privately, [{ memberId: "dev", text: "Maya noted you paid them $20.00." }]);
});
