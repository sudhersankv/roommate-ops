// Polls and DMs against the dev DB (#24B, ADR 0018, ADR 0020), in throwaway Groups (Apt 4B: Maya, Dev, Sam). No LLM:
// a DM run's tool calls are made as the tools make them (services with source "dm"), then the pipeline's post-run
// step (echoAfterPrivateRun) runs. A capturing dev Channel records every post and DM.
// Run: npx tsx --test src/services/polls-dms.dbtest.ts   (NEVER against production: check .env's DATABASE_URL first)
import "@/lib/env";
import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { registerChannel } from "@/channels";
import { devUserId } from "@/channels/dev";
import { CantMessagePrivatelyError, type Channel, type Outgoing } from "@/channels/types";
import { onGroupJoined } from "@/onboarding";
import { respond } from "@/pipeline";
import { deleteGroup } from "./groups";
import { getExpense, listExpenses, logExpense, settleUp } from "./money";
import { nudgesOff, setNudges, setPaymentHandles, getNote, type Member } from "./members";
import { askConfirm, askGroupDecision, askPoll, closePollsFor, expirePolls, GroupDecisionError, recordVote, resolvePoll, voteOnPoll } from "./polls";
import { currencyOf } from "./groups";
import "@/toolkits/confirm";
import { echoAfterPrivateRun, noteDmContext, nudgeOrHint, resolveDmGroup, runMark } from "./dm";
import { assertNotProdDb } from "../../scripts/lib/prod-guard";

type Out = { to: "chat" | "private"; id: string; msg: Outgoing };
class Capture implements Channel {
  readonly name = "dev" as const;
  readonly nativePolls = false;
  out: Out[] = [];
  refusePrivate = false;
  private n = 0;
  async sendToChat(id: string, msg: Outgoing) {
    this.out.push({ to: "chat", id, msg });
    return msg.poll ? { externalId: `dbtest-poll-${ts}-${++this.n}` } : {};
  }
  async sendPrivate(id: string, msg: Outgoing) {
    if (this.refusePrivate) throw new CantMessagePrivatelyError("tap and press Start");
    this.out.push({ to: "private", id, msg });
    return {};
  }
  async leaveChat() {}
  chat = () => this.out.filter((o) => o.to === "chat");
  dms = () => this.out.filter((o) => o.to === "private");
}

const ts = Date.now();
const channel = new Capture();
const made: string[] = [];
let groupId: string;
let maya: Member, dev: Member, sam: Member;
const as = (m: Member, source: "chat" | "dm" = "chat") => ({ groupId, memberId: m.id, source });
const PIZZA = (cents: number) => ({ kind: "who-in", payerId: maya.id, cents, description: "pizza", category: "food" });

describe("polls and DMs against the dev DB", () => {
  before(async () => {
    await assertNotProdDb(db, "polls-dms.dbtest");
    registerChannel(channel);
    const people = ["Maya", "Dev", "Sam"].map((name) => ({ userExternalId: devUserId(`pd-${name}-${ts}`), name }));
    const joined = await onGroupJoined({ channel: "dev", externalId: `pd-${ts}`, title: `Apt 4B ${ts}` }, people, people[0]);
    groupId = joined.group.id;
    made.push(groupId);
    [maya, dev, sam] = joined.members;
  });
  beforeEach(() => {
    channel.out = [];
    channel.refusePrivate = false;
  });
  after(async () => {
    for (const id of made) await deleteGroup(id);
  });

  test("a who's-in poll: nothing logged while open; a majority resolves it into one Expense among the yes-voters, payer-first cents", async () => {
    const before = (await listExpenses({ groupId })).length;
    const { pollId, asText } = await askPoll(as(maya), { kind: "who-in", question: "Who's in on the $50 pizza?", options: ["I'm in", "Not me"], multi: false, about: PIZZA(5000) });
    assert.equal(asText, true, "the dev Channel has no native polls");
    assert.equal(channel.chat().length, 1);
    assert.deepEqual(channel.chat()[0].msg.poll, { question: "Who's in on the $50 pizza?", options: ["I'm in", "Not me"], multi: false });
    const [row] = await db.select().from(schema.polls).where(eq(schema.polls.id, pollId));
    assert.equal(row.externalId, `dbtest-poll-${ts}-1`);
    assert.equal(row.resolvesAt.getTime() - row.createdAt.getTime() > 119 * 60_000, true, "2 hours");

    const first = await recordVote({ channel: "dev", chatExternalId: `pd-${ts}`, pollExternalId: row.externalId!, userExternalId: dev.channelUserId!, optionIds: [0] });
    assert.deepEqual(first, { counted: true });
    assert.equal((await listExpenses({ groupId })).length, before, "1 of 3: nothing logged yet");
    const second = await recordVote({ channel: "dev", chatExternalId: `pd-${ts}`, pollExternalId: row.externalId!, userExternalId: sam.channelUserId!, optionIds: [0] });
    assert.equal(second.resolved, "majority");
    assert.equal(second.line, "Logged $50.00 pizza, split 3 ways: Maya, Dev and Sam.");
    const [e] = await listExpenses({ groupId }, 1);
    assert.equal(e.description, "pizza");
    assert.equal(e.payerId, maya.id);
    assert.deepEqual(Object.fromEntries((e.splits ?? []).map((s) => [s.name, s.cents])), { Maya: 1667, Dev: 1667, Sam: 1666 }, "leftover cents to the payer first, then list order");
    assert.equal(channel.chat().at(-1)?.msg.text, second.line);
    const late = await recordVote({ channel: "dev", chatExternalId: `pd-${ts}`, pollExternalId: row.externalId!, userExternalId: maya.channelUserId!, optionIds: [1] });
    assert.deepEqual(late, { counted: false }, "resolved once");
    assert.equal((await listExpenses({ groupId })).length, before + 1);
  });

  test("a bare number in the chat is the vote on a text poll (no agent run); the 2 hours resolve it with who answered", async () => {
    const { pollId } = await askPoll(as(maya), { kind: "who-in", question: "Who's in on the $30 tacos?", options: ["I'm in", "Not me"], multi: false, about: { ...PIZZA(3000), description: "tacos" } });
    const r = await respond({ groupId, member: sam, text: "2", source: "chat", channel: "dev" });
    assert.equal(r.out, null);
    assert.equal(r.gate.reason, "poll-vote");
    const [vote] = await db.select().from(schema.pollVotes).where(and(eq(schema.pollVotes.pollId, pollId), eq(schema.pollVotes.memberId, sam.id)));
    assert.deepEqual(vote.optionIds, [1]);
    assert.equal((await listExpenses({ groupId }, 1))[0]?.description === "tacos", false, "1 of 3: still open");
    assert.ok((await expirePolls(new Date(Date.now() + 2 * 60 * 60_000 + 60_000))) >= 1);
    const [e] = await listExpenses({ groupId }, 1);
    assert.equal(e.description, "tacos");
    assert.deepEqual((e.splits ?? []).map((s) => s.name).sort(), ["Maya"], "Sam was out, Dev never answered: just the payer");
    assert.equal(channel.chat().at(-1)?.msg.text, "Logged $30.00 tacos, just Maya.");
  });

  test("the payer's own text closes their poll: nothing is logged from it", async () => {
    const before = (await listExpenses({ groupId })).length;
    const { pollId } = await askPoll(as(maya), { kind: "who-in", question: "Who's in on the $24 wings?", options: ["I'm in", "Not me"], multi: false, about: { ...PIZZA(2400), description: "wings" } });
    await voteOnPoll(pollId, dev.id, [0]);
    assert.equal(await closePollsFor(groupId, "who-in", { by: sam.id }), 0, "only the asker's text closes it");
    assert.equal(await closePollsFor(groupId, "who-in", { by: maya.id }), 1);
    assert.deepEqual(await voteOnPoll(pollId, sam.id, [0]), { counted: false });
    assert.equal((await listExpenses({ groupId })).length, before);
  });

  test("a DM 'paid Maya': a Settlement, one private line to Maya, nothing in the group", async () => {
    const since = await runMark();
    await settleUp(as(dev, "dm"), { toId: maya.id, cents: 2000 });
    const plan = await echoAfterPrivateRun(groupId, dev.id, since);
    assert.equal(plan.echo, null);
    assert.equal(channel.chat().length, 0, "no deliver to the group");
    assert.deepEqual(channel.dms().map((d) => [d.id, d.msg.text]), [[maya.channelUserId, "Dev paid you $20.00."]]);
    const [a] = await db.select().from(schema.activity).where(and(eq(schema.activity.groupId, groupId), eq(schema.activity.kind, "settlement.added")));
    assert.equal(a.source, "dm");
  });

  test("a DM 'I paid 40 for pizza': the Expense, and one group line", async () => {
    const since = await runMark();
    const e = await logExpense(as(dev, "dm"), { cents: 4000, description: "pizza", category: "food" });
    const plan = await echoAfterPrivateRun(groupId, dev.id, since);
    assert.equal(plan.echo, "Dev logged $40.00 pizza, split 3 ways.");
    assert.deepEqual(channel.chat().map((c) => c.msg.text), [plan.echo]);
    assert.equal(channel.dms().length, 0);
    assert.equal((await getExpense({ groupId }, e.id))?.splits?.length, 3);
  });

  test("a Member of two Groups: a fresh nudge context picks that Group; otherwise Roomie asks once and the answer runs the held message", async () => {
    const tg = `tg-dev-${ts}`;
    const allowed = { newGroupAllowed: async () => true };
    const apt = await onGroupJoined({ channel: "telegram", externalId: `-pd-apt-${ts}`, title: `Apt 4B` }, [{ userExternalId: tg, name: "Dev" }], { userExternalId: tg, name: "Dev" }, allowed);
    const lis = await onGroupJoined({ channel: "telegram", externalId: `-pd-lis-${ts}`, title: `Lisbon trip` }, [{ userExternalId: tg, name: "Dev" }], { userExternalId: tg, name: "Dev" }, allowed);
    made.push(apt.group.id, lis.group.id);
    const ask = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "what do I owe?" });
    assert.deepEqual(ask, { kind: "say", text: "Which group is this about: Apt 4B or Lisbon trip?" });
    const answered = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "lisbon" });
    assert.equal(answered.kind === "group" && answered.groupId, lis.group.id);
    assert.equal(answered.kind === "group" && answered.text, "what do I owe?", "the held question runs there");
    const remembered = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "and Sam?" });
    assert.equal(remembered.kind === "group" && remembered.groupId, lis.group.id, "remembered for next time");

    await noteDmContext(apt.members[0].id, apt.group.id, "nudge");
    const nudged = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "paid" });
    assert.equal(nudged.kind === "group" && nudged.groupId, apt.group.id, "a reply to a nudge is about the nudge's Group");
    assert.equal(nudged.kind === "group" && nudged.member.id, apt.members[0].id);

    const explicit = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "for Lisbon: what do I owe" });
    assert.equal(explicit.kind === "group" && explicit.groupId, lis.group.id);
    assert.equal(explicit.kind === "group" && explicit.text, "what do I owe");
    const afterPrefix = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "and Sam?" });
    assert.equal(afterPrefix.kind === "group" && afterPrefix.groupId, lis.group.id, "an explicit choice beats the earlier nudge");
  });

  test("a DM that says which Group it means switches there (issue #9: 'actually 564', 'no wait 4107, that's the group')", async () => {
    const tg = `tg-sw-${ts}`;
    const allowed = { newGroupAllowed: async () => true };
    const join = (title: string) => onGroupJoined({ channel: "telegram", externalId: `-sw-${title}-${ts}`.replace(/\s+/g, ""), title }, [{ userExternalId: tg, name: "Sudhersan" }], { userExternalId: tg, name: "Sudhersan" }, allowed);
    const test1 = await join("Roomietest");
    const a564 = await join("Apt 564");
    const a4107 = await join("Apt 4107");
    made.push(test1.group.id, a564.group.id, a4107.group.id);

    await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "Yooo" });
    const picked = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "roomietest" });
    assert.equal(picked.kind === "group" && picked.groupId, test1.group.id);

    const to564 = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "actually,564" });
    assert.deepEqual(to564, { kind: "say", text: "Got it, Apt 564. What's up?" });
    const in564 = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "what do I owe?" });
    assert.equal(in564.kind === "group" && in564.groupId, a564.group.id, "the switch sticks");

    await noteDmContext(a564.members[0].id, a564.group.id, "nudge");
    const to4107 = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "No wait 4107, that's the group" });
    assert.deepEqual(to4107, { kind: "say", text: "Got it, Apt 4107. What's up?" });
    const in4107 = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "what do I owe?" });
    assert.equal(in4107.kind === "group" && in4107.groupId, a4107.group.id, "a switch beats an earlier nudge from another Group");

    const amount = await resolveDmGroup({ channel: "telegram", userExternalId: tg, text: "564" });
    assert.equal(amount.kind === "group" && amount.groupId, a4107.group.id, "a bare number stays where it is (it may be an amount)");
    assert.equal(amount.kind === "group" && amount.text, "564");
  });

  test("set_nudges flips the note and keeps the rest of it", async () => {
    await setPaymentHandles(as(sam), { venmo: "sam-k" });
    assert.equal(await nudgesOff(sam.id), false);
    await setNudges(as(sam), { on: false });
    assert.equal(await nudgesOff(sam.id), true);
    await setNudges(as(sam), { on: true });
    assert.equal(await nudgesOff(sam.id), false);
    assert.equal((await getNote(sam.id)).handles?.venmo, "sam-k");
  });

  test("no DM path: one neutral group line, then quiet for a week; never the content", async () => {
    channel.refusePrivate = true;
    assert.equal(await nudgeOrHint(dev.id, groupId, { text: "You owe Maya $20.00" }), "hint");
    assert.deepEqual(channel.chat().map((c) => c.msg.text), ["Dev, I've got something for you; open a chat with me and press Start."]);
    assert.equal(await nudgeOrHint(dev.id, groupId, { text: "You owe Maya $20.00" }), "quiet");
    assert.equal(channel.chat().length, 1);
    channel.refusePrivate = false;
    assert.equal(await nudgeOrHint(dev.id, groupId, { text: "You owe Maya $20.00" }), "private");
  });

  test("a confirm poll (live test #10): only the asked Admin's tap counts; ✅ runs exactly the pinned change, ❌ leaves it", async () => {
    const vote = async (m: Member, option: number) => {
      const [row] = await db.select().from(schema.polls).where(and(eq(schema.polls.groupId, groupId), eq(schema.polls.kind, "confirm"))).orderBy(schema.polls.createdAt);
      const open = (await db.select().from(schema.polls).where(and(eq(schema.polls.groupId, groupId), eq(schema.polls.kind, "confirm")))).filter((p) => !p.resolvedAt);
      return recordVote({ channel: "dev", chatExternalId: `pd-${ts}`, pollExternalId: (open[0] ?? row).externalId!, userExternalId: m.channelUserId!, optionIds: [option] });
    };
    await askConfirm(as(maya), { question: "Change the group's currency to INR?", toolId: "set_group_settings", input: { currency: "INR" } });
    assert.deepEqual(channel.chat().at(-1)?.msg.poll, { question: "Change the group's currency to INR?", options: ["✅ Yes", "❌ No"], multi: false });

    assert.deepEqual(await vote(dev, 0), { counted: true }, "Dev wasn't asked: his tap changes nothing");
    assert.equal(await currencyOf(groupId), "USD");
    const yes = await vote(maya, 0);
    assert.equal(yes.resolved, "answered");
    assert.equal(await currencyOf(groupId), "INR", "Maya's ✅ ran the pinned call");
    assert.ok(yes.line, "one line in the chat");
    assert.deepEqual(await vote(maya, 0), { counted: false }, "resolved once");

    await askConfirm(as(maya), { question: "Change the group's currency to USD?", toolId: "set_group_settings", input: { currency: "USD" } });
    const no = await vote(maya, 1);
    assert.equal(no.line, "Okay, leaving it as it is.");
    assert.equal(await currencyOf(groupId), "INR", "❌ changes nothing");

    await db.update(schema.groups).set({ currency: "USD" }).where(eq(schema.groups.id, groupId));
  });

  describe("a group decision (#42): the first ✅ from any active Member does it", () => {
    const open = async () => (await db.select().from(schema.polls).where(and(eq(schema.polls.groupId, groupId), eq(schema.polls.kind, "confirm")))).filter((p) => !p.resolvedAt).at(-1);
    const tap = async (externalId: string, userExternalId: string, option: number) =>
      recordVote({ channel: "dev", chatExternalId: `pd-${ts}`, pollExternalId: externalId, userExternalId, optionIds: [option] });
    const trashRuns = async () => (await db.select().from(schema.chores).where(and(eq(schema.chores.groupId, groupId), eq(schema.chores.name, "Trash run")))).length;
    const TRASH = { name: "Trash run", everyDays: 3, rotation: ["Sam", "Maya", "Dev"] };

    test("Dev (not the asker, not an Admin) taps ✅: the chore is added once, as Dev; Sam's second ✅ adds nothing", async () => {
      await askGroupDecision(as(maya), { question: "Add Trash run, every 3 days, Sam first?", toolId: "chore_add", input: TRASH });
      assert.deepEqual(channel.chat().at(-1)?.msg.poll, { question: "Add Trash run, every 3 days, Sam first?", options: ["✅ Yes", "❌ No"], multi: false });
      const poll = (await open())!;
      assert.equal(await trashRuns(), 0, "nothing until someone answers");
      const yes = await tap(poll.externalId!, dev.channelUserId!, 0);
      assert.equal(yes.resolved, "answered");
      assert.match(yes.line ?? "", /^Dev said yes\./);
      assert.equal(channel.chat().at(-1)?.msg.text, yes.line, "one line in the chat");
      assert.equal(await trashRuns(), 1);
      const [added] = await db.select().from(schema.activity).where(and(eq(schema.activity.groupId, groupId), eq(schema.activity.kind, "chore.added"))).orderBy(desc(schema.activity.createdAt));
      assert.equal(added?.actorMemberId, dev.id, "run as the voter");
      assert.deepEqual(await tap(poll.externalId!, sam.channelUserId!, 0), { counted: false }, "resolved once");
      assert.equal(await trashRuns(), 1, "two ✅, one Trash run");
    });

    test("a Pending Member's tap is ignored; ❌ from an active Member drops it", async () => {
      const [priya] = await db
        .insert(schema.members)
        .values({ groupId, displayName: "Priya", role: "member", status: "pending", channelUserId: devUserId(`pd-Priya-${ts}`) })
        .returning();
      const before = (await listExpenses({ groupId })).length;
      await askGroupDecision(as(sam), { question: "Split the $60 internet three ways?", toolId: "log_expense", input: { amount: 60, description: "internet", category: "utilities", payer: "Sam" } });
      const poll = (await open())!;
      assert.deepEqual(await tap(poll.externalId!, priya.channelUserId!, 0), { counted: false }, "Pending: doesn't count");
      assert.deepEqual(await voteOnPoll(poll.id, priya.id, [0]), { counted: false }, "not by the numbered path either");
      assert.equal((await listExpenses({ groupId })).length, before);
      assert.equal((await open())?.id, poll.id, "still open");
      const no = await tap(poll.externalId!, dev.channelUserId!, 1);
      assert.equal(no.resolved, "answered");
      assert.equal(no.line, "Okay, dropping that.");
      assert.equal((await listExpenses({ groupId })).length, before, "❌ logs nothing");
      assert.deepEqual(await tap(poll.externalId!, maya.channelUserId!, 0), { counted: false }, "a later ✅ can't bring it back");
      assert.equal((await listExpenses({ groupId })).length, before);
    });

    test("nobody answers: it lapses after 30 minutes and does nothing", async () => {
      const before = channel.chat().length;
      await askGroupDecision(as(maya), { question: "Add Recycling, every 7 days?", toolId: "chore_add", input: { name: "Recycling", everyDays: 7 } });
      const poll = (await open())!;
      assert.ok(Math.abs(poll.resolvesAt.getTime() - poll.createdAt.getTime() - 30 * 60_000) < 5_000, "30 minutes, like a confirm poll");
      // What expirePolls does for it after 30 minutes (called directly: the dev DB is shared, other tests' polls stay open).
      assert.equal(await resolvePoll(poll.id, "expired", new Date(Date.now() + 31 * 60_000)), null);
      const [row] = await db.select().from(schema.polls).where(eq(schema.polls.id, poll.id));
      assert.ok(row.resolvedAt);
      assert.equal((await db.select().from(schema.chores).where(and(eq(schema.chores.groupId, groupId), eq(schema.chores.name, "Recycling")))).length, 0);
      assert.equal(channel.chat().length, before + 1, "just the poll, no line after it");
    });

    test("an admin change can't be pinned as a group decision (nothing is sent)", async () => {
      const before = channel.chat().length;
      await assert.rejects(askGroupDecision(as(maya), { question: "Take the dishes off the chart?", toolId: "chore_remove", input: { chore: "dishes" } }), GroupDecisionError);
      await assert.rejects(askGroupDecision(as(maya), { question: "Change the rent?", toolId: "set_rent", input: { amount: 2400 } }), GroupDecisionError);
      await assert.rejects(askGroupDecision(as(maya), { question: "Add eggs?", toolId: "cart_add", input: { items: ["eggs"] } }), GroupDecisionError, "routine adds aren't group decisions");
      assert.equal(channel.chat().length, before);
    });
  });
});
