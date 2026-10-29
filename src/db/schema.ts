// The app's tables (Drizzle). Migrations live in drizzle/ (npm run db:generate, npm run db:migrate).
// Money is always integer cents. Accounts point at Neon Auth users (schema neon_auth) by id, as text; we never
// write to neon_auth.
import { sql } from "drizzle-orm";
import { BETA_GROUP_SIZES, BETA_STATUSES, EXPENSE_CATEGORIES, EXPENSE_SOURCES, GROUP_PURPOSES, RECURRENCES, SPLIT_METHODS } from "./enums";
import { boolean, char, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export { GROUP_PURPOSES, type GroupPurpose } from "./enums";
export const CHATTINESS_LEVELS = ["quiet", "normal", "chatty"] as const;
export const CHANNELS = ["whatsapp", "telegram", "dev"] as const;
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
  // Roomie's personality (lib/personality.ts, ADR 0012): archetype, name, quirks, dials and the Learned style.
  // {} = the defaults (chill, "Roomie"); read it through normalizePersonality.
  personality: jsonb("personality").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: createdAt(),
});

/**
 * Pet moments said once (services/pet.ts): the day's greeting ("greeting", "2026-10-28") and wins ("win",
 * "streak:dishes:dev:7:2026-10-28"). The primary key makes "once" hold across retries and processes.
 */
export const petMoments = pgTable(
  "pet_moments",
  {
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["greeting", "win"] }).notNull(),
    key: text("key").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.kind, t.key] })],
);

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
    channelUserId: text("channel_user_id"), // the person's id on the Channel (Telegram user id, WhatsApp jid)
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
/** What Roomie knows about one Member ("knows you"): set by `remember`, shown by `what_do_you_know_about_me`, wiped by "forget me". */
export type MemberFacts = {
  preferredName?: string;
  diet?: string;
  allergies?: string;
  timezone?: string;
  /** 1-3 things they care about. */
  caresAbout?: string[];
  birthday?: string;
  other?: string[];
};
export type MemberNote = MemberFacts & { handles?: Partial<Record<PaymentApp, string>>; [key: string]: unknown };

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
  // Not unique by external id: the same Splitwise group may be imported into two Groups; imports dedupe per Group.
  (t) => [index("expense_external_refs_external").on(t.provider, t.externalId), uniqueIndex("expense_external_refs_expense").on(t.expenseId, t.provider)],
);

/** Splitwise "payments" come in as Settlements; same idea as expense_external_refs. */
export const settlementExternalRefs = pgTable(
  "settlement_external_refs",
  {
    settlementId: uuid("settlement_id").notNull().references(() => settlements.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["splitwise"] }).notNull(),
    externalId: text("external_id").notNull(),
  },
  (t) => [index("settlement_external_refs_external").on(t.provider, t.externalId), uniqueIndex("settlement_external_refs_settlement").on(t.settlementId, t.provider)],
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

/** One ingredient of a Recipe. `unit` is from Instacart's list (lib/units.ts); display_text is what people read. */
export type RecipeIngredient = { name: string; quantity: number; unit: string; display_text: string; shared?: boolean };

/** A dish Roomie (or a Member) wrote for the Group. It never touches the Cart by itself. */
export const recipes = pgTable(
  "recipes",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    servings: integer("servings").notNull(),
    cookingTimeMinutes: integer("cooking_time_minutes"),
    ingredients: jsonb("ingredients").$type<RecipeIngredient[]>().notNull().default([]),
    steps: jsonb("steps").$type<string[]>().notNull().default([]),
    source: text("source", { enum: ["roomie", "member"] }).notNull().default("roomie"),
    createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
    // The day it's planned for ("tacos friday"), in the Group's time zone.
    plannedFor: date("planned_for"),
    instacartUrl: text("instacart_url"),
    instacartUrlAt: timestamp("instacart_url_at", { withTimezone: true }),
    // Fingerprint of what the link was made from (title, servings, ingredients); a different one means a new link.
    instacartKey: text("instacart_key"),
    createdAt: createdAt(),
  },
  (t) => [index("recipes_group_created_at").on(t.groupId, t.createdAt)],
);

export const cartItems = pgTable("cart_items", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  qty: text("qty").notNull().default("1"), // free text for display: "2", "3 gallons"
  // Structured amount (from a Recipe, or parsed from qty) for the Instacart list; unit from lib/units.ts.
  quantity: numeric("quantity"),
  unit: text("unit"),
  addedBy: uuid("added_by").notNull().references(() => members.id),
  shared: boolean("shared").notNull().default(false),
  estCents: integer("est_cents"),
  status: text("status", { enum: ["open", "purchased"] }).notNull().default("open"),
  // Set when the item came from a Recipe ("From Tacos for 5" on the Cart page).
  recipeId: uuid("recipe_id").references(() => recipes.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export type CheckoutItem = { id: string; name: string; qty: string; quantity: number | null; unit: string | null; shared: boolean; addedBy: string; estCents: number | null; recipeId: string | null };

/** A Checkout: the open Cart as it was when someone asked for the Instacart list, so "I paid" can point at it. */
export const cartCheckouts = pgTable(
  "cart_checkouts",
  {
    id: id(),
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
    itemsSnapshot: jsonb("items_snapshot").$type<CheckoutItem[]>().notNull(),
    estCents: integer("est_cents").notNull().default(0),
    // Null when Instacart couldn't be reached; the Checkout still records what was in the Cart.
    instacartUrl: text("instacart_url"),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("cart_checkouts_group_created_at").on(t.groupId, t.createdAt)],
);

/* ---------- chores, reminders, upkeep ---------- */

export const chores = pgTable("chores", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  everyDays: integer("every_days").notNull().default(7),
  // Member ids in turn order. Null = everyone active, whoever did it least recently goes next.
  rotation: jsonb("rotation").$type<string[]>(),
});

export const choreLogs = pgTable("chore_logs", {
  id: id(),
  choreId: uuid("chore_id").notNull().references(() => chores.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").notNull().references(() => members.id),
  doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),
  // A passed turn: moves the rotation on, but isn't a done (no streak, the due date stays).
  skipped: boolean("skipped").notNull().default(false),
});

export const REMINDER_REPEATS = ["daily", "weekly", "monthly"] as const;
export type ReminderRepeat = (typeof REMINDER_REPEATS)[number];

export const reminders = pgTable("reminders", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  // Set = a private reminder for that Member; null = the whole Group, posted in the Chat.
  memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
  recurring: text("recurring", { enum: REMINDER_REPEATS }),
  createdBy: uuid("created_by").references(() => members.id, { onDelete: "set null" }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * What the scheduler posted on its own (the daily chores nudge, the weekly Group Report), one row per Group, kind and
 * local period. The row is claimed before sending, so a restart or a second process can't post it twice (ADR 0001).
 */
export const scheduledPosts = pgTable(
  "scheduled_posts",
  {
    groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["chores.nudge", "report.weekly"] }).notNull(),
    // The Group's local day ("2026-10-28") for the nudge, the report's local day for the report.
    period: text("period").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.kind, t.period] })],
);

/* ---------- WhatsApp (channels/whatsapp*.ts, ADR 0013) ---------- */

/**
 * The WhatsApp login (Baileys' creds + Signal keys), so a redeploy doesn't log Roomie out. One row per key: "creds"
 * and "<type>-<id>" (pre-key-12, session-...), values in Baileys' BufferJSON form. `id` names the session
 * ("default"; one number per deployment).
 */
export const waSessions = pgTable(
  "wa_sessions",
  {
    id: text("id").notNull().default("default"),
    key: text("key").notNull(),
    value: jsonb("value").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.id, t.key] })],
);

/**
 * What Roomie learned about WhatsApp people: a LID (the privacy id WhatsApp shows in many groups) with the phone JID
 * behind it when known, and the name they go by. members.channel_user_id is the phone JID when known (else the LID).
 */
export const waContacts = pgTable("wa_contacts", {
  lid: text("lid").primaryKey(),
  pn: text("pn"),
  name: text("name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------- Beta requests (services/beta.ts, docs/landing.md) ---------- */

/**
 * Someone asking for Roomie on WhatsApp from the landing page's form. Not tied to a Group or an Account: the operator
 * follows up by hand (/admin/beta). `ip_hash` is an HMAC of the address (for spotting abuse), never the address.
 */
export const betaRequests = pgTable(
  "beta_requests",
  {
    id: id(),
    createdAt: createdAt(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    groupSize: text("group_size", { enum: BETA_GROUP_SIZES }).notNull(),
    purpose: text("purpose", { enum: GROUP_PURPOSES }).notNull(),
    phone: text("phone"),
    notes: text("notes"),
    status: text("status", { enum: BETA_STATUSES }).notNull().default("new"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
  },
  (t) => [index("beta_requests_created_at").on(t.createdAt)],
);

export const maintenance = pgTable("maintenance", {
  id: id(),
  groupId: uuid("group_id").notNull().references(() => groups.id, { onDelete: "cascade" }),
  item: text("item").notNull(),
  everyDays: integer("every_days").notNull(),
  lastDone: timestamp("last_done", { withTimezone: true }),
});
