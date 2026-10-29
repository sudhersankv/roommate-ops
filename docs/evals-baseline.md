# Eval baseline

`npm run evals` on 2026-10-29: **56/57 (98%)**, 6.8 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $60 internet, Maya paid, split 3 ways, $20 each 💸 |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $30 uber, Sam paid, split with Dev. Dev owes Sam $15.00 🚗 |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $90 dinner, Maya paid. Maya's share is $45 for the steak, and Dev and Sam owe $22.50 each 🥩 |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $41.25 wine and cheese, Maya paid, split 2:2:1. Maya and Dev owe $16.50 each, Sam owes $8.25 🍷 |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | cart_view | ✅ |  | Those parts add up to $55, not $50, so something's off. Also, the grocery cart is empty, and I can only split  |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $100 concert tickets, Dev paid $60 and Maya $40, split 3 ways. Maya and Sam owe $33.33 each, Dev owes  |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza expense ($24.00). Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00, all as it was 🍕 |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle-up links will point there now 💸 |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam, you're at -$60.00 and Maya's owed $60.00. Dev nets out at $0.00. The pairwise breakdown is Sam owes Dev $ |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. Want the pay buttons? |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $54 water bill, Maya paid, split 3 ways, $18 each 💧 |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | You owe Maya $20.00. The Venmo pay button is below 💸 Tell me once you've sent it and I'll record it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, you paid. Dev's share is $78.65 (steak plus a third of the rest), and you a |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Maya's owed $40.00. You owe her $20.00, and Sam owes her $20.00 too. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Sam and Dev each owe Maya $20.00. Maya is up $40.00 overall. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged: Dev paid Maya $20. You two are square now ✅ |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Just two so far: internet $60 (you, split 3 ways) and pizza $24 (Dev, $8 each), both yesterday. Want the balan |
| unknown-name | splitting | act/hard-trigger/splitting | - | ✅ |  | Jordan isn't in this group (it's just Dev, Maya and Sam). Did you mean one of them, or does Jordan need to joi |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 for pizza, Dev paid, split 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Anotado: Uber $30, pagó Maya, dividido en 3, $10 cada uno 🚗 |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs for you or for the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's in the cart as a shared item, about $3.49 estimated. Anything else for the house? |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's got Dev's oat milk and 6 bananas, estimated total $13.93. Want me to add anything, or is it checkout ti |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off the list ✅ |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Your Instacart list is ready: 2 items, about $8.78 estimated. Tap the button to order. Once someone's bought i |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $84 groceries (4 items), Maya paid. Shares: Maya $32.57, Dev $36.00, Sam $15.43. Cart's cleared 🛒 |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken for the house, about $8.99 est. It's the only thing in the cart so far 🍗 |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's on the cart as a shared item, about $3.49. Want anything else on it before checkout? |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min), set for Friday. Need: 1.75 lb ground beef, 1 yellow onion, 1/2 head garlic, 3  |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 12 items to the shared cart, about $46.54 total, and I left the onion out. Say the word when you want to |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | They explicitly asked to add, so add.Garlic Tomato Spaghetti for 3, 25 min: spaghetti, crushed tomatoes, garli |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here you go, Dev: the Instacart page for Tacos for 5 is attached 🌮 |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart has 12 items, est. $46.82. Dev has oat milk, and the other 11 are shared taco ingredients Maya added (tor |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Noted: salt and oil are pantry staples now, so I'll leave them off recipe carts. 🧂 |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Pantry staples: oil, rice, and salt. Tell me if anything should be added or taken off. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $42 groceries, Sam paid. Maya's part is $22.24 and Dev's is $19.76 💸 |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, 2 bags of chips. Are the salsa and chips just for you or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes logged for Dev ✨ That's streak 1, so keep it going. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Want me to log dishes as done by Dev? 🧽 |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up. Maya just took it out today, so the next one isn't due until Sunday night 🗑️ |
| add-chore | chores | act/hard-trigger/chores | add_chore | ✅ |  | Vacuuming is on the chart, every 7 days 🧹 |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Trash logged for Dev ✨ Nice, that's a streak of 1. |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | add_maintenance | ✅ |  | Tracking it: AC filter, every 90 days. Tell me when it's changed and I'll reset the clock ❄️ |
| maintenance-done | upkeep | act/hard-trigger/upkeep | maintenance_done | ✅ |  | Marked done: HVAC filter replaced today, thanks Dev 🙌 |
| remind-trash-tuesday | reminders | act/hard-trigger/chores | set_reminder | ✅ |  | Done. Tuesday Nov 3, 8:00 PM: trash goes out, everyone. 🗑️ |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | Just one: "Rent is due" for everyone, Monday Nov 2 at 10:45 PM. Want me to add or change any? |
| group-report | core | act/hard-trigger/core | group_report | ✅ |  | 📣 Group report 💸 Dev pays Maya $20.00 💸 Sam pays Maya $20.00 🧹 No chores on the chart yet. ⏰ Nothing sched |
| members | core | act/hard-trigger/core | list_members | ❌ | reply lacks Dev | It's you, Maya, and Sam. Maya's the admin, and all three of you are active. |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | Here's what I've got on: splitting costs ("I paid 60 for internet", "who owes what?"), groceries ("tacos for 5 |
| turn-on-research | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Research isn't ready yet, Maya. It's on the list, but I can't switch it on for now. Splitting, Groceries, Chor |
| groceries-off-member | core | act/hard-trigger/groceries | - | ✅ |  | Only admins can switch Toolkits, and Maya's the admin here. Maya, want me to turn Groceries off? |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | Anytime! Salsa still isn't on the list though. Is it just for you or for the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, and how much for what? Once I have the details I can log it, split evenly between Dev, Maya and Sam  |
