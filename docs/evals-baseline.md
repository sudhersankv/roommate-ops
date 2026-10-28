# Eval baseline

`npm run evals` on 2026-10-28: **52/54 (96%)**, 6.8 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $60 internet, Maya paid, split 3 ways, $20 each 💸 |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $30 uber, Sam paid, split with Dev. Dev owes Sam $15.00 🚕 |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $90 dinner, Maya paid. Maya's share is $45.00 (steak tax 🥩), Dev and Sam owe $22.50 each. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $41.25 wine and cheese, Maya paid, split 2:2:1. Maya $16.50, Dev $16.50, Sam $8.25 🍷🧀 |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those parts (Dev 30, Sam 15, you 10) come to more than the $50 you paid, so I haven't logged anything yet. Did |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $100 concert tickets 🎟️ Dev paid $60, Maya paid $40, split 3 ways (Dev $33.34, Maya and Sam $33.33 ea |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza expense ($24.00). Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00, all as it was. 🍕 |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle-up links will use it now 💸 |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam, you owe $30.00 to Dev and $30.00 to Maya. Dev owes Maya $30.00. Dev is net $0 because he's owed $30 and o |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. Want the pay buttons? |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $54 water bill, Maya paid, split 3 ways, $18 each 💧 |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | You owe Maya $20.00. The Venmo pay button is attached. Tell me once you've paid and I'll record it. 💸 |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt,expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, you paid. Dev owes $78.65 (steak plus his share of the rest), and you and S |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Maya is owed $40.00. You owe Maya $20.00, and Sam owes Maya $20.00. Want the pay buttons? |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Maya's owed $40.00 total. Sam (you) owes Maya $20.00, and Dev owes Maya $20.00. Want the pay buttons for yours |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged: Dev paid Maya back $20.00. You two are square now ✅ |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Lately: pizza $24 (Dev paid, $8 each) and internet $60 (you paid, $20 each). Just those two so far, both today |
| unknown-name | splitting | act/hard-trigger/splitting | - | ✅ |  | I don't see a Jordan in this group. It's just Dev, Maya and Sam. Did you mean one of them, or does Jordan need |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza, Dev paid, split 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Listo: uber $30, pagó Maya, dividido entre 3, $10 cada uno 🚕 |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs for you, or for the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's in the cart as a shared item, about $3.49 estimated 🧼 |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's got two things, both Dev's: oat milk and 6 bananas. Estimated total is $13.93. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off the list ✅ |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Instacart list is ready: 2 items, about $8.78 estimated. Tap the button to order. Once someone pays, tell me t |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $84.00 groceries (4 items), Maya paid. Shares: Maya $32.57, Dev $36.00, Sam $15.43. Cart's cleared 🛒 |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken to the house cart, est. $8.99. 🛒 |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's on the cart as a shared item, about $3.49. Anything else for the list? |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 are set for Friday (35 min) 🌮 Need: 1.75 lb ground beef, 1 yellow onion, 3 cloves garlic, 2 tbsp  |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 11 items to the cart, about $47.04 total, and I left out the onion. Say the word when you want to check  |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | They explicitly asked to add, so add.Garlic Tomato Spaghetti for 3 (25 min): spaghetti, garlic, crushed tomato |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart link for the Tacos for 5 recipe, Dev 🌮 |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ❌ | bullets/headers | Cart's at 12 items, about $46.82 estimated. - **Dev:** oat milk. - **Shared, from Maya's Tacos for 5:** taco s |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Noted: salt and oil are in the pantry, so I'll leave them off recipe carts from now on 🧂 |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | We always have oil, rice and salt. Tell me if that list needs changing. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $42.00 for groceries (2 items), Sam paid. Maya owes Sam $22.24 and Dev owes $19.76. Cart's cleared 🛒 |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are they just for you, or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes done by Dev ✨ That's streak 1, so keep it going. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Want me to log the dishes as done by you, Dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | It's Dev's turn. Maya just took it out today, and it's due again Saturday (every 3 days), so Dev's not in a ru |
| add-chore | chores | act/hard-trigger/chores | add_chore | ✅ |  | Vacuuming is on the chart, every 7 days. Who's taking the first round? 🧹 |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Trash logged for Dev ✨ That's streak 1. |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | add_maintenance | ✅ |  | Tracking it: AC filter every 90 days. Tell me when it's changed and I'll reset the clock. ❄️ |
| maintenance-done | upkeep | act/hard-trigger/upkeep | maintenance_done | ✅ |  | Marked the HVAC filter as done today, nice one Dev 🙌 |
| remind-trash-tuesday | reminders | act/hard-trigger | set_reminder | ✅ |  | Done. Tuesday, Nov 3 at 8:00 PM: trash goes out, everyone 🗑️ |
| list-reminders | reminders | act/hard-trigger/reminders | list_reminders | ✅ |  | Just one coming up: "Rent is due" for everyone, Monday Nov 2 at 5:54 PM. Want me to add another, like a nudge  |
| group-report | core | act/hard-trigger/splitting | group_report | ✅ |  | 📣 Group report 💸 Dev pays Maya $20.00 💸 Sam pays Maya $20.00 🧹 No chores on the chart yet. ⏰ Nothing sched |
| members | core | act/hard-trigger | list_members | ❌ | reply lacks Dev | It's you, Maya, and Sam. Maya's the admin, and all three of you are active 👋 |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | Anytime! Salsa's still pending though: just for you, or for the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, and for what? Give me the amount and who's in on it, and I'll get it logged for yesterday. |
