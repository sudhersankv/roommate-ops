// Onboarding: what happens when Roomie is added to a Chat, and when someone joins one later.
// Called by Channel adapters (WhatsApp in step 2; scripts/dev-chat.ts today). The adapter owns the anti-ban timing
// (ADR 0001: wait 1-3 minutes after joining before the first message); these functions only decide what to say.
//
// Who is what (docs/adr/0008):
//   - whoever added Roomie: Admin, active
//   - everyone already in the Chat when Roomie joins: active (they were in the group before Roomie)
//   - anyone who joins later, or speaks without Roomie having seen them join: Pending until an Admin approves
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ChannelName } from "@/db/schema";
import type { ChannelUser, Outgoing } from "@/channels/types";
import { record } from "@/services/activity";
import { logMessage } from "@/services/chatlog";
import { chatFor, initToolkits, type Group } from "@/services/groups";
import { addMember, admins, memberByChannelUser, type Member } from "@/services/members";

export type ChatRef = { channel: ChannelName; externalId: string; title?: string };

const joinNames = (n: string[]) => (n.length <= 1 ? n.join("") : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`);

/* ---------- pure copy (onboarding.test.ts) ---------- */

/** Roomie's first message: who it is, who the Admin is, and the setup questions in one go. */
export function introMessage(adderName: string): string {
  return [
    `Hey all, I'm Roomie 👋 ${adderName} added me, so ${adderName}'s my admin. I split costs, keep a shared Cart and track chores.`,
    `Quick setup, one reply is plenty: what's this group for (roommates, a trip, friends, family, work), which currency, and which time zone? Just "roommates" works too: I'll go with USD, Chicago time and switch everything on.`,
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
export async function onGroupJoined(chat: ChatRef, participants: ChannelUser[], addedBy: ChannelUser): Promise<JoinResult> {
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

  const intro = { text: introMessage(admin.displayName) };
  await logMessage(group.id, null, intro.text); // opens the follow-up window for the answers
  return { group: withCreator, members: [admin, ...others], intro, created: true };
}

export type ParticipantResult = { member: Member; announce: Outgoing | null; created: boolean };

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
