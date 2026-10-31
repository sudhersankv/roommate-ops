import { defineManifest } from "../define";

export const groceries = defineManifest({
  id: "groceries",
  name: "Groceries",
  description: "The shared grocery Cart, Recipes and the Pantry: adding and removing items, cooking plans, the Instacart checkout, logging what the shop cost.",
  summary: "One shared Cart, recipes for the group, and an Instacart list.",
  spoken: "groceries",
  longDescription:
    "Anyone can add to the shared Cart from the chat (\"we're out of dish soap\"), for themselves or for everyone, or send a photo of a recipe or a shopping list. Ask for a dish and Roomie writes a Recipe for the group's size, leaving out what's in the Pantry. The Cart turns into an Instacart shopping list in one tap, and when someone shops, \"I paid 84\" splits the bill by who added what.",
  icon: "ShoppingCart",
  category: "food",
  tags: ["cart", "recipes", "pantry", "shopping", "Instacart", "meal plan"],
  defaultOn: true,
  // "I paid 84" ends in an Expense, so Money has to be on (toggle_toolkit and the Tricks page both check).
  requires: { toolkits: ["splitting"] },
  worksWith: { integrations: ["instacart"] },
  status: "stable",
  gate: {
    criterion:
      "Groceries and food at home: the shared grocery cart (adding or removing items, being out of something, shopping, checking out, what the grocery shop cost), a photo of a recipe or a shopping list, recipes, cooking, meal planning ('tacos for 5 friday'), and the pantry of things the group always has.",
    examples: ["tacos for 5 friday", "add milk and eggs", "we're out of dish soap", "add these (with a photo of a list or a recipe)", "I paid 84 for groceries"],
  },
  abilities: {
    cart_add: "Add things to the Cart, for you or for everyone",
    cart_remove: "Take things out of the Cart",
    cart_view: "Show what's in the Cart",
    cart_from_photo: "Add a recipe or shopping list from a photo",
    cart_checkout: "Turn the Cart into an Instacart shopping list",
    cart_purchased: "\"I paid 84\": split the shop by who added what",
    recipe_draft: "Write a Recipe for the group's size",
    recipe_add_to_cart: "Put a Recipe's missing ingredients in the Cart",
    recipe_link: "Open a Recipe in Instacart",
    pantry_set: "Remember what the group always has",
    pantry_list: "Say what's in the Pantry",
    restock_status: "Say what's probably running low",
    restock_add_listed: "\"Yes, add them\": put what's probably low in the Cart",
    restock_mute: "Stop mentioning something you don't buy anymore",
    restock_unmute: "Mention it again",
  },
  // Groceries' lines come after money, the landlord and the house (ADR 0017).
  postOrder: 40,
  dashboard: {
    // After Money (10) and House (30) in the dock's order: the Cart's writes happen in the chat (ADR 0015).
    nav: { label: "Cart", href: (g) => `/g/${g}/cart`, icon: "ShoppingCart", order: 40 },
    pages: ["cart"],
  },
});
