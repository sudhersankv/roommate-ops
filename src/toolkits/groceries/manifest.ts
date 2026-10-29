import { defineManifest } from "../define";

export const groceries = defineManifest({
  id: "groceries",
  name: "Groceries",
  description: "The shared grocery Cart, Recipes and the Pantry: adding and removing items, cooking plans, the Instacart checkout, logging what the shop cost.",
  summary: "One shared Cart, recipes for the group, and an Instacart list.",
  longDescription:
    "Anyone can add to the shared Cart from the chat (\"we're out of dish soap\"), for themselves or for everyone. Ask for a dish and Roomie writes a Recipe for the group's size, leaving out what's in the Pantry. When someone shops, \"I paid 84\" splits the bill by who added what. The Cart turns into an Instacart shopping list in one tap.",
  icon: "ShoppingCart",
  category: "food",
  tags: ["cart", "recipes", "pantry", "shopping", "Instacart", "meal plan"],
  defaultOn: true,
  worksWith: { integrations: ["instacart"] },
  status: "stable",
  gate: {
    criterion:
      "Groceries and food at home: the shared grocery cart (adding or removing items, being out of something, shopping, checking out, what the grocery shop cost), recipes, cooking, meal planning ('tacos for 5 friday'), and the pantry of things the group always has.",
    examples: ["tacos for 5 friday", "add milk and eggs", "we're out of dish soap", "I paid 84 for groceries"],
  },
  persona: `- Groceries: a Recipe ("tacos for 5 friday") is recipe_draft, written for the group's size unless they say how many; post its text and ask its askToAdd question. A Recipe never touches the cart by itself: add its ingredients (recipe_add_to_cart) only when someone asks or clearly means it ("yes add them", "...and put it on the list"); what they say they have ("we have onions") goes in skip. If a cart add is ambiguous, ask "for you or the whole house?"; household stuff and "for the house" is shared. "Checkout" / "order it" is cart_checkout. "I paid 84 for groceries" while the cart has things (or after a checkout) is cart_purchased, not log_expense: say each person's part from its shares. "We always have salt" is pantry_set.`,
  abilities: {
    cart_add: "Add things to the Cart, for you or for everyone",
    cart_remove: "Take things out of the Cart",
    cart_view: "Show the Cart with estimated prices",
    cart_checkout: "Turn the Cart into an Instacart shopping list",
    cart_purchased: "\"I paid 84\": split the shop by who added what",
    recipe_draft: "Write a Recipe for the group's size",
    recipe_add_to_cart: "Put a Recipe's missing ingredients in the Cart",
    recipe_link: "Open a Recipe in Instacart",
    pantry_set: "Remember what the group always has",
    pantry_list: "Say what's in the Pantry",
  },
  dashboard: {
    nav: { label: "Cart", href: (g) => `/g/${g}/cart`, icon: "ShoppingCart", order: 20 },
    pages: ["cart"],
  },
});
