// P0 · implemented, because the chat path needs identity from minute one.
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Ctx } from "./types";

const { households, members } = schema;

export type Member = typeof members.$inferSelect;
export type Household = typeof households.$inferSelect;

/** Chat -> household. The first message from a new chat creates the house. */
export async function householdForChat(chatId: string, title = "Our place"): Promise<Household> {
  const [found] = await db.select().from(households).where(eq(households.chatId, chatId));
  if (found) return found;
  const [created] = await db.insert(households).values({ name: title, chatId }).returning();
  return created;
}

/** Channel user -> member. Unknown senders are auto-created; the dashboard renames/removes them. */
export async function linkChannelUser(householdId: string, channelUserId: string, name: string): Promise<Member> {
  const [found] = await db
    .select()
    .from(members)
    .where(and(eq(members.householdId, householdId), eq(members.channelUserId, channelUserId)));
  if (found) return found;
  // A seeded/dashboard member with the same name and no channel link yet: claim it.
  const unlinked = (await listMembers({ householdId })).find(
    (m) => !m.channelUserId && m.name.toLowerCase() === name.toLowerCase(),
  );
  if (unlinked) {
    await db.update(members).set({ channelUserId }).where(eq(members.id, unlinked.id));
    return { ...unlinked, channelUserId };
  }
  const [created] = await db.insert(members).values({ householdId, name, channelUserId }).returning();
  return created;
}

export async function listMembers(ctx: Pick<Ctx, "householdId">): Promise<Member[]> {
  return db
    .select()
    .from(members)
    .where(and(eq(members.householdId, ctx.householdId), eq(members.active, true)));
}

export async function addMember(ctx: Ctx, input: { name: string; channelUserId?: string }): Promise<Member> {
  const [m] = await db.insert(members).values({ householdId: ctx.householdId, ...input }).returning();
  return m;
}

export async function renameMember(ctx: Ctx, input: { memberId: string; name: string }): Promise<void> {
  await db
    .update(members)
    .set({ name: input.name })
    .where(and(eq(members.id, input.memberId), eq(members.householdId, ctx.householdId)));
}

export async function removeMember(ctx: Ctx, input: { memberId: string }): Promise<void> {
  await db
    .update(members)
    .set({ active: false })
    .where(and(eq(members.id, input.memberId), eq(members.householdId, ctx.householdId)));
}

export async function getHousehold(householdId: string): Promise<Household | undefined> {
  const [h] = await db.select().from(households).where(eq(households.id, householdId));
  return h;
}

export async function updateHouseSettings(ctx: Ctx, input: Partial<Pick<Household, "name">>): Promise<void> {
  await db.update(households).set(input).where(eq(households.id, ctx.householdId));
}
