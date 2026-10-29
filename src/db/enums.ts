// Value lists shared by the schema, services and the dashboard. No drizzle import, so client code can use them.
export const EXPENSE_CATEGORIES = ["food", "groceries", "rent", "utilities", "transport", "entertainment", "household", "travel", "health", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const SPLIT_METHODS = ["equal", "exact", "percent", "shares"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];
export const RECURRENCES = ["monthly", "weekly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const EXPENSE_SOURCES = ["chat", "ui", "cart", "splitwise", "recurring"] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];
export const GROUP_PURPOSES = ["roommates", "trip", "friends", "family", "work", "other"] as const;
export type GroupPurpose = (typeof GROUP_PURPOSES)[number];
/** Beta requests (the landing page's WhatsApp form): how many people, and how far the operator got with them. */
export const BETA_GROUP_SIZES = ["2", "3-4", "5-8", "9-15", "16+"] as const;
export type BetaGroupSize = (typeof BETA_GROUP_SIZES)[number];
export const BETA_STATUSES = ["new", "contacted", "onboarded", "declined"] as const;
export type BetaStatus = (typeof BETA_STATUSES)[number];
