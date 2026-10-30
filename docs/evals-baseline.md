# Eval baseline

`npm run evals` on 2026-10-30: **87/89 (98%)**, 8.5 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, split three ways at $20 each, so Dev and Sam each owe Maya $20. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 uber, Sam paid, split with Dev at $15 each, so Dev owes Sam $15. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $90 dinner, you paid. You're $45, Dev and Sam $22.50 each. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $41.25 wine and cheese, paid by Maya. Split 2:2:1: Maya $16.50, Dev $16.50, Sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | I can't log that one. The parts you gave don't add up to $50, and I don't have a way to log a custom split rig |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $100 concert tickets, Dev paid $60 and Maya $40. Split three ways: Maya $33.33, Dev $33.34, Sam $33.33 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza expense ($24.00). Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle-up links will use it. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes $30.00 to Dev and $30.00 to Maya. Dev owes Maya $30.00. Simplify debts is off, so it's pairwise. Net, |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $54 for the water bill, split three ways at $18 each, so Dev and Sam each owe Maya $18. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Dev owes Maya $20.00 for the internet. The Venmo button's attached, and just tell me once you've paid so I can |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, paid by you. Dev owes $78.65 (steak plus his third of the rest), and you an |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and Sam owes Maya $20.00. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Dev owes Maya $20.00 and Sam owes Maya $20.00. That's the internet. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged. Dev paid Maya $20, and you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Lately: pizza $24.00 (Dev) and internet $60.00 (Maya), both split three ways, so $8.00 each for pizza and $20. |
| unknown-name | splitting | act/hard-trigger/splitting | - | ✅ |  | I don't see a Jordan in the group, just Dev, Maya and Sam. Did you mean one of them, or is Jordan not in the c |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza, paid by Dev and split 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Listo. Uber de $30 pagado por Maya, $10 cada uno (Maya, Dev y Sam). |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs, for you or the whole house? |
| add-eggs-ambiguous-qty | groceries | act/hard-trigger/groceries | - | ✅ |  | Do you want eggs once, 12 or 18? Or two separate items, a 12 and an 18? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap for the house. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Just Dev's stuff so far: oat milk and 6 bananas. |
| cart-page-when-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Here you go. Just your oat milk in there for now. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off. Bread's still on the list. |
| removed-on-dashboard-then-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Nothing of yours right now. You took the eggs off on the dashboard a minute ago, want them back? |
| photo-list-all-common | groceries | act/hard-trigger | cart_from_photo | ✅ |  | Added eggs, milk, bread, bananas and rice as shared. |
| photo-receipt-splitting-off | groceries | act/hard-trigger | - | ❌ | reply lacks /receipt/i | I haven't learned Splitting here, so I can't split that. You're an admin, so say "roomie, learn splitting" and |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Instacart list is ready with 2 items, milk and eggs. cart's checked out. fridge says thanks |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged $84 for groceries, paid by Maya. Shares: Maya $35, Dev $35, Sam $14. Cart's cleared. |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken for the house. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap to the shared cart. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min) Need: 1.75 lb ground beef, 1 yellow onion, 3 cloves garlic, 2 tbsp chili powder |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 12 to the cart as shared, skipping the onion. |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | Garlic Tomato Spaghetti for 3, 25 min. It needs 12 oz spaghetti, olive oil, garlic, a 28 oz can of crushed tom |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart link for the Tacos for 5. |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Shared, for the tacos: taco seasoning (2 packets), ground turkey (2 lb), cotija (8 oz), limes (4), avocados (3 |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Got it, salt and oil are in the Pantry. I'll leave them off recipe lists. |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Oil, rice and salt. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. Sam paid $42 for groceries: Maya owes $21 for the chips and Dev owes $21 for the salsa. Cart's cleared |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are they both for you or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes done by Dev. Maya's up next. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Want me to log the dishes as done by you, Dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up. Maya just did it, and it's next due Sunday. |
| add-chore | chores | act/hard-trigger/chores | chore_add | ✅ |  | Vacuuming's on the chart, every 7 days. Rotation goes Dev, Maya, Sam. |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Logged: Dev took out the trash. Maya's up next. |
| whose-turn-rotation | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up for trash. Maya just did it, and it's due again Saturday. |
| skip-my-turn | chores | act/hard-trigger/chores | chore_skip | ✅ |  | Skipped. Sam's up for trash. |
| add-chore-rotation | chores | act/hard-trigger/chores | chore_add | ✅ |  | Mopping's on the chart, every 3 days. Rotation is Sam, then Dev, then Maya. |
| the-chart | chores | act/hard-trigger/chores | hall_of_shame | ✅ |  | The chart this week: Sam's at 0, while you and Maya have 1 each. Sam's got some catching up to do, but it's no |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | upkeep_add | ✅ |  | Tracking it: AC filter every 90 days. Tell me when it's changed and I'll reset the clock. |
| maintenance-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Logged, nice one Dev. The HVAC filter's good until Jan 27, 2027. |
| air-filter-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Marked the air filter as changed. The next one is due Jan 27. |
| whats-due-this-week | upkeep | act/hard-trigger | chore_status,upkeep_status | ✅ |  | Dishes are due today, and it's Dev's turn. All five upkeep items are due today too, since none has been marked |
| remind-trash-tuesday | reminders | act/hard-trigger/chores | set_reminder | ✅ |  | Reminder set for everyone: trash goes out Tue Nov 3, 8:00 PM. |
| remind-rent-monthly | reminders | act/hard-trigger/core | set_reminder | ✅ |  | Done. I'll message you privately on the 1st of every month at 9:00 AM, starting Sun Nov 1. Want a different ti |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | Done. I'll message Dev privately Friday, Oct 30 at 6:00 PM to pay you back for brunch. |
| weekly-report-verbatim | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793332998018 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00.  |
| setup-india-household | core | act/hard-trigger/core | set_group_settings | ✅ |  | Done: roommates, INR, India time. Learned Splitting, Groceries, Chores and Upkeep, and added 3 starter chores  |
| setup-trip | core | act/hard-trigger/core | set_group_settings | ✅ |  | Trip set up: EUR, Lisbon time. I learned Splitting and Groceries. Say "roomie, learn chores" any time if you w |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | Just one: "Rent is due" for everyone, Tuesday Nov 3 at 10:04 PM. |
| group-report | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval group-report 1793333062256 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00. 🛒 The Car |
| members | core | act/hard-trigger/core | list_members | ✅ |  | Dev, Maya and Sam. Maya's the admin, and all three of you are active. |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | Splitting, Groceries, Chores and Upkeep, so: "I paid 60 for internet", "add milk and eggs", "I did the dishes" |
| what-tricks-brief | core | act/hard-trigger/core | list_toolkits | ✅ |  | Groceries and Chores here: try "add milk and eggs" or "whose turn is trash?". Maya can teach me Splitting and  |
| learn-research-not-yet | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Research isn't ready yet, so I can't learn it. It's on the list, though. |
| learn-chores | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Chores are back. Try "roomie, I did the dishes." |
| forget-groceries-member | core | act/hard-trigger/core | - | ✅ |  | Only admins can make me forget a Trick, and Maya's the admin here. Ask her and she can turn Groceries off. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | Anytime. Salsa still isn't in, though. Is it just for you or for the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, what for, and how much? I'll log it once I have that, and I'll split it evenly unless you say otherw |
| vibe-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, split three ways at $20 each, so Dev and Sam each owe Maya $20. |
| vibe-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged! Maya paid $60 for internet, split three ways at $20 each 🎉 Dev and Sam owe Maya $20 apiece. |
| vibe-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each. Dev and Sam owe Maya $20. |
| name-dino-triggers | personality | act/hard-trigger/groceries | cart_add | ✅ |  | Added oat milk for you. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ❌ | reply has /devvy/i | Dev owes Maya $20.00, and you owe Maya $20.00 too, Sam. Devvy's not the only one. |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 pizza, Dev paid, $10 each. Maya and Sam owe Dev $10. |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Dev paid $30 for pizza, $10 each, so Maya and Sam each owe Dev $10. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | evening all |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | Mm, that's the spot. Quiet night, everyone's square, I've mostly been guarding the chore chart from the couch. |
| remember-vegetarian | personality | act/hard-trigger/core | remember | ✅ |  | Got it, Maya's vegetarian. I'll keep that in mind for recipes. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | Chickpea and Spinach Coconut Curry for 1, 30 min and vegetarian. You'll need: chickpeas, spinach, coconut milk |
| what-do-you-know-about-me | personality | act/hard-trigger/core | what_do_you_know_about_me | ✅ |  | You're vegan and you care about the plant. If you want that wiped, say "roomie forget me". |
| what-do-you-know-about-others | personality | act/hard-trigger/core | - | ✅ |  | I keep what I know about people between me and them, so that's Dev's to share. Dev can ask me directly, and yo |
