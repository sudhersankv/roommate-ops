// Groups: settings, Toolkits, the Account's group list, and "delete group data".
// defaultToolkitsFor / validateSettings are pure (groups.test.ts).
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { GROUP_PURPOSES, type ChannelName, type GroupPurpose } from "@/db/schema";
import { resolveTimeZone } from "@/lib/time";
import { TOOLKIT_IDS, type ToolkitId } from "@/toolkits/types";
import { record } from "./activity";
import { requireAdmin } from "./authz";
import { addStarterChores } from "./chores";
import { addDefaults } from "./upkeep";
import type { Ctx, GroupCtx } from "./types";

const { groups, chats, groupToolkits, members } = schema;

export type Group = typeof groups.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Chattiness = Group["chattiness"];

/* ---------- pure ---------- */

/** What a Group gets switched on when it tells Roomie what it's for. Core is always on. */
export function defaultToolkitsFor(purpose: GroupPurpose | null | undefined): ToolkitId[] {
  switch (purpose) {
    case "trip":
      return ["splitting", "groceries"];
    case "friends":
    case "work":
      return ["splitting"];
    case "family":
      return ["splitting", "groceries", "chores", "upkeep"];
    case "other":
      return ["splitting", "groceries"];
    case "roommates":
    default:
      return [...TOOLKIT_IDS];
  }
}

export type SettingsPatch = Partial<Pick<Group, "name" | "purpose" | "currency" | "timezone" | "chattiness" | "simplifyDebts">>;

/** Normalizes a settings patch or throws a message Roomie can repeat ("EUR", "Europe/Berlin"). */
export function validateSettings(patch: SettingsPatch): SettingsPatch {
  const out: SettingsPatch = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, " ");
    if (!name) throw new Error("The group needs a name.");
    out.name = name.slice(0, 60);
  }
  if (patch.purpose !== undefined && patch.purpose !== null) {
    if (!GROUP_PURPOSES.includes(patch.purpose)) throw new Error(`Purpose must be one of: ${GROUP_PURPOSES.join(", ")}.`);
    out.purpose = patch.purpose;
  }
  if (patch.currency !== undefined) {
    const c = patch.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(c) || !Intl.supportedValuesOf("currency").includes(c)) throw new Error(`"${patch.currency}" isn't a currency code like USD or EUR.`);
    out.currency = c;
  }
  if (patch.timezone !== undefined) {
    const tz = resolveTimeZone(patch.timezone);
    if (!tz) throw new Error(`I don't know the time zone "${patch.timezone}". Which city are you in?`);
    out.timezone = tz;
  }
  if (patch.chattiness !== undefined) {
    if (!["quiet", "normal", "chatty"].includes(patch.chattiness)) throw new Error("Chattiness is quiet, normal or chatty.");
    out.chattiness = patch.chattiness;
  }
  if (patch.simplifyDebts !== undefined) out.simplifyDebts = !!patch.simplifyDebts;
  return out;
}

/* ---------- reads ---------- */

export async function getGroup(groupId: string): Promise<Group | undefined> {
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
  return g;
}

export async function chatFor(channel: ChannelName, externalId: string): Promise<{ group: Group; chat: Chat } | undefined> {
  const [row] = await db
    .select({ group: groups, chat: chats })
    .from(chats)
    .innerJoin(groups, eq(chats.groupId, groups.id))
    .where(and(eq(chats.channel, channel), eq(chats.externalId, externalId)));
  return row;
}

export async function chatOfGroup(groupId: string): Promise<Chat | undefined> {
  const [c] = await db.select().from(chats).where(eq(chats.groupId, groupId));
  return c;
}

/** Groups with a Chat (the only ones Roomie can post to unprompted), with their enabled Toolkits. */
export async function groupsWithChat(onlyGroupId?: string): Promise<(Pick<Group, "id" | "name" | "timezone" | "styleNoteAt"> & { toolkits: ToolkitId[] })[]> {
  const rows = await db
    .select({ id: groups.id, name: groups.name, timezone: groups.timezone, styleNoteAt: groups.styleNoteAt })
    .from(groups)
    .innerJoin(chats, eq(chats.groupId, groups.id))
    .where(onlyGroupId ? eq(groups.id, onlyGroupId) : undefined);
  if (!rows.length) return [];
  const flags = await db.select().from(groupToolkits).where(inArray(groupToolkits.groupId, rows.map((r) => r.id)));
  return rows.map((r) => {
    const off = new Set(flags.filter((f) => f.groupId === r.id && !f.enabled).map((f) => f.toolkit));
    return { ...r, toolkits: TOOLKIT_IDS.filter((t) => !off.has(t)) };
  });
}

/** Every Toolkit with its on/off state. A Toolkit with no row is on (Groups made before Onboarding chose). */
export async function listToolkits(ctx: GroupCtx): Promise<{ id: ToolkitId; enabled: boolean }[]> {
  const rows = await db.select().from(groupToolkits).where(eq(groupToolkits.groupId, ctx.groupId));
  const byId = new Map(rows.map((r) => [r.toolkit, r.enabled]));
  return TOOLKIT_IDS.map((id) => ({ id, enabled: byId.get(id) ?? true }));
}

export async function enabledToolkits(ctx: GroupCtx): Promise<ToolkitId[]> {
  return (await listToolkits(ctx)).filter((t) => t.enabled).map((t) => t.id);
}

/** The Groups an Account is a Member of (not removed), oldest first. */
export async function groupsForAccount(accountId: string): Promise<{ id: string; name: string; memberId: string; status: string }[]> {
  return db
    .select({ id: groups.id, name: groups.name, memberId: members.id, status: members.status })
    .from(members)
    .innerJoin(groups, eq(members.groupId, groups.id))
    .where(and(eq(members.accountId, accountId), ne(members.status, "removed")))
    .orderBy(asc(groups.createdAt));
}

/** The Chats on a Channel where this person is a Member (not removed): where a 1:1 message from them belongs. */
export async function chatsOfChannelUser(channel: ChannelName, channelUserId: string): Promise<Chat[]> {
  return db
    .select({ chat: chats })
    .from(members)
    .innerJoin(chats, eq(chats.groupId, members.groupId))
    .where(and(eq(chats.channel, channel), eq(members.channelUserId, channelUserId), ne(members.status, "removed")))
    .orderBy(asc(chats.createdAt))
    .then((rows) => rows.map((r) => r.chat));
}

/* ---------- writes ---------- */

/** The Chat got a new id on its Channel (a Telegram group upgraded to a supergroup). */
export async function moveChat(channel: ChannelName, fromExternalId: string, toExternalId: string): Promise<void> {
  await db.update(chats).set({ externalId: toExternalId }).where(and(eq(chats.channel, channel), eq(chats.externalId, fromExternalId)));
}

async function writeToolkits(groupId: string, on: readonly ToolkitId[]) {
  await db
    .insert(groupToolkits)
    .values(TOOLKIT_IDS.map((toolkit) => ({ groupId, toolkit, enabled: on.includes(toolkit) })))
    .onConflictDoUpdate({ target: [groupToolkits.groupId, groupToolkits.toolkit], set: { enabled: sql`excluded.enabled` } });
}

/** Seed Toolkit rows for a new Group (Onboarding, seed, tests). */
export async function initToolkits(groupId: string, on: readonly ToolkitId[] = TOOLKIT_IDS) {
  await writeToolkits(groupId, on);
}

/**
 * Admin: change Group settings. The first time a purpose arrives during Onboarding, the Group gets that purpose's
 * default Toolkits (unless `toolkits` says otherwise) and Onboarding is marked done.
 */
export async function updateGroupSettings(
  ctx: Ctx,
  patch: SettingsPatch & { toolkits?: ToolkitId[] },
): Promise<{ group: Group; toolkits: ToolkitId[]; starters?: { chores: number; upkeep: number } }> {
  await requireAdmin(ctx);
  const clean = validateSettings(patch);
  const before = await getGroup(ctx.groupId);
  if (!before) throw new Error("This group doesn't exist anymore.");
  const onboarding = !before.onboardedAt;
  const [group] = await db
    .update(groups)
    .set({ ...clean, ...(onboarding ? { onboardedAt: new Date() } : {}) })
    .where(eq(groups.id, ctx.groupId))
    .returning();
  if (patch.toolkits) await writeToolkits(ctx.groupId, patch.toolkits);
  else if (onboarding && clean.purpose) await writeToolkits(ctx.groupId, defaultToolkitsFor(clean.purpose));
  const changed = Object.keys(clean);
  if (changed.length) await record(ctx.groupId, ctx.memberId, "group.settings", `changed ${changed.join(", ")}`, { table: "groups", id: ctx.groupId });
  const toolkits = await enabledToolkits(ctx);
  const starters = onboarding && isHousehold(clean.purpose) ? await startHousehold(ctx, toolkits) : undefined;
  return { group, toolkits, ...(starters ? { starters } : {}) };
}

export const isHousehold = (purpose: GroupPurpose | null | undefined) => purpose === "roommates" || purpose === "family";

/** Onboarding for roommates and families: three starter chores and the usual five upkeep items, if those are on. */
async function startHousehold(ctx: Ctx, toolkits: ToolkitId[]): Promise<{ chores: number; upkeep: number }> {
  return {
    chores: toolkits.includes("chores") ? await addStarterChores(ctx) : 0,
    upkeep: toolkits.includes("upkeep") ? await addDefaults(ctx) : 0,
  };
}

/** Admin: the "simplify debts" switch (getSettlePlan follows it). Unlike updateGroupSettings it never ends Onboarding. */
export async function setSimplifyDebts(ctx: Ctx, input: { on: boolean }): Promise<boolean> {
  await requireAdmin(ctx);
  await db.update(groups).set({ simplifyDebts: input.on }).where(eq(groups.id, ctx.groupId));
  await record(ctx.groupId, ctx.memberId, "group.settings", `turned simplify debts ${input.on ? "on" : "off"}`, { table: "groups", id: ctx.groupId });
  return input.on;
}

/** Admin: switch one Toolkit on or off. Nothing is deleted when it's off. */
export async function setToolkit(ctx: Ctx, input: { toolkit: ToolkitId; enabled: boolean }): Promise<ToolkitId[]> {
  await requireAdmin(ctx);
  if (!TOOLKIT_IDS.includes(input.toolkit)) throw new Error(`Unknown Toolkit "${input.toolkit}". Toolkits: ${TOOLKIT_IDS.join(", ")}.`);
  await db
    .insert(groupToolkits)
    .values({ groupId: ctx.groupId, toolkit: input.toolkit, enabled: input.enabled })
    .onConflictDoUpdate({ target: [groupToolkits.groupId, groupToolkits.toolkit], set: { enabled: input.enabled } });
  await record(ctx.groupId, ctx.memberId, "toolkit.toggled", `switched ${input.toolkit} ${input.enabled ? "on" : "off"}`);
  return enabledToolkits(ctx);
}

const DATA_TABLES = [schema.outboxJobs, schema.splitwiseLinks, schema.cartCheckouts, schema.expenses, schema.settlements, schema.cartItems, schema.recipes, schema.chores, schema.reminders, schema.maintenance, schema.chatMessages, schema.activity] as const;

/**
 * Admin "delete group data" (ADR 0006): every Expense, Settlement, Cart item, chore, reminder, upkeep item, chat
 * line, Activity row, Member note, Splitwise link and Roomie's memory for the Group. The Group, its Chat, Members and settings
 * stay, so Roomie keeps working from the next message.
 */
export async function deleteGroupData(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  await wipeGroupRows(ctx.groupId);
  const { forgetGroupInMemory } = await import("@/mastra/forget");
  await forgetGroupInMemory(ctx.groupId);
  await record(ctx.groupId, ctx.memberId, "group.data_deleted", "deleted the group's data");
}

async function wipeGroupRows(groupId: string) {
  await db.transaction(async (tx) => {
    for (const t of DATA_TABLES) await tx.delete(t).where(eq(t.groupId, groupId)); // splits and chore logs cascade
    const ids = tx.select({ id: members.id }).from(members).where(eq(members.groupId, groupId));
    await tx.delete(schema.memberNotes).where(inArray(schema.memberNotes.memberId, ids));
    await tx.delete(schema.claimTokens).where(inArray(schema.claimTokens.memberId, ids));
  });
}

/** Internal (tests, evals, dev-chat): remove a Group and everything it owns, memory included. */
export async function deleteGroup(groupId: string): Promise<void> {
  await wipeGroupRows(groupId);
  await db.delete(groups).where(eq(groups.id, groupId)); // chats, members, toolkits cascade
  const { forgetGroupInMemory } = await import("@/mastra/forget");
  await forgetGroupInMemory(groupId);
}
