// Value lists shared by the schema, services and the dashboard. No drizzle import, so client code can use them.
export const EXPENSE_CATEGORIES = ["food", "groceries", "rent", "utilities", "transport", "entertainment", "household", "travel", "health", "other"] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export const SPLIT_METHODS = ["equal", "exact", "percent", "shares"] as const;
export type SplitMethod = (typeof SPLIT_METHODS)[number];
export const RECURRENCES = ["monthly", "weekly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];
export const EXPENSE_SOURCES = ["chat", "ui", "cart", "splitwise", "recurring"] as const;
export type ExpenseSource = (typeof EXPENSE_SOURCES)[number];
