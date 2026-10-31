// Groups: settings, Toolkits, the Account's group list, and "delete group data".
// defaultToolkitsFor / validateSettings are pure (groups.test.ts).
import { and, asc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { GROUP_PURPOSES, type ChannelName, type GroupPurpose } from "@/db/schema";
import { resolveTimeZone } from "@/lib/time";
import { CATALOG, MANIFESTS, TOOLKIT_IDS, type ToolkitId } from "@/toolkits/manifests";
import { presetFor } from "@/toolkits/presets";
import { recordFor } from "./activity";
import { requireAdmin } from "./authz";
import type { Ctx, GroupCtx } from "./types";

const { groups, chats, groupToolkits, members } = schema;

export type Group = typeof groups.$inferSelect;
export type Chat = typeof chats.$inferSelect;
export type Chattiness = Group["chattiness"];

/* ---------- pure ---------- */

/** What a Group gets switched on when it tells Roomie what it's for (toolkits/presets.ts). Core is always on. */
export function defaultToolkitsFor(purpose: GroupPurpose | null | undefined): ToolkitId[] {
  return presetFor(purpose);
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

/** The Group's currency (USD when unknown), for saying amounts (types.moneyIn). */
export async function currencyOf(groupId: string): Promise<string> {
  const [row] = await db.select({ currency: schema.groups.currency }).from(schema.groups).where(eq(schema.groups.id, groupId)).limit(1);
  return row?.currency ?? "USD";
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

/** Groups with a Chat (the only ones Roomie can post to unprompted). */
export async function groupsWithChat(onlyGroupId?: string): Promise<Pick<Group, "id" | "name" | "timezone" | "styleNoteAt">[]> {
  return db
    .select({ id: groups.id, name: groups.name, timezone: groups.timezone, styleNoteAt: groups.styleNoteAt })
    .from(groups)
    .innerJoin(chats, eq(chats.groupId, groups.id))
    .where(onlyGroupId ? eq(groups.id, onlyGroupId) : undefined);
}

/** Every Toolkit with its on/off state. A Toolkit with no row follows its manifest's `defaultOn`. */
export async function listToolkits(ctx: GroupCtx): Promise<{ id: ToolkitId; enabled: boolean }[]> {
  const rows = await db.select().from(groupToolkits).where(eq(groupToolkits.groupId, ctx.groupId));
  const byId = new Map(rows.map((r) => [r.toolkit, r.enabled]));
  return MANIFESTS.map((m) => ({ id: m.id, enabled: byId.get(m.id) ?? m.defaultOn }));
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

/** The Chat's title changed on its Channel (a WhatsApp group subject). The Group's own name stays as the Group set it. */
export async function renameChat(channel: ChannelName, externalId: string, title: string): Promise<void> {
  await db.update(chats).set({ title }).where(and(eq(chats.channel, channel), eq(chats.externalId, externalId)));
}

async function writeToolkits(groupId: string, on: readonly ToolkitId[]) {
  await db
    .insert(groupToolkits)
    .values(TOOLKIT_IDS.map((toolkit) => ({ groupId, toolkit, enabled: on.includes(toolkit) })))
    .onConflictDoUpdate({ target: [groupToolkits.groupId, groupToolkits.toolkit], set: { enabled: sql`excluded.enabled` } });
}

/** Seed Toolkit rows for a new Group (Onboarding, seed, tests). Default: every Toolkit that's on by default. */
export async function initToolkits(groupId: string, on: readonly ToolkitId[] = presetFor(null)) {
  await writeToolkits(groupId, on);
}

/**
 * Admin: change Group settings. The first time a purpose arrives during Onboarding, the Group gets that purpose's
 * default Toolkits (unless `toolkits` says otherwise) and Onboarding is marked done. Each Toolkit that goes on runs
 * its own onEnable (the starter chores, the Pantry): Onboarding names none of them.
 */
export async function updateGroupSettings(ctx: Ctx, patch: SettingsPatch & { toolkits?: ToolkitId[] }): Promise<{ group: Group; toolkits: ToolkitId[] }> {
  await requireAdmin(ctx);
  const clean = validateSettings(patch);
  const before = await getGroup(ctx.groupId);
  if (!before) throw new Error("This group doesn't exist anymore.");
  const onboarding = !before.onboardedAt;
  const set = { ...clean, ...(onboarding ? { onboardedAt: new Date() } : {}) };
  const [group] = Object.keys(set).length ? await db.update(groups).set(set).where(eq(groups.id, ctx.groupId)).returning() : [before];
  const wasOn = await enabledToolkits(ctx);
  const { resolveToolkitSet } = await import("./toolkits");
  // A full list keeps what each Toolkit requires (Groceries pulls Money in), as setToolkit does one at a time.
  const list = patch.toolkits ?? (onboarding && clean.purpose ? defaultToolkitsFor(clean.purpose) : null);
  if (list) await writeToolkits(ctx.groupId, resolveToolkitSet(list, CATALOG));
  const changed = Object.keys(clean);
  if (changed.length) await recordFor(ctx, "group.settings", `changed ${changed.join(", ")}`, { table: "groups", id: ctx.groupId });
  const toolkits = await enabledToolkits(ctx);
  // Onboarding's preset counts as switching each of its Toolkits on; later, only the ones that just went on.
  const choseNow = !!patch.toolkits || (onboarding && !!clean.purpose);
  if (choseNow) {
    const { runHooks } = await import("./toolkits");
    await runHooks(ctx, onboarding ? toolkits : toolkits.filter((t) => !wasOn.includes(t)), wasOn.filter((t) => !toolkits.includes(t)));
  }
  return { group, toolkits };
}

/** Admin: the "simplify debts" switch (getSettlePlan follows it). Unlike updateGroupSettings it never ends Onboarding. */
export async function setSimplifyDebts(ctx: Ctx, input: { on: boolean }): Promise<boolean> {
  await requireAdmin(ctx);
  await db.update(groups).set({ simplifyDebts: input.on }).where(eq(groups.id, ctx.groupId));
  await recordFor(ctx, "group.settings", `turned simplify debts ${input.on ? "on" : "off"}`, { table: "groups", id: ctx.groupId });
  return input.on;
}

// The Lease Inbox's mail rows, work orders and landlord senders go too (sent_mail first: it points at work_orders);
// its address is released separately (wipeGroupData: AgentMail, then group_inboxes). Restock's purchase history and the
// grocery usuals too.
const DATA_TABLES = [schema.outboxJobs, schema.splitwiseLinks, schema.cartCheckouts, schema.expenses, schema.settlements, schema.cartItems, schema.purchaseEvents, schema.groceryUsuals, schema.recipes, schema.chores, schema.reminders, schema.maintenance, schema.chatMessages, schema.activity, schema.petMoments, schema.pendingPosts, schema.sentMail, schema.workOrders, schema.mailMessages, schema.mailEvents, schema.landlordSenders] as const;

/**
 * Admin "delete group data" (ADR 0006): every Expense, Settlement, Cart item, chore, reminder, upkeep item, chat
 * line, Activity row, Member note, Splitwise link, Document (and its file), held quiet-hours post, trace and score,
 * purchase event, grocery usual, the Lease Inbox's mail and its address (released), and Roomie's memory for the Group.
 * The Group, its Chat, Members and settings stay, so Roomie keeps working from the next message.
 */
export async function deleteGroupData(ctx: Ctx): Promise<void> {
  await requireAdmin(ctx);
  await wipeGroupData(ctx.groupId);
  await recordFor(ctx, "group.data_deleted", "deleted the group's data");
}

/**
 * The email address first (best-effort: a mail-service failure is logged and never stops the deletion), then rows,
 * then what lives outside the app's tables: memory, traces and scores, Documents (rows and their files).
 */
async function wipeGroupData(groupId: string) {
  const { releaseGroupInbox } = await import("./lease-inbox");
  await releaseGroupInbox(groupId);
  await wipeGroupRows(groupId);
  const { forgetGroupInMemory, forgetGroupTraces } = await import("@/mastra/forget");
  await forgetGroupInMemory(groupId);
  await forgetGroupTraces(groupId);
  const { deleteGroupDocuments } = await import("./documents");
  await deleteGroupDocuments(groupId);
}

async function wipeGroupRows(groupId: string) {
  await db.transaction(async (tx) => {
    for (const t of DATA_TABLES) await tx.delete(t).where(eq(t.groupId, groupId)); // splits and chore logs cascade
    // Claims on the scheduler's own posts hold nothing personal; the current week's stay so a nudge or report isn't
    // posted twice in its period.
    await tx.delete(schema.scheduledPosts).where(and(eq(schema.scheduledPosts.groupId, groupId), lt(schema.scheduledPosts.createdAt, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000))));
    const ids = tx.select({ id: members.id }).from(members).where(eq(members.groupId, groupId));
    await tx.delete(schema.memberNotes).where(inArray(schema.memberNotes.memberId, ids));
    await tx.delete(schema.claimTokens).where(inArray(schema.claimTokens.memberId, ids));
    // What Roomie learned about how the Group talks is memory too; the Admin's personality choices stay.
    await tx.update(groups).set({ personality: sql`${groups.personality} - 'learned'` }).where(eq(groups.id, groupId));
  });
}

/** Internal (tests, evals, dev-chat, scripts/scrub-dev.ts): remove a Group and everything it owns, memory included. */
export async function deleteGroup(groupId: string): Promise<void> {
  await wipeGroupData(groupId);
  await db.delete(groups).where(eq(groups.id, groupId)); // chats, members, toolkits, scheduled posts cascade
}
