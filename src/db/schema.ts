// Shared contract #1: the schema. Change it only after telling the other person.
// Money is always integer cents.
import { pgTable, uuid, text, integer, boolean, timestamp, primaryKey } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const households = pgTable("households", {
  id: id(),
  name: text("name").notNull(),
  chatId: text("chat_id").unique(), // the linked Chat's id on its Channel
  // How readily Roomie speaks up unaddressed; thresholds in mastra/gate/policy.ts.
  chattiness: text("chattiness", { enum: ["quiet", "normal", "chatty"] }).notNull().default("normal"),
  // Last Group style refresh (jobs/style-note.ts); chat_log lines after it count toward the next one.
  styleNoteAt: timestamp("style_note_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const members = pgTable("members", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  name: text("name").notNull(),
  channelUserId: text("channel_user_id"), // the person's id on the Channel
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const expenses = pgTable("expenses", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  payerId: uuid("payer_id").notNull().references(() => members.id),
  cents: integer("cents").notNull(),
  description: text("description").notNull(),
  source: text("source", { enum: ["chat", "ui", "cart"] }).notNull().default("chat"),
  createdAt: createdAt(),
});

export const expenseSplits = pgTable(
  "expense_splits",
  {
    expenseId: uuid("expense_id").notNull().references(() => expenses.id, { onDelete: "cascade" }),
    memberId: uuid("member_id").notNull().references(() => members.id),
    cents: integer("cents").notNull(),
  },
  (t) => [primaryKey({ columns: [t.expenseId, t.memberId] })],
);

export const settlements = pgTable("settlements", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  fromId: uuid("from_id").notNull().references(() => members.id),
  toId: uuid("to_id").notNull().references(() => members.id),
  cents: integer("cents").notNull(),
  createdAt: createdAt(),
});

export const cartItems = pgTable("cart_items", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  name: text("name").notNull(),
  qty: text("qty").notNull().default("1"), // free text: "2", "3 gallons"
  addedBy: uuid("added_by").notNull().references(() => members.id),
  shared: boolean("shared").notNull().default(false),
  estCents: integer("est_cents"),
  status: text("status", { enum: ["open", "purchased"] }).notNull().default("open"),
  createdAt: createdAt(),
});

export const chores = pgTable("chores", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  name: text("name").notNull(),
  everyDays: integer("every_days").notNull().default(7),
});

export const choreLogs = pgTable("chore_logs", {
  id: id(),
  choreId: uuid("chore_id").notNull().references(() => chores.id),
  memberId: uuid("member_id").notNull().references(() => members.id),
  doneAt: timestamp("done_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reminders = pgTable("reminders", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  text: text("text").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  memberId: uuid("member_id").references(() => members.id),
  recurring: text("recurring", { enum: ["monthly"] }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
});

export const maintenance = pgTable("maintenance", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  item: text("item").notNull(),
  everyDays: integer("every_days").notNull(),
  lastDone: timestamp("last_done", { withTimezone: true }),
});

// Every group message, addressed to Roomie or not, so it has the group context when it does reply.
export const chatLog = pgTable("chat_log", {
  id: id(),
  householdId: uuid("household_id").notNull().references(() => households.id),
  memberId: uuid("member_id").references(() => members.id), // null = Roomie
  text: text("text").notNull(),
  createdAt: createdAt(),
});
