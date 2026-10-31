// DMs (ADR 0020): a private Roomie for the Group. Which Group a person's DM is about (dm_context, the "for <group>:"
// prefix, asking once), what happens after a private run (the Echo rule: shared money moved -> one group line; a
// Settlement -> one private line to the other person) and the no-DM-path fallback (one neutral group line a week).
// The decisions are pure in dm-rules.ts.
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { channelFor, deliver, deliverPrivate } from "@/channels";
import { CantMessagePrivatelyError, type ChannelName, type Outgoing } from "@/channels/types";
import { dbNow, runChanges } from "./activity";
import { logMessage } from "./chatlog";
import { getNote, setNoteKeys, type Member, type NudgeNote } from "./members";
import { afterPrivateRun, groupPrefix, matchGroupName, pickDmGroup, startHint, startHintDue, switchLine, switchTo, type DmCandidate, type RunChange } from "./dm-rules";
import { currencyOf } from "./groups";

export { NUDGE_CONTEXT_MS, START_HINT_MS, afterPrivateRun, pickDmGroup, startHint } from "./dm-rules";

const { dmContext, members, groups, chats } = schema;

/** Roomie DM'd this Member about this Group ("nudge"), or they DM'd Roomie about it ("dm"): a reply lands there. */
export async function noteDmContext(memberId: string, groupId: string, kind: "nudge" | "dm", at = new Date()): Promise<void> {
  await db
    .insert(dmContext)
    .values({ memberId, groupId, kind, at })
    .onConflictDoUpdate({ target: [dmContext.memberId, dmContext.kind], set: { groupId, at } });
}

/** Every Group this person is a Member of on this Channel (not removed), with their Member there. */
export async function dmCandidates(channel: ChannelName, userExternalId: string): Promise<(DmCandidate & { member: Member; chatExternalId: string })[]> {
  const rows = await db
    .select({ member: members, name: groups.name, chatExternalId: chats.externalId })
    .from(members)
    .innerJoin(groups, eq(groups.id, members.groupId))
    .innerJoin(chats, eq(chats.groupId, members.groupId))
    .where(and(eq(chats.channel, channel), eq(members.channelUserId, userExternalId), ne(members.status, "removed")))
    .orderBy(asc(members.joinedAt), asc(groups.name));
  return rows.map((r) => ({ groupId: r.member.groupId, name: r.name, memberId: r.member.id, member: r.member, chatExternalId: r.chatExternalId }));
}

/** The question Roomie asked a person in several Groups, and the message it's holding until they answer. */
type Asked = { text: string; at: number };
const ASK_TTL_MS = 15 * 60_000;
const asked = (): Map<string, Asked> => {
  const g = globalThis as { __roomieDmAsked?: Map<string, Asked> };
  return (g.__roomieDmAsked ??= new Map());
};

export type DmResolution = { kind: "group"; groupId: string; member: Member; text: string } | { kind: "say"; text: string } | { kind: "none" };

/**
 * Which Group a DM is about (ADR 0020), in order: a "for <group>:" prefix, a nudge Roomie sent within 24 h, the Group
 * they last DM'd about, their only Group; otherwise Roomie asks once ("Apt 4B or Lisbon trip?") and holds the
 * message: a reply naming a Group runs it there and is remembered for next time. A DM that says which Group it means
 * ("actually 564", "no wait, 4107, that's the group") switches there with one line (switchTo). An explicit choice
 * (the prefix, the answer, a switch) also clears the pending nudge, so the next DM stays where they said.
 */
export async function resolveDmGroup(msg: { channel: ChannelName; userExternalId: string; text: string; chatExternalId?: string }, now = new Date()): Promise<DmResolution> {
  let candidates = await dmCandidates(msg.channel, msg.userExternalId);
  // dev-chat's people ("dev:maya") are in every dev Group there ever was: its DMs stay in the Chat it's attached to.
  if (msg.channel === "dev" && msg.chatExternalId) candidates = candidates.filter((c) => c.chatExternalId === msg.chatExternalId);
  if (!candidates.length) return { kind: "none" };
  const key = `${msg.channel}:${msg.userExternalId}`;
  const found = (c: DmCandidate) => candidates.find((x) => x.groupId === c.groupId)!;
  const remember = async (c: DmCandidate, explicit: boolean) => {
    asked().delete(key);
    if (candidates.length < 2) return;
    if (explicit) await db.delete(dmContext).where(and(inArray(dmContext.memberId, candidates.map((x) => x.memberId)), eq(dmContext.kind, "nudge")));
    await noteDmContext(c.memberId, c.groupId, "dm", now);
  };
  const choose = async (c: DmCandidate, text: string, explicit = false): Promise<DmResolution> => {
    await remember(c, explicit);
    return { kind: "group", groupId: c.groupId, member: found(c).member, text };
  };

  const prefixed = groupPrefix(msg.text, candidates);
  if (prefixed) return choose(prefixed.group, prefixed.rest || msg.text, true);

  const switched = switchTo(msg.text, candidates);
  const held = asked().get(key);
  if (held && now.getTime() - held.at <= ASK_TTL_MS) {
    const named = matchGroupName(msg.text, candidates) ?? switched;
    if (named) return choose(named, held.text, true);
  }
  if (switched) {
    await remember(switched, true);
    return { kind: "say", text: switchLine(switched.name) };
  }

  const ids = candidates.map((c) => c.memberId);
  const ctxRows = await db.select().from(dmContext).where(inArray(dmContext.memberId, ids));
  const newest = (kind: "nudge" | "dm") => ctxRows.filter((r) => r.kind === kind).sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null;
  const pick = pickDmGroup({ candidates, nudge: newest("nudge"), lastDm: newest("dm"), now });
  if ("ask" in pick) {
    asked().set(key, { text: msg.text, at: now.getTime() });
    return { kind: "say", text: pick.ask };
  }
  const c = candidates.find((x) => x.groupId === pick.groupId)!;
  return choose(c, msg.text);
}

/**
 * After a private run (a DM, or Ask Roomie on the dashboard): this run's own Activity rows, through the Echo rule.
 * Shared money that moved -> one group line (deliver); a Settlement -> one private line to the other person. Returns
 * what was sent.
 */
export async function echoAfterPrivateRun(groupId: string, memberId: string, since: Date): Promise<{ echo: string | null; privately: { memberId: string; text: string }[] }> {
  const rows = await runChanges(groupId, { since, actorMemberId: memberId, sources: ["dm", "dashboard"] });
  if (!rows.length) return { echo: null, privately: [] };
  const people = await db.select({ id: members.id, name: members.displayName }).from(members).where(eq(members.groupId, groupId));
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? "Someone";
  const changes: RunChange[] = [];
  for (const r of rows) {
    const c: RunChange = { kind: r.kind, actorId: memberId, actorName: r.actorName, summary: r.summary };
    if (r.refTable === "expenses" && r.refId) {
      const [e] = await db.select({ description: schema.expenses.description, cents: schema.expenses.cents }).from(schema.expenses).where(eq(schema.expenses.id, r.refId));
      const shares = await db.select({ id: schema.expenseSplits.memberId }).from(schema.expenseSplits).where(eq(schema.expenseSplits.expenseId, r.refId));
      if (e) c.expense = { ...e, shareCount: shares.length };
    } else if (r.refTable === "settlements" && r.refId) {
      const [s] = await db.select().from(schema.settlements).where(eq(schema.settlements.id, r.refId));
      if (s) c.settlement = { fromId: s.fromId, fromName: nameOf(s.fromId), toId: s.toId, toName: nameOf(s.toId), cents: s.cents };
    }
    changes.push(c);
  }
  const plan = afterPrivateRun(changes, await currencyOf(groupId));
  if (plan.echo) {
    await deliver(groupId, { text: plan.echo });
    await logMessage(groupId, null, plan.echo);
  }
  for (const p of plan.privately) await deliverPrivate(p.memberId, { text: p.text }, { groupId }).catch((e) => console.warn(`[dm] couldn't tell ${p.memberId} privately`, e));
  return plan;
}

/** Where a private run's Activity starts (the DB's clock). */
export const runMark = dbNow;

/**
 * A nudge (or anything Roomie sends a Member first) privately; when the Channel can't DM them yet (Telegram before
 * Start), one neutral group line instead, at most once a week per Member, never with the content. Returns what
 * happened. Doesn't read the nudges preference: the nudge selectors do (nudgesOff), so a Member's own Reminders still
 * arrive.
 */
export async function nudgeOrHint(memberId: string, groupId: string, out: Outgoing, now = new Date()): Promise<"private" | "hint" | "quiet"> {
  try {
    await deliverPrivate(memberId, out, { groupId });
    return "private";
  } catch (err) {
    if (!(err instanceof CantMessagePrivatelyError)) throw err;
  }
  return (await postStartHint(memberId, groupId, now)) ? "hint" : "quiet";
}

/**
 * The no-DM-path line alone ("Dev, I've got something for you; tap @bot and press Start."), at most once a week per
 * Member: for a caller whose private send was already refused (a held DM at 08:00). Never the content. Whether it posted.
 */
export async function postStartHint(memberId: string, groupId: string, now = new Date()): Promise<boolean> {
  const note = (await getNote(memberId)) as NudgeNote;
  if (!startHintDue(note.lastStartHintAt, now)) return false;
  const [row] = await db
    .select({ name: members.displayName, channel: chats.channel })
    .from(members)
    .innerJoin(chats, eq(chats.groupId, members.groupId))
    .where(eq(members.id, memberId));
  if (!row) return false;
  const handle = (channelFor(row.channel) as { username?: string } | undefined)?.username;
  await setNoteKeys(memberId, { lastStartHintAt: now.toISOString() });
  const text = startHint(row.name.split(" ")[0], handle);
  await deliver(groupId, { text });
  await logMessage(groupId, null, text);
  return true;
}
