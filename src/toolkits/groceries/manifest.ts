import { defineManifest } from "../define";

export const groceries = defineManifest({
  id: "groceries",
  name: "Groceries",
  description: "The shared grocery Cart, Recipes and the Pantry: adding and removing items, cooking plans, the Instacart checkout, logging what the shop cost.",
  summary: "One shared Cart, recipes for the group, and an Instacart list.",
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
  persona: `- Groceries has no prices. Never say a price, an estimate or a cart total; the real money comes from the receipt later. Quantities as people said them.
- Adding: if it's unclear whether it's for them or everyone, ask "for you or the whole house?"; household stuff, "for the house" and "common" are shared. If cart_add returns needsClarification, ask just that, in one line. After an add, one line: what went in ("Added eggs."), no recap of the cart.
- "[photo: <url>]" is cart_from_photo (it tells you when it's a receipt), unless it's clearly a receipt: then expense_from_receipt (Money's tool) with that url. For a recipe or a list: say its summary in one line and ask "Add them as shared?" (or for whom), unless the caption already said; on yes, cart_from_photo again with confirm. If it says kind "receipt", use expense_from_receipt with the same url.
- A Recipe ("tacos for 5 friday") is recipe_draft, written for the group's size unless they say how many; post its text and ask its askToAdd question. A Recipe never touches the cart by itself: add its ingredients (recipe_add_to_cart) only when someone asks or clearly means it ("yes add them", "...and put it on the list"); what they say they have ("we have onions") goes in skip. Put what you know about the people eating (vegetarian, allergies) in recipe_draft's request.
- "Checkout" / "order it" is cart_checkout. If it returns suggested items, ask once before giving the link ("Want me to add eggs and coffee? They're probably low."), unless they said "just checkout"; on yes, cart_add them as shared, then cart_checkout again. "I paid 84 for groceries" while the cart has things (or after a checkout) is cart_purchased, not log_expense: say each person's part from its shares. "We always have salt" is pantry_set.
- Restock: "what are we low on?" is restock_status, "we don't buy X anymore" restock_mute, "actually we do buy X" restock_unmute; post their say as it is.
- Don't offer the Cart page unless they ask for it (then cart_view with link).`,
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
    restock_mute: "Stop mentioning something you don't buy anymore",
    restock_unmute: "Mention it again",
  },
  // Groceries' lines come after money, the landlord and the house (ADR 0017).
  postOrder: 40,
  dashboard: {
    nav: { label: "Cart", href: (g) => `/g/${g}/cart`, icon: "ShoppingCart", order: 20 },
    pages: ["cart"],
  },
});
