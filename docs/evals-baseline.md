# Eval baseline

`npm run evals` on 2026-10-29: **64/64 (100%)**, 7.2 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $60 internet, Maya paid, split 3 ways, $20 each 💸 |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $30 uber, Sam paid, split with Dev. Dev owes Sam $15.00 🚕 |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $90 dinner, Maya paid. Maya's share is $45 for the steak, and Dev and Sam owe $22.50 each 🥩 |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $41.25 wine and cheese, Maya paid. Split 2:2:1, so Maya $16.50, Dev $16.50, Sam $8.25 🧀🍷 |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those parts add up to $55, but you paid $50. Which is off: the total, or one of the shares? Once you tell me,  |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $100 concert tickets 🎟️ Dev paid $60 and Maya paid $40, split 3 ways. Maya's share is $33.33, Dev's i |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza expense ($24.00). Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00 and all 🍕 |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle-up will link to it now 💸 |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $30.00 and Dev $30.00. Dev owes Maya $30.00, but he's owed $30.00 by Sam, so his balance is $0.0 |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $54 water bill, Maya paid, split 3 ways, $18 each 💧 |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | You owe Maya $20.00. The Venmo pay button is below 💸 Tell me once you've sent it and I'll record it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, with you as the payer. Dev's share is $78.65 because of the steak. You and  |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Maya's owed $40.00 total. Dev owes Maya $20.00, and Sam owes Maya $20.00. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Maya's owed $40.00 total: Dev owes her $20.00 and you owe her $20.00. Want the pay buttons for Maya? |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged: Dev paid Maya $20.00. You two are square now ✅ |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Lately: pizza $24.00 (Dev paid) and internet $60.00 (you paid), both split three ways, so $8.00 each for pizza |
| unknown-name | splitting | act/hard-trigger/splitting | - | ✅ |  | I don't have a Jordan in this group. It's just Dev, Maya and Sam. Did you mean one of them, or is Jordan not o |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza, Dev paid, split equally 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Anotado: Uber $30, pagó Maya, dividido en 3, $10 cada uno 🚗 |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs for you or for the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap added for the whole house, about $3.49 estimated. It's the only thing in the cart right now 🧼 |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's got Dev's stuff: 6 bananas and 1 oat milk, about $13.93 total. Want to add anything? |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off the list ✅ |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Checkout's ready: 2 items, estimated total $8.78. Tap the Instacart button to order. Once someone's paid, tell |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $84.00 groceries (4 items), Maya paid. Shares: Dev $36.00, Sam $15.43, Maya $32.57. Cart's cleared 🛒 |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken to the house cart, about $8.99. 🍗 It's the only thing in there so far. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's on the cart as a shared item, about $3.49. The cart has just that one thing so far. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (Friday, 35 min): 1.75 lb ground beef, corn tortillas, romaine, tomatoes, cheddar, sour cream, lim |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 12 items to the cart, skipping the onion. That comes to about $47.75 estimated. Say "checkout" when you' |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | They explicitly asked to add, so add to cart.Garlic Tomato Spaghetti for 3, 25 min: spaghetti, crushed tomatoe |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart link for Tacos for 5, Dev 🌮 Tap the button to open it. |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's at 12 items, est. $46.82. Dev has oat milk. The rest is the shared Tacos for 5 stuff Maya added: ground |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Noted: salt and oil are in the pantry, so I'll leave them off recipe carts from now on 🧂 |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Pantry staples: oil, rice, and salt. Tell me if that list should change. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $42 groceries, Sam paid. Maya owes $22.24 and Dev owes $19.76. Cart's cleared 🛒 |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are they for you or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes done by Dev ✨ Maya's up next. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Want me to log the dishes as done by you, Dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up for trash. Maya took it out today, and it's next due Saturday. |
| add-chore | chores | act/hard-trigger/chores | chore_add | ✅ |  | Vacuuming's on the chart, every 7 days. Rotation is Dev, then Maya, then Sam 🧹 |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Trash logged for Dev ✨ Maya's up next. |
| whose-turn-rotation | chores | act/hard-trigger/chores | chore_status | ✅ |  | Trash is Dev's turn, due Fri. Maya took it out today. |
| skip-my-turn | chores | act/hard-trigger/chores | chore_skip | ✅ |  | Skipped. Sam's up for trash tonight. Safe travels, Dev. |
| add-chore-rotation | chores | act/hard-trigger/chores | chore_add | ✅ |  | Mopping's on the chart, every 3 days: Sam, then Dev, then Maya. Sam's up first 🧽 |
| the-chart | chores | act/hard-trigger/chores | hall_of_shame | ✅ |  | Sam's the one on the chart with 0 chores this week and nothing logged yet. Dev and Maya have 1 each. Sam, the  |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | upkeep_add | ✅ |  | Tracking it: AC filter every 90 days. Tell me when it's last been changed and I'll start the clock 🧊 |
| maintenance-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Logged: HVAC filter replaced ✨ Next one's due January 26, 2027 (90 days out). |
| air-filter-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Logged: air filter changed. Next one's due Jan 26, 2027 🌬️ |
| whats-due-this-week | upkeep | act/hard-trigger | chore_status,upkeep_status | ✅ |  | Chores: Dishes are due today, and it's Dev's turn. Upkeep, all due today and never marked done: fire extinguis |
| remind-trash-tuesday | reminders | act/hard-trigger | set_reminder | ✅ |  | Done. Tue Nov 3, 8:00 PM: trash goes out, everyone. Want it to repeat every week? |
| remind-rent-monthly | reminders | act/hard-trigger/reminders | set_reminder | ✅ |  | Done, Maya. I'll message you privately on the 1st of each month at 9:00 AM to pay rent. The first one is Sun N |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | Done. I'll nudge Dev privately on Fri Oct 30, 6:00 PM to pay you back for brunch 💸 |
| weekly-report-verbatim | core | act/hard-trigger | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793237323891 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00.  |
| setup-india-household | core | act/hard-trigger | set_group_settings | ✅ |  | All set: roommates, INR, India time (Asia/Kolkata). 🏠 Splitting, groceries, chores and upkeep are all on. I a |
| list-reminders | reminders | act/hard-trigger/reminders | list_reminders | ✅ |  | Just one so far: "Rent is due" for everyone, Monday Nov 2 at 7:29 PM. Want me to add anything else? |
| group-report | core | act/hard-trigger | group_report | ✅ |  | 📋 Group report · Eval group-report 1793237365013 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00. 🛒 The Car |
| members | core | act/hard-trigger | list_members | ✅ |  | Three of us here: Dev (you), Maya (admin), and Sam. All active, nobody waiting on approval. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | Anytime! Salsa's still not in the cart though. Is it just yours or for the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, for what, and how much? I'll log it for yesterday (Tue 10/27) once I have the details. |
