// The app's tables (Drizzle). Migrations live in drizzle/ (npm run db:generate, npm run db:migrate).
// Money is always integer cents. Accounts point at Neon Auth users (schema neon_auth) by id, as text; we never
// write to neon_auth.
import { sql } from "drizzle-orm";
import { EXPENSE_CATEGORIES, EXPENSE_SOURCES, RECURRENCES, SPLIT_METHODS } from "./enums";
import { boolean, char, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const GROUP_PURPOSES = ["roommates", "trip", "friends", "family", "work", "other"] as const;
export type GroupPurpose = (typeof GROUP_PURPOSES)[number];
export const CHATTINESS_LEVELS = ["quiet", "normal", "chatty"] as const;
export const CHANNELS = ["whatsapp", "dev"] as const;
export type ChannelName = (typeof CHANNELS)[number];

/* ---------- core ---------- */

export const groups = pgTable("groups", {
  id: id(),
  name: text("name").notNull(),
  purpose: text("purpose", { enum: GROUP_PURPOSES }),
  currency: char("currency", { length: 3 }).notNull().default("USD"),
  timezone: text("timezone").notNull().default("America/Chicago"),
  // How readily Roomie speaks up unaddressed; thresholds in mastra/gate/policy.ts.
  chattiness: text("chattiness", { enum: CHATTINESS_LEVELS }).notNull().default("normal"),
  // Last Group style refresh (jobs/style-note.ts); chat_messages after it count toward the next one.
  styleNoteAt: timestamp("style_note_at", { withTimezone: true }),
  simplifyDebts: boolean("simplify_debts").notNull().default(true),
  // The Member who added Roomie (no FK: members reference groups, and this is informational).
  createdBy: uuid("created_by"),
  // Set when Onboarding's questions (purpose, currency, time zone) have been answered.
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** The conversation on a Channel. One Chat per Group. */
export const chats = pgTable(
  "chats",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: CHANNELS }).notNull().default("whatsapp"),
    externalId: text("external_id").notNull(),
    title: text("title"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("chats_channel_external_id").on(t.channel, t.externalId), uniqueIndex("chats_group_id").on(t.groupId)],
);

/** A signed-in person (mirrors a neon_auth user by id). One Account can be a Member of many Groups. */
export const accounts = pgTable("accounts", {
  id: id(),
  authUserId: text("auth_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  image: text("image"),
  createdAt: createdAt(),
});

export const members = pgTable(
  "members",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "set null" }),
    channelUserId: text("channel_user_id"), // the person's id on the Channel (WhatsApp jid)
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
    status: text("status", { enum: ["pending", "active", "removed"] }).notNull().default("pending"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    approvedBy: uuid("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // Last time a Claim link went out to this Member (ADR 0001: on demand, spaced apart).
    linkIssuedAt: timestamp("link_issued_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("members_group_channel_user").on(t.groupId, t.channelUserId),
    uniqueIndex("members_group_account").on(t.groupId, t.accountId),
  ],
);

/** Single-use, 24-hour links that connect an Account to a Member (ADR 0003). */
export const claimTokens = pgTable("claim_tokens", {
  token: text("token").primaryKey(),
  memberId: uuid("member_id").notNull().references(() => members.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const groupToolkits = pgTable(
  "group_toolkits",
  {
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    toolkit: text("toolkit").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.toolkit] })],
);

/** Every Chat message, addressed to Roomie or not. Kept 30 days (jobs/retention.ts, ADR 0006). */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }), // null = Roomie
    text: text("text").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("chat_messages_created_at").on(t.createdAt), index("chat_messages_group_created_at").on(t.groupId, t.createdAt)],
);

export type PaymentApp = "venmo" | "paypal" | "cashapp";
export type MemberNote = { handles?: Partial<Record<PaymentApp, string>>; [key: string]: unknown };

export const memberNotes = pgTable("member_notes", {
  memberId: uuid("member_id")
    .primaryKey()
    .references(() => members.id, { onDelete: "cascade" }),
  note: jsonb("note").$type<MemberNote>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The Group's record of who added, changed or deleted what. actor null = Roomie. */
export const activity = pgTable(
  "activity",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    actorMemberId: uuid("actor_member_id").references(() => members.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    summary: text("summary").notNull(),
    refTable: text("ref_table"),
    refId: text("ref_id"),
    createdAt: createdAt(),
  },
  (t) => [index("activity_group_created_at").on(t.groupId, t.createdAt)],
);

/* ---------- splitting ---------- */

export * from "./enums";

export const expenses = pgTable(
  "expenses",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    // The primary Payer (the one who paid the most), kept in sync with expense_payers for display and old readers.
    payerId: uuid("payer_id").notNull().references(() => members.id),
    cents: integer("cents").notNull(),
    description: text("description").notNull(),
    category: text("category", { enum: EXPENSE_CATEGORIES }).notNull().default("other"),
    note: text("note"),
    // The day it happened, in the Group's time zone (services set it; the column default is only a fallback).
    occurredOn: date("occurred_on").notNull().default(sql`current_date`),
    splitMethod: text("split_method", { enum: SPLIT_METHODS }).notNull().default("equal"),
    recurring: text("recurring", { enum: RECURRENCES }),
    // Set on the copies the scheduler makes of a recurring Expense; unique per (parent, day) so a copy is made once.
    recurringParentId: uuid("recurring_parent_id").references((): AnyPgColumn => expenses.id, { onDelete: "set null" }),
    receiptUrl: text("receipt_url"),
    source: text("source", { enum: EXPENSE_SOURCES }).notNull().default("chat"),
    createdBy: uuid("created_by").references(() => members.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("expenses_group_live").on(t.groupId).where(sql`${t.deletedAt} is null`),
    uniqueIndex("expenses_recurring_copy").on(t.recurringParentId, t.occurredOn).where(sql`${t.recurringParentId} is not null`),
  ],
);

/** Who paid how much of an Expense. Sums to expenses.cents. */
export const expensePayers = pgTable(
  "expense_payers",
  {
    expenseId: uuid("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull().references(() => members.id),
    cents: integer("cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

/** Shares. `weight` is what was typed for percent/shares splits (50, 2), so an edit shows the original method. */
export const expenseSplits = pgTable(
  "expense_splits",
  {
    expenseId: uuid("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull().references(() => members.id),
    cents: integer("cents").notNull(),
    weight: numeric("weight"),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

export const settlements = pgTable("settlements", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  fromId: uuid("from_id").notNull().references(() => members.id),
  toId: uuid("to_id").notNull().references(() => members.id),
  cents: integer("cents").notNull(),
  createdAt: createdAt(),
});

/* ---------- Splitwise (through Composio, ADR 0004) ---------- */

export const SPLITWISE_MODES = ["import", "mirror"] as const;

/** One Splitwise connection per Group, made by an Admin with their own Splitwise. */
export const splitwiseLinks = pgTable("splitwise_links", {
  groupId: uuid("group_id")
    .primaryKey()
    .references(() => groups.id, { onDelete: "cascade" }),
  connectedBy: uuid("connected_by").references(() => members.id, { onDelete: "set null" }),
  splitwiseGroupId: text("splitwise_group_id"),
  splitwiseGroupName: text("splitwise_group_name"),
  mode: text("mode", { enum: SPLITWISE_MODES }),
  // Our member id -> Splitwise user id, filled when a Splitwise group is linked.
  memberMap: jsonb("member_map").$type<Record<string, string>>().notNull().default({}),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** Our Expense <-> its copy elsewhere, so imports don't duplicate and mirror pushes update instead of re-creating. */
export const expenseExternalRefs = pgTable(
  "expense_external_refs",
  {
    expenseId: uuid("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["splitwise"] }).notNull(),
    externalId: text("external_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("expense_external_refs_external").on(t.provider, t.externalId), uniqueIndex("expense_external_refs_expense").on(t.expenseId, t.provider)],
);

/** Splitwise "payments" come in as Settlements; same idea as expense_external_refs. */
export const settlementExternalRefs = pgTable(
  "settlement_external_refs",
  {
    settlementId: uuid("settlement_id").notNull().references(() => settlements.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["splitwise"] }).notNull(),
    externalId: text("external_id").notNull(),
  },
  (t) => [uniqueIndex("settlement_external_refs_external").on(t.provider, t.externalId)],
);

/**
 * Work to do outside the request (ADR 0009): today only Splitwise mirror pushes. The scheduler tick runs due jobs,
 * and a failure is retried with backoff on a later tick.
 */
export const outboxJobs = pgTable(
  "outbox_jobs",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["splitwise.push"] }).notNull(),
    payload: jsonb("payload").$type<{ expenseId: string; op: "upsert" | "delete" }>().notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    doneAt: timestamp("done_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("outbox_jobs_due").on(t.runAfter).where(sql`${t.doneAt} is null`)],
);

/* ---------- groceries ---------- */

export const cartItems = pgTable("cart_items", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  qty: text("qty").notNull().default("1"), // free text: "2", "3 gallons"
  addedBy: uuid("added_by").notNull().references(() => members.id),
  shared: boolean("shared").notNull().default(false),
  estCents: integer("est_cents"),
  status: text("status", { enum: ["open", "purchased"] }).notNull().default("open"),
  createdAt: createdAt(),
});

/* ---------- chores, reminders, upkeep ---------- */

export const chores = pgTable("chores", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  everyDays: integer("every_days").notNull().default(7),
});

export const choreLogs = pgTable("chore_logs", {
  id: id(),
  choreId: uuid("chore_id").notNull().references(() => chores.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id),
  doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reminders = pgTable("reminders", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
  recurring: text("recurring", { enum: ["monthly"] }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const maintenance = pgTable("maintenance", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  item: text("item").notNull(),
  everyDays: integer("every_days").notNull(),
  lastDone: timestamp("last_done", { withTimezone: true }),
});
