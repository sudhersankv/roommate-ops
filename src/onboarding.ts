// Onboarding: what happens when Roomie is added to a Chat, and when someone joins one later.
// Called by Channel adapters (channels/telegram.ts, scripts/dev-chat.ts). The adapter owns the anti-spam timing
// (ADR 0001: wait a while after joining before the first message); these functions only decide what to say.
//
// Who is what (docs/adr/0008, 0010):
//   - whoever added Roomie: Admin, active
//   - everyone already in the Chat when Roomie joins: active (they were in the group before Roomie). Telegram can't
//     list them, so there a first-time sender within 24 hours of Roomie joining counts as already there
//   - anyone who joins later, or speaks without Roomie having seen them join: Pending until an Admin approves
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ChannelName } from "@/db/schema";
import { ROSTER_GRACE_MS, type ChannelUser, type Outgoing } from "@/channels/types";
import { record } from "@/services/activity";
import { logMessage } from "@/services/chatlog";
import { chatFor, initToolkits, type Chat, type Group } from "@/services/groups";
import { addMember, admins, memberByChannelUser, type Member } from "@/services/members";
import { ARCHETYPE_IDS, DEFAULT_ARCHETYPE, DEFAULT_PET_NAME } from "@/lib/personality";
import { manifestOf } from "@/toolkits/manifests";
import { presetFor } from "@/toolkits/presets";

export type ChatRef = { channel: ChannelName; externalId: string; title?: string };

const joinNames = (n: string[]) => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

/* ---------- pure copy (onboarding.test.ts) ---------- */

/** A name the adapter made up because it hasn't heard a real one yet (WhatsApp: "+15551234567" or "Someone"). */
export const isPlaceholderName = (name: string) => /^\+?\d[\d\s-]{5,}$/.test(name.trim()) || name.trim() === "Someone";

/**
 * Roomie's first message: who it is, who the Admin is, and the setup questions in one go. `dmHandle` (Telegram's
 * @username) adds the one nudge to open a 1:1 chat, since a bot can't message anyone first.
 */
export function introMessage(adderName: string, opts: { dmHandle?: string; petName?: string } = {}): string {
  const name = opts.petName?.trim() || DEFAULT_PET_NAME;
  const admin = isPlaceholderName(adderName) ? "Whoever added me is my admin." : `${adderName} added me, so ${adderName}'s my admin.`;
  return [
    `Hey all, I'm ${name}, your group's new pet 🦖 ${admin} I split costs, keep a shared Cart, track chores, set reminders, and slowly pick up how you all talk.`,
    `Quick setup, one reply is plenty: what's this group for (roommates, a trip, friends, family, work), which currency, which time zone (a city is fine), and what vibe should I have (${ARCHETYPE_IDS.join(" / ")})? Just "roommates" works too: I'll go with USD, Chicago time, ${DEFAULT_ARCHETYPE}, and switch on ${joinNames(presetFor("roommates").map((id) => manifestOf(id)!.name))} ("also ..." or "no ..." changes that).`,
    ...(opts.dmHandle ? [`One more thing: tap @${opts.dmHandle} and press Start, so I can DM you your dashboard link later.`] : []),
  ].join("\n");
}

/** Asked in the Chat when someone new shows up. */
export function approvalPrompt(newName: string, adminNames: string[]): string {
  const who = adminNames.length ? joinNames(adminNames) : "Admins";
  return `Welcome, ${newName} 👋 ${who}: approve ${newName}? Say "roomie approve ${newName}". Until then I'll chat, but I won't log anything for them.`;
}

/* ---------- flows ---------- */

export type JoinResult = { group: Group; members: Member[]; intro: Outgoing | null; created: boolean };

/**
 * Roomie was added to a Chat by `addedBy`, with `participants` already in it. Creates the Group, its Chat and
 * Members, switches every Toolkit on until the Group says what it's for, and returns the intro to post. Calling it
 * again for a known Chat changes nothing and returns `intro: null`.
 */
export async function onGroupJoined(
  chat: ChatRef,
  participants: ChannelUser[],
  addedBy: ChannelUser,
  opts: { dmHandle?: string } = {},
): Promise<JoinResult> {
  const known = await chatFor(chat.channel, chat.externalId);
  if (known) {
    const rows = await db.select().from(schema.members).where(eq(schema.members.groupId, known.group.id));
    return { group: known.group, members: rows, intro: null, created: false };
  }

  const [group] = await db
    .insert(schema.groups)
    .values({ name: chat.title?.trim() || `${addedBy.name}'s group` })
    .returning();
  await db.insert(schema.chats).values({ groupId: group.id, channel: chat.channel, externalId: chat.externalId, title: chat.title ?? null });

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

  const intro = { text: introMessage(admin.displayName, opts) };
  await logMessage(group.id, null, intro.text); // opens the follow-up window for the answers
  return { group: withCreator, members: [admin, ...others], intro, created: true };
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
