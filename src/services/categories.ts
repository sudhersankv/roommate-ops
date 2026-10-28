// Expense categories. Roomie picks one for every Expense; this guess is the fallback when nobody did (old rows, the
// Cart, imports without a category). Pure, so the dashboard can use it too.
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/db/enums";

export { EXPENSE_CATEGORIES, type ExpenseCategory };

const hints: [ExpenseCategory, RegExp][] = [
  ["rent", /\brent\b|landlord|lease/i],
  ["utilities", /internet|wi-?fi|electric|power bill|water bill|\bwater\b|utilit|gas bill|phone bill|\bbill\b/i],
  ["groceries", /grocer|costco|trader joe|whole foods|market|ingredient|milk|eggs|aldi|safeway/i],
  ["food", /pizza|brunch|dinner|lunch|breakfast|restaurant|taco|sushi|takeout|take-out|coffee|cafe|burger|bar tab|drinks|food/i],
  ["household", /clean|towel|soap|toilet|detergent|supplies|trash bag|furniture|lamp|repair|plumber/i],
  ["entertainment", /ticket|movie|concert|game|snack|party|netflix|spotify|streaming|\bbar\b/i],
  ["transport", /uber|lyft|taxi|\bcab\b|train|\bbus\b|parking|\bgas\b|fuel|toll/i],
  ["travel", /flight|hotel|airbnb|trip|vacation|hostel/i],
  ["health", /pharmacy|doctor|medic|dentist|gym|vitamin/i],
];

export function guessCategory(description: string, source?: string): ExpenseCategory {
  if (source === "cart") return "groceries";
  return hints.find(([, re]) => re.test(description))?.[0] ?? "other";
}

export const isCategory = (c: unknown): c is ExpenseCategory => typeof c === "string" && (EXPENSE_CATEGORIES as readonly string[]).includes(c);
