# Eval baseline

`npm run evals` on 2026-10-29: **66/67 (99%)**, 7.1 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $60 internet, Maya paid, split 3 ways, $20 each 💸 |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $30 uber, Sam paid, split with Dev. Dev owes Sam $15.00 🚕 |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $90 dinner, Maya paid. Maya's share is $45.00 (steak 🥩), Dev and Sam owe $22.50 each. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $41.25 wine and cheese, Maya paid, split 2:2:1. Maya and Dev owe $16.50 each, Sam $8.25 🍷🧀 |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those add up to $55, not $50 (Dev 30 + Sam 15 + you 10). Which is off: the total or someone's share? |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $100 concert tickets 🎟️ Dev paid $60, Maya paid $40, split 3 ways. Maya's share is $33.33, Dev's is $ |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza expense ($24.00). Say "undo" if you want it back. 🍕 |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00, all as it was 🍕 |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle-up links will point there now 💸 |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam, you owe $30.00 to Maya and $30.00 to Dev. Dev owes Maya $30.00. Dev nets out to $0 overall, and Maya is o |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. Want the pay buttons? |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $54 water bill, Maya paid, split 3 ways, $18 each 💧 |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | You owe Maya $20.00. The Venmo pay button is below. Tell me once you've paid and I'll record it 💸 |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, you paid. Dev owes $78.65 (steak plus his share of the rest, with tax and t |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and Sam owes Maya $20.00 too. Maya's up $40.00 overall. Want the pay buttons for Maya? |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Maya's owed $40.00 total: Dev owes her $20.00 and you owe her $20.00. Want the pay buttons, Sam? |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged: Dev paid Maya $20. You two are square now ✅ |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Lately: pizza $24 (Dev paid) and internet $60 (you paid), both split 3 ways. That's $8 each for the pizza and  |
| unknown-name | splitting | act/hard-trigger/splitting | - | ✅ |  | I don't see a Jordan in this group (just Dev, Maya and Sam). Did you mean one of them, or does Jordan still ne |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza, Dev paid, split 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Listo: Uber $30, pagó Maya, entre 3 a $10 cada uno 🚕 |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs for just you, or for the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's in the cart as a shared item, about $3.49 estimated. 🧼 |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's got 2 items, both Dev's: 6 bananas and 1 oat milk. Estimated total is $13.93 🛒 |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off the list ✅ |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Instacart list is ready: 2 items, about $8.78 estimated. Tap the button to order. Once someone pays, tell me t |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $84.00 groceries (4 items), Maya paid. Split by what each person added: Dev owes $36.00, Sam owes $15. |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken to the house cart, est. $8.99 🍗 |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's in the cart as a shared item, about $3.49 🧼 It's the only thing in there so far. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min) Need: 1.5 lb ground beef, 1 yellow onion, 1 head garlic, 2 tbsp chili powder, 2 |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 12 items to the shared cart, about $47.75 total. I left out the onions. Want me to order it through Inst |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | They asked to add to cart explicitly.Garlic Tomato Spaghetti for 3 is up. It takes 25 min, and the full steps  |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart page for Tacos for 5, Dev. The button's attached 🌮 |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's at 12 items, est. $46.82. Dev has oat milk, and the other 11 are shared taco stuff from Maya's Tacos fo |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Got it, salt and oil are in the pantry now. I'll leave them off any recipe shopping lists. 🧂 |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Pantry staples: oil, rice and salt. Tell me if anything should be added or taken off. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $42 groceries, Sam paid. Maya owes $22.24 and Dev owes $19.76, and the cart is cleared 🛒 |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are those both just for you, or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes done by Dev ✨ Maya's up next. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Want me to log the dishes as done by you, Dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up. Maya did it today, so it isn't due until Sunday. |
| add-chore | chores | act/hard-trigger/chores | chore_add | ✅ |  | Added vacuuming to the chart, every 7 days. Rotation is Dev, then Maya, then Sam 🧹 |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Trash is done by Dev ✨ Maya, you're up next. |
| whose-turn-rotation | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up on trash. Maya just did it today, and it's next due Saturday. |
| skip-my-turn | chores | act/hard-trigger/chores | chore_skip | ✅ |  | Done, skipped your turn on trash. Sam's up next. Enjoy the trip 👋 |
| add-chore-rotation | chores | act/hard-trigger/chores | chore_add | ✅ |  | Mopping's on the chart: every 3 days, Sam → Dev → Maya. Sam's up first 🧽 |
| the-chart | chores | act/hard-trigger/chores | hall_of_shame | ✅ |  | Sam's at the bottom with 0 chores this week, while you and Maya have 1 each. The chart has spoken 👀 Nothing p |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | upkeep_add | ✅ |  | Tracking it: AC filter, every 90 days. Tell me when it's changed and I'll reset the clock 🛠️ |
| maintenance-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Nice, HVAC filter marked done. Next one's due Jan 27, 2027 🧼 |
| air-filter-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Air filter marked done ✅ Next one's due Jan 27, 2027 (every 90 days). |
| whats-due-this-week | upkeep | act/hard-trigger | chore_status,upkeep_status | ✅ |  | Dishes are due today, and it's Dev's turn. 🍽️ On upkeep, all five items are due and have never been marked do |
| remind-trash-tuesday | reminders | act/hard-trigger/chores | set_reminder | ✅ |  | Done. Tue Nov 3, 8:00 PM: trash goes out, everyone 🗑️ |
| remind-rent-monthly | reminders | act/hard-trigger/core | set_reminder | ✅ |  | Done, Maya. I'll DM you "Pay rent" on the 1st of every month at 9:00 AM. The first one is Sun Nov 1. 🏠 |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | Done. I'll ping Dev privately on Fri Oct 30 at 6:00 PM to pay you back for brunch. |
| weekly-report-verbatim | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793250154243 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00.  |
| setup-india-household | core | act/hard-trigger/core | set_group_settings | ✅ |  | All set: roommates, INR, India time. Splitting, Groceries, Chores and Upkeep are on, with 3 starter chores and |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | Just one coming up: "Rent is due" for everyone, Mon Nov 2 at 11:03 PM. Want me to move it or add another? |
| group-report | core | act/hard-trigger | group_report | ✅ |  | 📋 Group report · Eval group-report 1793250188804 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00. 🛒 The Car |
| members | core | act/hard-trigger/core | list_members | ❌ | reply lacks Dev | Three of us: you, Maya (admin), and Sam. All active ✅ |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | Here's what I've got on: splitting costs ("I paid 60 for internet"), groceries ("tacos for 5 friday", "add mil |
| turn-on-research | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Research isn't ready yet, Maya. It's on the list, but I can't switch it on for now. Splitting, groceries, chor |
| groceries-off-member | core | act/hard-trigger/groceries | - | ✅ |  | Only admins can switch Toolkits, and that's Maya in this group. Maya, want me to turn Groceries off? Just say  |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | Anytime! Salsa still isn't in the cart, though. Is it for you or the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, for what, and how much? I'll log it once I have those, and I'll split it evenly three ways unless yo |
