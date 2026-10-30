// Onboarding: what happens when Roomie is added to a Chat, and when someone joins one later.
// Called by Channel adapters (channels/telegram.ts, scripts/dev-chat.ts). The adapter owns the anti-spam timing
// (ADR 0001: wait a while after joining before the first message); these functions only decide what to say.
//
// Who is what (docs/adr/0008, 0010):
//   - whoever added Roomie: Admin, active
//   - everyone already in the Chat when Roomie joins: active (they were in the group before Roomie). Telegram can't
//     list them, so there a first-time sender within 24 hours of Roomie joining counts as already there
//   - anyone who joins later, or speaks without Roomie having seen them join: Pending until an Admin approves
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ChannelName } from "@/db/schema";
import { channelFor } from "@/channels";
import { ROSTER_GRACE_MS, type ChannelUser, type Outgoing } from "@/channels/types";
import { caps, TOO_MANY_GROUPS } from "@/lib/caps";
import { record } from "@/services/activity";
import { logMessage } from "@/services/chatlog";
import { issueDashboardLink } from "@/services/claims";
import { newJoinCode } from "@/services/joins";
import { chatFor, initToolkits, type Chat, type Group } from "@/services/groups";
import { addMember, admins, memberByChannelUser, type Member } from "@/services/members";
import { MANIFESTS } from "@/toolkits/manifests";

export type ChatRef = { channel: ChannelName; externalId: string; title?: string };

/** What a Group that never said its purpose gets (presetFor(null): every defaultOn Trick, the roommates set). */
const DEFAULT_PURPOSE = "roommates";

const joinNames = (n: string[]) => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

/* ---------- pure copy (onboarding.test.ts) ---------- */

/** A name the adapter made up because it hasn't heard a real one yet (WhatsApp: "+15551234567" or "Someone"). */
export const isPlaceholderName = (name: string) => /^\+?\d[\d\s-]{5,}$/.test(name.trim()) || name.trim() === "Someone";

/**
 * Roomie's first message, at most three lines and no list of what it does: who it is, what to tell it (the group's
 * purpose picks the Tricks it learns), and who the Admin is. `dmHandle` (Telegram's @username) adds the one nudge to
 * open a 1:1 chat, since on Telegram Roomie can't message anyone first. One voice, one name (ADR 0020): no vibe offer.
 */
export function introMessage(adderName: string, opts: { dmHandle?: string } = {}): string {
  const admin = isPlaceholderName(adderName) ? "Whoever added me is my admin." : `${adderName} added me, so ${adderName}'s my admin.`;
  return [
    `Hey all, I'm Roomie 🦖 the roommate who actually keeps track: rent, splits, groceries, chores, the landlord.`,
    `Tell me what this group is for (roommates, a trip, friends, family, work…) and I'll learn the right Tricks. Currency and city are welcome too.`,
    `${admin}${opts.dmHandle ? ` Tap @${opts.dmHandle} and press Start, so I can DM you the setup and your dashboard link.` : ""}`,
  ].join("\n");
}

/**
 * The Admin's setup DM (ADR 0014), sent when Roomie joins (WhatsApp) or when they press Start (Telegram): their own
 * dashboard link rides along as a button (a Claim link: private, ADR 0003), and the setup question can be answered
 * right there.
 */
export function setupDmText(adminName: string, groupName: string): string {
  const first = isPlaceholderName(adminName) ? "" : ` ${adminName.trim().split(/\s+/)[0]}`;
  return [
    `Hi${first} 👋 You added me to ${groupName}, so you're its admin. Your own dashboard link is below (just for you, it works once).`,
    `Answer the setup here or in the group: what's the group for, currency, city.`,
  ].join("\n");
}

/** The setup DM for an Admin of a Group that hasn't finished setup: the text and their Claim link as a button. */
export async function setupDm(group: Pick<Group, "id" | "name">, admin: Pick<Member, "id" | "displayName">): Promise<Outgoing> {
  const link = await issueDashboardLink({ groupId: group.id, memberId: admin.id, source: "chat" });
  return { text: setupDmText(admin.displayName, group.name), buttons: [{ text: "Open dashboard", url: link.url }] };
}

/**
 * Telegram's /start (a bot can't message first): if this person is the Admin of a Group still waiting for its setup
 * (the newest one), the setup DM; otherwise null and /start says its usual line.
 */
export async function setupDmFor(channel: ChannelName, userExternalId: string): Promise<Outgoing | null> {
  const [row] = await db
    .select({ group: schema.groups, member: schema.members })
    .from(schema.members)
    .innerJoin(schema.chats, eq(schema.chats.groupId, schema.members.groupId))
    .innerJoin(schema.groups, eq(schema.groups.id, schema.members.groupId))
    .where(
      and(
        eq(schema.chats.channel, channel),
        eq(schema.members.channelUserId, userExternalId),
        eq(schema.members.role, "admin"),
        eq(schema.members.status, "active"),
        isNull(schema.groups.onboardedAt),
        isNull(schema.groups.pausedAt),
      ),
    )
    .orderBy(desc(schema.groups.createdAt))
    .limit(1);
  return row ? setupDm(row.group, row.member) : null;
}

/**
 * The one line after the setup answer: the Tricks Roomie learned, and what to say next. `defaulted`: nobody said
 * what the group is for, so it kept the roommates set, and says so.
 */
export function learnedLine(on: readonly string[], opts: { defaulted?: boolean } = {}): string {
  const names = MANIFESTS.filter((m) => on.includes(m.id)).map((m) => m.name);
  const learned = names.length ? `${opts.defaulted ? "learned" : "Learned"} ${joinNames(names)}.` : `${opts.defaulted ? "no" : "No"} Tricks yet.`;
  const lead = opts.defaulted ? `You didn't say what this group is for, so I kept the ${DEFAULT_PURPOSE} set: ` : "";
  const next = MANIFESTS.find((m) => !on.includes(m.id));
  const tip = next ? `Say "roomie, learn ${next.name.toLowerCase()}" any time.` : `Say "roomie, what can you do?" any time.`;
  return `${lead}${learned} ${tip}`;
}

/** Asked in the Chat when someone new shows up. */
export function approvalPrompt(newName: string, adminNames: string[]): string {
  const who = adminNames.length ? joinNames(adminNames) : "Admins";
  return `Welcome, ${newName} 👋 ${who}: approve ${newName}? Say "roomie approve ${newName}". Until then I'll chat, but I won't log anything for them.`;
}

/* ---------- flows ---------- */

/** `setupDm`: the private message for the Admin (members[0]); the adapter sends it at once (WhatsApp) or tries and
 * leaves it for /start when the Channel can't DM them yet (Telegram). */
export type JoinResult = { group: Group; members: Member[]; intro: Outgoing | null; setupDm: Outgoing | null; created: boolean };

/** Roomie said no to a new Chat (too many new Groups from this person today) and left it. Nothing was created. */
export class JoinRefusedError extends Error {
  name = "JoinRefusedError";
}

/** Say one line in the Chat, then leave it (through the registered Channel; logged when there's none). */
export async function sayAndLeave(chat: Pick<ChatRef, "channel" | "externalId">, text: string): Promise<void> {
  const channel = channelFor(chat.channel);
  if (!channel) {
    console.log(`[onboarding] no ${chat.channel} channel connected; would say "${text}" and leave ${chat.externalId}`);
    return;
  }
  await channel.sendToChat(chat.externalId, { text }).catch((e) => console.warn(`[onboarding] couldn't say goodbye in ${chat.externalId}`, e));
  await channel.leaveChat(chat.externalId).catch((e) => console.warn(`[onboarding] couldn't leave ${chat.externalId}`, e));
}

/**
 * Roomie was added to a Chat by `addedBy`, with `participants` already in it. Creates the Group, its Chat and
 * Members, switches every Toolkit on until the Group says what it's for, and returns the intro to post. Calling it
 * again for a known Chat changes nothing and returns `intro: null`. A person who already added Roomie to 3 new Groups
 * today (lib/caps.ts) gets one line, Roomie leaves, and this throws JoinRefusedError. The dev Channel isn't capped.
 */
export async function onGroupJoined(
  chat: ChatRef,
  participants: ChannelUser[],
  addedBy: ChannelUser,
  opts: { dmHandle?: string; participantCount?: number | null; newGroupAllowed?: (channel: string, userExternalId: string) => Promise<boolean> } = {},
): Promise<JoinResult> {
  const known = await chatFor(chat.channel, chat.externalId);
  if (known) {
    const rows = await db.select().from(schema.members).where(eq(schema.members.groupId, known.group.id));
    return { group: known.group, members: rows, intro: null, setupDm: null, created: false };
  }
  if (chat.channel !== "dev") {
    const allowed = opts.newGroupAllowed ?? (async (ch: string, id: string) => (await caps()).newGroup(ch, id));
    if (!(await allowed(chat.channel, addedBy.userExternalId))) {
      console.log(`[caps] ${chat.channel} user ${addedBy.userExternalId} added Roomie to too many new groups today; leaving ${chat.externalId}`);
      await sayAndLeave(chat, TOO_MANY_GROUPS);
      throw new JoinRefusedError(TOO_MANY_GROUPS);
    }
  }

  const [group] = await db
    .insert(schema.groups)
    .values({ name: chat.title?.trim() || `${addedBy.name}'s group`, joinCode: newJoinCode() })
    .returning();
  const count = opts.participantCount;
  await db.insert(schema.chats).values({
    groupId: group.id,
    channel: chat.channel,
    externalId: chat.externalId,
    title: chat.title ?? null,
    ...(typeof count === "number" && count >= 0 ? { participantCount: count, participantCountAt: new Date() } : {}),
  });

  const admin = await addMember(group.id, { displayName: addedBy.name, channelUserId: addedBy.userExternalId, role: "admin", status: "active" });
  const others: Member[] = [];
  const seen = new Set([addedBy.userExternalId]);
  for (const p of participants) {
    if (seen.has(p.userExternalId)) continue;
    seen.add(p.userExternalId);
    others.push(await addMember(group.id, { displayName: p.name, channelUserId: p.userExternalId, status: "active" }));
  }
  const [withCreator] = await db.update(schema.groups).set({ createdBy: admin.id }).where(eq(schema.groups.id, group.id)).returning();
  await initToolkits(group.id);
  await record(group.id, null, "group.created", `joined the chat. ${admin.displayName} is the first admin`, { table: "groups", id: group.id });

  const intro = { text: introMessage(admin.displayName, { dmHandle: opts.dmHandle }) };
  await logMessage(group.id, null, intro.text); // opens the follow-up window for the answers
  const dm = await setupDm(withCreator, admin).catch((e) => {
    console.warn(`[onboarding] couldn't make the setup DM for ${group.id}`, e);
    return null;
  });
  return { group: withCreator, members: [admin, ...others], intro, setupDm: dm, created: true };
}

export type ParticipantResult = { member: Member; announce: Outgoing | null; created: boolean };

/** Whether a first-time sender in this Chat counts as already in it when Roomie joined (ADR 0010). Pure. */
export function rosterStillOpen(chat: Pick<Chat, "channel" | "createdAt">, now = new Date()): boolean {
  const grace = ROSTER_GRACE_MS[chat.channel];
  return grace !== undefined && now.getTime() - chat.createdAt.getTime() < grace;
}

/**
 * Someone Roomie has no Member for spoke in a known Chat. Normally a later joiner (Pending + "approve X?"), but on a
 * Channel that can't list members, in the first hours after Roomie joined, they were almost certainly already there:
 * an active Member, no approval asked.
 */
export async function onUnknownSender(chat: Chat, user: ChannelUser, now = new Date()): Promise<ParticipantResult> {
  const existing = await memberByChannelUser(chat.groupId, user.userExternalId);
  if (!existing && rosterStillOpen(chat, now)) {
    const member = await addMember(chat.groupId, { displayName: user.name, channelUserId: user.userExternalId, status: "active" });
    await record(chat.groupId, null, "member.added", `added ${member.displayName}, already in the chat when Roomie joined`, { table: "members", id: member.id });
    return { member, announce: null, created: true };
  }
  return onParticipantJoined(chat.groupId, user);
}

/**
 * Someone joined a known Chat (or spoke without Roomie having seen them join): they're a Pending member and Roomie
 * asks the Admins to approve them. A known person gets nothing new; someone declined earlier is Pending again.
 */
export async function onParticipantJoined(groupId: string, user: ChannelUser): Promise<ParticipantResult> {
  const existing = await memberByChannelUser(groupId, user.userExternalId);
  if (existing && existing.status !== "removed") return { member: existing, announce: null, created: false };

  let member: Member;
  if (existing) {
    [member] = await db
      .update(schema.members)
      .set({ status: "pending", role: "member", joinedAt: new Date(), displayName: user.name })
      .where(and(eq(schema.members.id, existing.id)))
      .returning();
  } else {
    member = await addMember(groupId, { displayName: user.name, channelUserId: user.userExternalId, status: "pending" });
  }
  await record(groupId, null, "member.pending", `added ${member.displayName} as a pending member`, { table: "members", id: member.id });
  const announce = { text: approvalPrompt(member.displayName, (await admins({ groupId })).map((a) => a.displayName)) };
  await logMessage(groupId, null, announce.text);
  return { member, announce, created: true };
}
