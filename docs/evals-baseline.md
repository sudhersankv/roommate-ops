# Eval baseline

`npm run evals` on 2026-10-30: **92/93 (99%)**, 10.2 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, split three ways at $20 each. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 uber, Sam paid, split with Dev at $15 each. Dev owes Sam $15. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $90 dinner, you paid: you $45, Dev $22.50, Sam $22.50. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $41.25 wine and cheese, paid by Maya: Maya $16.50, Dev $16.50, Sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those parts add up to more than the $50 you paid, so something's off. Can you check the numbers? I also don't  |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Concert tickets $100, Dev paid $60 and Maya $40. Split three ways: Maya $33.33, Sam $33.33, Dev $33.34 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza expense ($24.00). Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done. Your Venmo is @maya, so settle-up links will point there. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Simplify debts is off, so it's pairwise: Dev owes Maya $30, Sam owes Dev $30, and Sam owes Maya $30. You're th |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $54 water bill, paid by Maya, $18 each. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Dev owes Maya $20.00 for the internet. Venmo button's attached. Tell me once you've paid and I'll record it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt,expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, paid by Maya. Dev owes $78.65 (steak plus his third of the rest), Maya and  |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and Sam owes Maya $20.00. Maya's out $40.00 on the internet. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Dev owes Maya $20.00 and Sam owes Maya $20.00. That's the internet. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged. Dev paid Maya $20, and you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Lately: pizza $24.00 (Dev, $8.00 each) and internet $60.00 (you, $20.00 each). |
| unknown-name | splitting | act/hard-trigger/splitting | list_members | ✅ |  | Jordan isn't in the group, so I can't log that. Did you mean Dev or Sam? If Jordan should be in here, they'll  |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza, paid by Dev, split 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Anotado. Uber $30 que pagó Maya, $10 cada uno (Maya, Dev y Sam). |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs for you or the whole house? |
| add-eggs-ambiguous-qty | groceries | act/hard-trigger/groceries | - | ✅ |  | Do you want a 12-pack or an 18-pack of eggs for the house? Or both? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap for the house. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Just Dev's stuff: oat milk and 6 bananas. |
| cart-page-when-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Here you go. Right now it's just your oat milk. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off. Bread's still on the list. |
| removed-on-dashboard-then-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Nothing in the cart right now. You took the eggs off on the dashboard a minute ago, want them back? |
| photo-list-all-common | groceries | act/hard-trigger | cart_from_photo | ✅ |  | Added eggs, milk, bread, bananas and rice, all shared. |
| photo-receipt-splitting-off | groceries | act/hard-trigger | - | ✅ |  | I haven't learned Splitting here, so I can't split that. You forgot it just now, but as an admin you can bring |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Checkout's ready with 2 items, milk and eggs. Tell me the total once you've paid and I'll split it. order's in |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $84 groceries, paid by Maya. Maya's share is $35, Dev owes $35 and Sam owes $14. Cart's cleared. |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken for the house. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap to the shared cart. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ❌ | a Recipe for 5 planned on a Friday and an empty Cart, got 5 null | Tacos for 5 (serves 5, 35 min) Need: 1.75 lb ground beef, 1 yellow onion, 1/2 head garlic, 3 tbsp chili powder |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 13 items as shared and left out the onion. |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | Garlic Tomato Spaghetti for 3, 25 min: spaghetti, crushed tomatoes, garlic, basil and parmesan, with olive oil |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart link for the tacos, Dev. |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Twelve items. Dev's oat milk, plus the shared taco stuff: taco seasoning (2 packets), salt, 4 limes, vegetable |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Got it, salt and oil are in the pantry. I'll leave them off recipe lists. |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Oil, rice and salt. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. Sam paid $42 for groceries: Maya owes $21 (chips) and Dev owes $21 (salsa). Cart's cleared. |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are they both for you or the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes done by Dev. Maya's up next. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Want me to log the dishes as done by you, Dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up. Maya just did it, and it's next due Monday. |
| add-chore | chores | act/hard-trigger/chores | chore_add | ✅ |  | Vacuuming's on the chart, every 7 days. Rotation is Dev, then Maya, then Sam. |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Logged, Dev took out the trash. Maya's up next. |
| whose-turn-rotation | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up for trash. Maya just did it, and it's due again Sunday. |
| skip-my-turn | chores | act/hard-trigger/chores | chore_skip | ✅ |  | Skipped. Trash goes to Sam next. |
| add-chore-rotation | chores | act/hard-trigger/chores | chore_add | ✅ |  | Mopping's on the chart, every 3 days. Rotation is Sam, then Dev, then Maya, so Sam's up first. |
| the-chart | chores | act/hard-trigger/chores | hall_of_shame | ✅ |  | The chart this week: Sam 0, Dev 1, Maya 1. Sam's the only one with nothing logged yet, but it's early. |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | upkeep_add | ✅ |  | Tracking it: AC filter every 90 days. Tell me when it's changed and I'll reset the clock. |
| maintenance-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Marked done. Next HVAC filter change is due Jan 28, 2027. |
| air-filter-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Air filter's done. Next one's due Jan 28. |
| whats-due-this-week | upkeep | act/hard-trigger | chore_status,upkeep_status | ✅ |  | Dishes are due today, and it's Dev's turn. All five upkeep items are due today since none have been marked don |
| remind-trash-tuesday | reminders | act/hard-trigger/chores | set_reminder | ✅ |  | Reminder set. I'll tell everyone in the chat on Tue Nov 3 at 8:00 PM that the trash goes out. |
| remind-rent-monthly | reminders | act/hard-trigger/core | set_reminder | ✅ |  | Done. I'll message you privately on the 1st of every month at 9:00 AM to pay rent, starting Sun Nov 1. I picke |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | Done. I'll nudge Dev privately today (Fri Oct 30) at 6:00 PM to pay you back for brunch. |
| weekly-report-verbatim | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793355033668 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00.  |
| setup-india-household | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Splitting, Groceries, Chores and Upkeep. Say "roomie, what can you do?" any time. I also added 3 start |
| setup-trip | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Splitting and Groceries. Say "roomie, learn chores" any time. Everyone: your dashboard is at https://r |
| setup-from-dm | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Splitting, Groceries, Chores and Upkeep. Say "roomie, what can you do?" any time. Everyone: your dashb |
| dashboard-for-everyone | core | act/hard-trigger/core | get_dashboard_link | ✅ |  | Everyone: your dashboard is at https://roomie.fly.dev/j/j7eq7nyjfg. Sign in with Google and pick your name. |
| rotate-join-link-admin | core | act/hard-trigger/core | rotate_join_link | ✅ |  | New Join link: https://roomie.fly.dev/j/lvlyrp7t5g. The old one doesn't work anymore. |
| rotate-join-link-member-refused | core | act/hard-trigger/core | - | ✅ |  | Rotating the join link is admin-only, and Maya's the admin here. She can ask me and I'll do it. |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | Just one: "Rent is due" for everyone, Wed Nov 4 at 4:12 AM. |
| group-report | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval group-report 1793355143233 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00. 🛒 The Car |
| members | core | act/hard-trigger/core | list_members | ✅ |  | Dev, Maya and Sam. Maya's the admin, and all three of you are active. |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | Splitting, Groceries, Chores and Upkeep are all covered. Try "I paid 60 for internet," "add milk and eggs," "w |
| what-tricks-brief | core | act/hard-trigger/core | list_toolkits | ✅ |  | Groceries and Chores here, like "add milk and eggs" or "whose turn is trash?". Maya can add Splitting and Upke |
| learn-research-not-yet | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Research isn't something I can learn yet. It's on the list, though. |
| learn-chores | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Chores are back. Try "roomie, I did the dishes". |
| forget-groceries-member | core | act/hard-trigger/core | - | ✅ |  | Only admins can make me forget a Trick, and that's Maya here. Ask her and she can turn Groceries off. Nothing  |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger/groceries | - | ✅ |  | Anytime. Salsa's still not on the list, though. Is it for you or the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, and for what? If you give me the amount and who was in on it, I can log it. |
| vibe-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each for Maya, Dev and Sam. |
| vibe-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged! Maya paid $60 for internet, split three ways at $20 each 🎉 Dev and Sam each owe Maya $20. |
| vibe-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, split three ways: $20 each. |
| name-dino-triggers | personality | act/hard-trigger/groceries | cart_add | ✅ |  | Added oat milk for you. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and you owe Maya $20.00 too, Sam. Maya's up $40.00 from the internet. |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 pizza paid by Dev, $10 each. Maya and Sam owe Dev $10. |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Dev paid $30 for pizza, $10 each. Maya and Sam each owe Dev $10. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | morning. coffee first |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | Mmm, that's the spot. Everyone's square right now, so it's been a very quiet day on the couch. |
| remember-vegetarian | personality | act/hard-trigger/core | remember | ✅ |  | Got it, Maya's vegetarian. I'll keep that in mind for recipes. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | Chickpea Spinach Coconut Curry for 1, vegetarian, 25 min. Need: olive oil, 1/2 yellow onion, 2 cloves garlic,  |
| what-do-you-know-about-me | personality | act/hard-trigger/core | what_do_you_know_about_me | ✅ |  | You're vegan and you care about the plant. If you want that wiped, say "roomie forget me". |
| what-do-you-know-about-others | personality | act/hard-trigger/core | - | ✅ |  | That's Dev's to share, so I can't pass it along. Maya's an admin, so she can ask if she needs to. I can tell y |
