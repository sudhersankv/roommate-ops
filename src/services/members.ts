// Members: who is in a Group, approvals (Pending -> active), roles, payment handles and "forget me".
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import type { MemberNote, PaymentApp } from "@/db/schema";
import { record } from "./activity";
import { NotAllowedError, requireAdmin } from "./authz";
import type { Ctx, GroupCtx } from "./types";

const { members, memberNotes, chatMessages, claimTokens } = schema;

export type Member = typeof members.$inferSelect;
export type MemberWithHandles = Member & { handles: Partial<Record<PaymentApp, string>> };

export const FORMER_MEMBER = "Former member";
export const PAYMENT_APPS: PaymentApp[] = ["venmo", "paypal", "cashapp"];

/** Active Members: the people in splits, chores and balances. */
export async function listMembers(ctx: GroupCtx): Promise<Member[]> {
  return db
    .select()
    .from(members)
    .where(and(eq(members.groupId, ctx.groupId), eq(members.status, "active")))
    .orderBy(asc(members.joinedAt), asc(members.displayName));
}

/** Active and Pending Members (everyone in the Chat Roomie knows about). */
export async function listGroupMembers(ctx: GroupCtx): Promise<Member[]> {
  return db
    .select()
    .from(members)
    .where(and(eq(members.groupId, ctx.groupId), ne(members.status, "removed")))
    .orderBy(asc(members.joinedAt), asc(members.displayName));
}

/** Active + Pending with their payment handles from Member notes. */
export async function listMembersWithHandles(ctx: GroupCtx): Promise<MemberWithHandles[]> {
  const people = await listGroupMembers(ctx);
  if (people.length === 0) return [];
  const notes = await db.select().from(memberNotes).where(inArray(memberNotes.memberId, people.map((p) => p.id)));
  const byId = new Map(notes.map((n) => [n.memberId, n.note]));
  return people.map((p) => ({ ...p, handles: byId.get(p.id)?.handles ?? {} }));
}

export async function getMember(ctx: GroupCtx, memberId: string): Promise<Member | undefined> {
  const [m] = await db.select().from(members).where(and(eq(members.groupId, ctx.groupId), eq(members.id, memberId)));
  return m;
}

export async function memberByChannelUser(groupId: string, channelUserId: string): Promise<Member | undefined> {
  const [m] = await db.select().from(members).where(and(eq(members.groupId, groupId), eq(members.channelUserId, channelUserId)));
  return m;
}

/** A new person in the Chat. Pending until an Admin approves, unless `status` says otherwise (Onboarding). */
export async function addMember(
  groupId: string,
  input: { displayName: string; channelUserId?: string | null; role?: Member["role"]; status?: Member["status"] },
): Promise<Member> {
  const [m] = await db
    .insert(members)
    .values({
      groupId,
      displayName: input.displayName.trim() || "Someone",
      channelUserId: input.channelUserId ?? null,
      role: input.role ?? "member",
      status: input.status ?? "pending",
    })
    .returning();
  return m;
}

async function target(ctx: Ctx, memberId: string): Promise<Member> {
  const m = await getMember(ctx, memberId);
  if (!m || m.status === "removed") throw new Error("That person isn't in this group.");
  return m;
}

/** Admin: Pending -> active. */
export async function approveMember(ctx: Ctx, input: { memberId: string }): Promise<Member> {
  await requireAdmin(ctx);
  const m = await target(ctx, input.memberId);
  if (m.status === "active") throw new Error(`${m.displayName} is already approved.`);
  const [updated] = await db
    .update(members)
    .set({ status: "active", approvedBy: ctx.memberId, approvedAt: new Date() })
    .where(eq(members.id, m.id))
    .returning();
  await record(ctx.groupId, ctx.memberId, "member.approved", `approved ${m.displayName}`, { table: "members", id: m.id });
  return updated;
}

/** Admin: a Pending member is turned away. They stay in the Chat; Roomie won't act for them. */
export async function declineMember(ctx: Ctx, input: { memberId: string }): Promise<Member> {
  await requireAdmin(ctx);
  const m = await target(ctx, input.memberId);
  if (m.status !== "pending") throw new Error(`${m.displayName} isn't waiting for approval.`);
  const [updated] = await db.update(members).set({ status: "removed" }).where(eq(members.id, m.id)).returning();
  await record(ctx.groupId, ctx.memberId, "member.declined", `declined ${m.displayName}`, { table: "members", id: m.id });
  return updated;
}

/** Admin: make an active Member an Admin too. */
export async function promoteMember(ctx: Ctx, input: { memberId: string }): Promise<Member> {
  await requireAdmin(ctx);
  const m = await target(ctx, input.memberId);
  if (m.status !== "active") throw new NotAllowedError(`Approve ${m.displayName} before making them an admin.`, "pending");
  if (m.role === "admin") throw new Error(`${m.displayName} is already an admin.`);
  const [updated] = await db.update(members).set({ role: "admin" }).where(eq(members.id, m.id)).returning();
  await record(ctx.groupId, ctx.memberId, "member.promoted", `made ${m.displayName} an admin`, { table: "members", id: m.id });
  return updated;
}

export async function admins(ctx: GroupCtx): Promise<Member[]> {
  return (await listMembers(ctx)).filter((m) => m.role === "admin");
}

/* ---------- Member notes ---------- */

export async function getNote(memberId: string): Promise<MemberNote> {
  const [row] = await db.select().from(memberNotes).where(eq(memberNotes.memberId, memberId));
  return row?.note ?? {};
}

/** Your own payment handles (any status: it's your data). Empty strings clear a handle. */
export async function setPaymentHandles(ctx: Ctx, input: Partial<Record<PaymentApp, string>>): Promise<MemberNote> {
  const me = await getMember(ctx, ctx.memberId);
  if (!me || me.status === "removed") throw new NotAllowedError("You're not in this group anymore.", "removed");
  const note = await getNote(ctx.memberId);
  const handles = { ...(note.handles ?? {}) };
  for (const app of PAYMENT_APPS) {
    if (!(app in input)) continue;
    const v = input[app]?.trim();
    if (v) handles[app] = v.slice(0, 80);
    else delete handles[app];
  }
  const next: MemberNote = { ...note, handles };
  await db
    .insert(memberNotes)
    .values({ memberId: ctx.memberId, note: next })
    .onConflictDoUpdate({ target: memberNotes.memberId, set: { note: next, updatedAt: new Date() } });
  return next;
}

/* ---------- forget me (ADR 0006) ---------- */

/**
 * "roomie forget me": deletes the Member's raw chat lines, their Member note (table + working memory) and their
 * messages in Roomie's memory thread. Ledger rows (Expenses, Shares, Settlements, chores) stay so the Group's
 * Balances still add up; a removed Member's name becomes "Former member".
 */
export async function forgetMe(ctx: Ctx): Promise<{ chatLines: number; memoryMessages: number }> {
  const me = await getMember(ctx, ctx.memberId);
  if (!me) throw new NotAllowedError("You're not a member of this group.", "not-member");
  const gone = await db.delete(chatMessages).where(and(eq(chatMessages.groupId, ctx.groupId), eq(chatMessages.memberId, me.id))).returning({ id: chatMessages.id });
  await db.delete(memberNotes).where(eq(memberNotes.memberId, me.id));
  await db.delete(claimTokens).where(eq(claimTokens.memberId, me.id));
  const { forgetMemberInMemory } = await import("@/mastra/forget");
  const memoryMessages = await forgetMemberInMemory(ctx.groupId, me.displayName).catch((e) => {
    console.warn("[forget-me] memory cleanup failed", e);
    return 0;
  });
  if (me.status === "removed") await db.update(members).set({ displayName: FORMER_MEMBER, channelUserId: null }).where(eq(members.id, me.id));
  await record(ctx.groupId, null, "member.forgotten", `forgot ${me.status === "removed" ? FORMER_MEMBER : me.displayName}'s chat history`, { table: "members", id: me.id });
  return { chatLines: gone.length, memoryMessages };
}
