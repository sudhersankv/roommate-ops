import { Car, Popcorn, ReceiptText, ShoppingBasket, SprayCan, UtensilsCrossed, Zap, type LucideIcon } from "lucide-react"

export type Category = "groceries" | "utilities" | "dining" | "home" | "fun" | "transport" | "other"

export const categories: { value: Category; label: string; icon: LucideIcon }[] = [
  { value: "groceries", label: "Groceries", icon: ShoppingBasket },
  { value: "utilities", label: "Utilities", icon: Zap },
  { value: "dining", label: "Eating out", icon: UtensilsCrossed },
  { value: "home", label: "Around the house", icon: SprayCan },
  { value: "fun", label: "Fun", icon: Popcorn },
  { value: "transport", label: "Getting around", icon: Car },
  { value: "other", label: "Expense", icon: ReceiptText },
]

export const categoryOf = (c: Category) => categories.find((x) => x.value === c) ?? categories[categories.length - 1]

// Categories are picked by Roomie in step 5; until then the icon is a guess from the description, display only.
const hints: [Category, RegExp][] = [
  ["groceries", /grocer|costco|trader|market|food|ingredient|milk|eggs/i],
  ["utilities", /internet|wifi|electric|power|water|utility|bill|rent/i],
  ["dining", /pizza|brunch|dinner|lunch|breakfast|restaurant|taco|sushi|takeout|coffee/i],
  ["home", /clean|towel|soap|toilet|detergent|supplies|trash bag/i],
  ["fun", /ticket|movie|concert|game|snack|party|bar\b/i],
  ["transport", /uber|lyft|taxi|cab|train|bus|gas|parking|flight/i],
]

export function categoryFor(description: string, source?: string): Category {
  if (source === "cart") return "groceries"
  return hints.find(([, re]) => re.test(description))?.[0] ?? "other"
}
