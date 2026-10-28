# Eval baseline

`npm run evals` on 2026-10-28: **53/54 (98%)**, 7.1 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $60 internet, Maya paid, split 3 ways, $20 each 💸 |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $30 uber, Sam paid, split with Dev. Dev owes Sam $15.00 🚗 |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $90 dinner, Maya paid. Maya $45 (steak 🥩), Dev $22.50, Sam $22.50. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $41.25 wine and cheese, Maya paid. Split 2:2:1, so Maya $16.50, Dev $16.50, Sam $8.25 🧀🍷 |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those add up to $55 (30 + 15 + 10), but you paid $50. Which is off: the total or someone's part? |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $100 concert tickets, Dev paid $60 and Maya $40, split 3 ways. Maya's share is $33.33, Dev's is $33.34 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the $24.00 pizza expense. Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back: $24.00 is restored. 🍕 |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle-up links will point there now 💸 |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam, you owe $30.00 to Dev and $30.00 to Maya. Dev owes Maya $30.00. Overall Maya is owed $60.00, you're down  |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. Want the pay buttons? |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $54 water bill, Maya paid, split 3 ways, $18 each 💧 |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | You owe Maya $20.00. The Venmo button's below 👇 Tell me once you've paid and I'll record it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, you paid. Dev owes $78.65 (steak plus his share of the rest), and you and S |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and Sam owes Maya $20.00. Maya is owed $40.00 in total. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Maya's owed $40.00 total: Dev owes her $20.00 and you owe her $20.00. Want the pay buttons for yours, Sam? |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged: Dev paid Maya $20.00. You two are square now ✅ |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Lately: pizza $24 (Dev paid) and internet $60 (you paid), both split 3 ways, so $8 and $20 each. 🍕 |
| unknown-name | splitting | act/hard-trigger/splitting | list_members | ✅ |  | Jordan isn't in this group (just Dev, Sam and you). Did you mean Dev or Sam? If Jordan's new, they'll need to  |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza, Dev paid, split 3 ways between Dev, Maya and Sam? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Listo: Uber $30, pagó Maya, dividido en 3: $10 cada uno 🚕 |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs for you or for the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's in the cart as a shared item, about $3.49 estimated. It's the only thing in there so far. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's pretty light: Dev has oat milk and 6 bananas, about $13.93 estimated total. Anything to add? |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off the list ✅ |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Checkout's ready: 2 items, about $8.78 estimated. Tap the Instacart button to order. Once it's bought, tell me |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $84 groceries (4 items), Maya paid. Shares: Maya $32.57, Dev $36.00, Sam $15.43. Cart's cleared 🛒 |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken to the house cart, about $8.99. The cart is just that for now 🍗 |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's on the cart as a shared item, about $3.49 estimated. Anything else we need while we're at it? |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min), planned for Friday: Need: 1.5 lb ground beef, 1 yellow onion, 0.5 head garlic, |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 12 items to the cart, skipping the onion. The estimated total is $46.54 🌮 |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | They explicitly asked to add, so add.Garlic Tomato Spaghetti for 3, 25 min: spaghetti, crushed tomatoes, garli |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart page for Tacos for 5, Dev 🌮 |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's at 12 items, about $46.82 estimated. Dev has oat milk ($4.99). The other 11 are shared, from Maya's "Ta |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Got it, salt and oil are in the pantry. I'll leave them out of any recipe carts from now on. 🧂 |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | We always have oil, rice and salt. Tell me if something should be added or removed. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $42.00 for groceries (2 items), Sam paid. Maya owes $22.24 and Dev owes $19.76 🛒 |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Are the salsa and the 2 bags of chips just for you, or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes done by Dev ✨ That's streak #1, so keep it going. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Nice one, Dev. Want me to log the dishes as done by you? 🧽 |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | It's Dev's turn. Maya just did it today, and the next one is due Saturday. 🗑️ |
| add-chore | chores | act/hard-trigger/chores | add_chore | ✅ |  | Vacuuming is on the chart, every 7 days. Who's taking the first round? 🧹 |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Trash logged for Dev ✨ That's streak 1. |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | add_maintenance | ✅ |  | Tracking it: AC filter every 90 days. Tell me when it's changed and I'll reset the clock. 🧊 |
| maintenance-done | upkeep | act/hard-trigger/upkeep | maintenance_done | ✅ |  | Marked done: HVAC filter replaced today. Thanks Dev, the lungs of the house appreciate it 😮‍💨 |
| remind-trash-tuesday | reminders | act/hard-trigger | set_reminder | ✅ |  | Done. Tuesday, Nov 3 at 8:00 PM: trash goes out, everyone 🗑️ |
| list-reminders | reminders | act/hard-trigger/reminders | list_reminders | ✅ |  | Just one coming up: "Rent is due" on Monday, Nov 2 at 5:38 PM, for everyone. |
| group-report | core | act/hard-trigger | group_report | ✅ |  | 📣 Group report 💸 Dev pays Maya $20.00 💸 Sam pays Maya $20.00 🧹 No chores on the chart yet. ⏰ Nothing sched |
| members | core | act/hard-trigger | list_members | ❌ | reply lacks Dev | Three of us: you, Maya (admin) and Sam. All active. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger/groceries | - | ✅ |  | Anytime! Salsa still isn't in the cart though. Is it just for you or for the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, what for, and how much? I'll get it logged once I have those, and I'll split it evenly three ways un |
