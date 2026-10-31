# Eval baseline

`npm run evals` on 2026-10-31: **94/98 (96%)**, 8.8 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each for Maya, Dev and Sam. Not everyone in? Say who. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 uber, Sam paid, split with Dev: $15 each, so Dev owes Sam $15. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $90 dinner, you paid: you $45, Dev $22.50, Sam $22.50. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $41.25 wine and cheese, paid by Maya, split 2:2:1: Maya $16.50, Dev $16.50, Sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those add up to $55, not $50 (30 + 15 + 10). Is the total $55, or should one of the parts change? |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $100 concert tickets, Dev paid $60 and Maya $40, split three ways: Maya $33.33, Dev $33.34, Sam $33.33 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza ($24.00). Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle-up links will point there now. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam, you owe Dev $30 and Maya $30. Dev owes Maya $30. With simplify debts off it's pairwise, so Dev nets out t |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $54 for the water bill, split three ways at $18 each. Not everyone in? Say who. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Dev, you owe Maya $20.00. The Venmo button is attached. Tell me once you've paid and I'll record it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt,expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, paid by Maya. Dev's steak put him at $78.65, and you and Sam are $29.66 eac |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and Sam owes Maya $20.00. Maya's the one who's owed, since she covered the internet. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Dev owes Maya $20.00 and you owe Maya $20.00. That's the internet. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged. Dev paid Maya $20, and you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Two so far, both today: pizza $24.00 (Dev, $8.00 each) and internet $60.00 (you, $20.00 each). |
| unknown-name | splitting | act/hard-trigger/splitting | - | ✅ |  | I don't have a Jordan in the group, just Dev, Maya and Sam. Did you mean one of them, or is Jordan not on here |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza paid by you, split evenly three ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Anotado: uber $30, pagó Maya, $10 cada uno (Maya, Dev y Sam). ¿No fueron todos? Dime quiénes. |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs: for you or the whole house? |
| add-eggs-ambiguous-qty | groceries | act/hard-trigger/groceries | - | ✅ |  | Do you want one carton of 12 eggs or one of 18? Or both? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap for the house. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Just Dev's stuff right now: 6 bananas and an oat milk. |
| cart-page-when-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Here you go. Right now it's just your oat milk. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off. Bread's still on. |
| removed-on-dashboard-then-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Nothing of yours right now. You took the eggs off on the dashboard a minute ago, want them back? |
| photo-list-all-common | groceries | act/hard-trigger/splitting | expense_from_receipt,expense_from_receipt,expense_from_receipt | ❌ | no cart_from_photo; reply has /\$\d/; doesn't ask / alt: no cart_from_photo; reply has /\$\d/; the list's items, shared | Logged Luigi's Trattoria, $137.97 with tax and tip, paid by you. It's split three ways at $45.99 each, so Dev  |
| photo-receipt-money-off | groceries | act/hard-trigger | - | ✅ |  | Splitting is Money, and I've forgotten that one here. Since you're an admin, say "roomie, learn money" and I'l |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Checkout's ready: 2 items on the list (milk and eggs). Instacart button's attached. cart's checked out. fridge |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. Maya paid $84 for groceries: Maya's part is $35, Dev's is $35, Sam's is $14. The cart is cleared. |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken, shared. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap to the shared cart. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min) Need: 1.5 lb ground beef, 1 yellow onion, 1/2 head garlic, 3 tbsp chili powder, |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 12 to the cart as shared, no onions. |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | Garlic Tomato Spaghetti for 3, 25 min: spaghetti, olive oil, garlic, crushed tomatoes, red pepper flakes, salt |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart page for Tacos for 5. |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Twelve items. Shared, for the Tacos for 5: salt (1 tsp), salsa verde (1 package), red onion (1), cotija cheese |
| pantry-set | groceries | - | - | ❌ | error: Failed query: select "id", "group_id", "account_id", "channel_user_id", "display_name", "role", "status", "joined |  |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Oil, rice and salt. Maya just added those. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. Sam paid $42 for groceries: Maya owes $21, Dev owes $21 (chips and salsa, one each). Cart's cleared. |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are they for you or the whole house? |
| did-dishes | house | act/hard-trigger/house | log_chore | ✅ |  | Dishes done by Dev. Maya's up next. |
| did-dishes-unprompted-asks | house | act/jev-act/house | - | ✅ |  | Want me to log the dishes as done by you, Dev? |
| whose-turn | house | act/hard-trigger/house | chore_status | ✅ |  | Dev's up. Maya just did it today, and it's next due Monday. |
| add-chore | house | act/hard-trigger/house | chore_add | ✅ |  | Vacuuming's on the chart, every 7 days. Rotation is Dev, then Maya, then Sam. |
| chore-for-someone-else | house | act/hard-trigger/house | log_chore | ✅ |  | Logged, Dev took out the trash. Maya's up next. |
| whose-turn-rotation | house | act/hard-trigger/house | chore_status | ✅ |  | Dev's up for trash. Maya just did it, and it's due again Sunday. |
| skip-my-turn | house | act/hard-trigger/house | chore_skip | ✅ |  | Skipped. Trash goes to Sam now. |
| add-chore-rotation | house | act/hard-trigger/house | chore_add | ✅ |  | Mopping's on the chart, every 3 days: Sam, then Dev, then Maya. Sam's up first. |
| the-chart | house | act/hard-trigger/house | hall_of_shame | ✅ |  | The chart this week: Sam's at 0, Dev and Maya have 1 each. Sam's got a clear runway to get on the board. |
| track-ac-filter | house | act/hard-trigger/house | upkeep_add | ✅ |  | Tracking it. The AC filter gets changed every 90 days. Tell me when it's done and I'll start the clock. |
| maintenance-done | house | act/hard-trigger/house | upkeep_done | ✅ |  | Marked it done. The HVAC filter is next due January 28, 2027, which is 90 days from now. |
| air-filter-done | house | act/hard-trigger/house | upkeep_done | ✅ |  | Air filter's done. Next one's due Jan 28, 2027. |
| whats-due-this-week | house | act/hard-trigger | chore_status,upkeep_status | ✅ |  | Dishes are due today, and it's Dev's turn. All five house-care items are also due since nothing's been marked  |
| remind-trash-tuesday | reminders | act/hard-trigger/house | set_reminder | ✅ |  | Reminder's set: I'll tell the whole chat "Trash goes out" on Tue Nov 3 at 8:00 PM. |
| remind-rent-monthly | reminders | act/hard-trigger/core | set_reminder | ✅ |  | Done. I'll message you privately on the 1st of every month at 9:00 AM, starting Sun Nov 1, to pay rent. You di |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | Done. I'll message Dev privately Friday, Nov 6 at 6:00 PM to pay you back for brunch. |
| weekly-report-verbatim | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793411733041 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00.  |
| setup-india-household | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Money, Groceries and House. Say "roomie, what can you do?" any time. Everyone: your dashboard is at ht |
| setup-trip | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Money and Groceries. Say "roomie, learn house" any time. Everyone: your dashboard is at https://roomie |
| setup-from-dm | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Money, Groceries and House. Say "roomie, what can you do?" any time. I posted the dashboard link in th |
| dashboard-for-everyone | core | act/hard-trigger/core | get_dashboard_link | ✅ |  | Everyone: your dashboard is at https://roomie.fly.dev/j/q4qqvozsgm. Sign in with Google and pick your name. |
| rotate-join-link-admin | core | act/hard-trigger/core | rotate_join_link | ✅ |  | New Join link: https://roomie.fly.dev/j/rmqm66jtgm. The old one doesn't work anymore. |
| rotate-join-link-member-refused | core | act/hard-trigger/core | - | ✅ |  | Rotating the join link is admin-only, and Maya's the admin here. She can do it, or promote you if you want to  |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | Just one: "Rent is due" for everyone, Wed Nov 4 at 7:57 PM. |
| group-report | core | act/hard-trigger | group_report | ✅ |  | 📋 Group report · Eval group-report 1793411838350 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00. 🛒 The Car |
| members | core | act/hard-trigger/core | list_members | ❌ | reply lacks Dev | It's you, Maya, and Sam. Maya's the admin, and all three of you are active. |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | Money, Groceries and House are all covered here. Try "I paid 60 for internet", "add milk and eggs", or "I did  |
| what-tricks-brief | core | act/hard-trigger/core | list_toolkits | ✅ |  | Money and Groceries here: logging and splitting costs, a shared Cart, recipes. House (chore chart) is somethin |
| learn-outings-not-yet | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Can't learn Outings yet, it's still on the list. Nobody can teach me that one for now. |
| learn-house | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Learned House again. Try "roomie, I did the dishes". |
| forget-groceries-member | core | act/hard-trigger/core | - | ✅ |  | Only admins can make me forget a Trick, and Maya's the admin here. Ask her and she can turn Groceries off. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger/groceries | - | ✅ |  | No problem. Still need to know on the salsa though: just for you, or the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | list_expenses | ✅ |  | Nothing's logged from yesterday. Who paid, and how much was it for? I can add it once I know. |
| one-voice-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each for Maya, Dev and Sam. Not everyone in? Say who. |
| one-voice-ignores-stored-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each for Maya, Dev and Sam. Not everyone in? Say who. |
| one-voice-ignores-stored-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each for Maya, Dev and Sam. Not everyone in? Say who. |
| name-dino-is-not-a-trigger | personality | act/jev-act/groceries | cart_add | ✅ |  | Added oat milk for you. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ❌ | reply has /devvy/i | Dev owes Maya $20.00, and you owe Maya $20.00 too, Sam. Devvy isn't the only one. |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 pizza, Dev paid, $10 each for Dev, Maya and Sam. Not everyone in? Say who. |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 pizza, Dev paid, $10 each. Not everyone in? Say who. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | evening all |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | Mmm, that's nice. Friday night, everyone's square, nothing's overdue that I know of. Good day to be the one ke |
| remember-vegetarian | personality | act/hard-trigger/core | remember | ✅ |  | Got it, you're vegetarian. I'll keep that in mind for recipes. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | Chickpea and Spinach Coconut Curry for 1, vegetarian, 30 min. Need: 1 can chickpeas, 2 cups baby spinach, 1/2  |
| what-do-you-know-about-me | personality | act/hard-trigger/core | what_do_you_know_about_me | ✅ |  | You're vegan and you care about the plant. That's all I've got. "Roomie forget me" wipes it if you ever want t |
| what-do-you-know-about-others | personality | act/hard-trigger/core | - | ✅ |  | I can't share what I know about other people. Only admins can ask for that, and Maya's the admin here. Dev can |
| pizza-no-poll | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for pizza, $20 each for Maya, Dev and Sam. Not everyone in? Say who. |
| pizza-not-sure-who-polls | splitting | act/hard-trigger/splitting | ask_poll | ✅ |  | Poll's up, tap who was in. I'll log the pizza once it's settled. |
| dm-paid-maya | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged, you paid Maya $20.00. You two are square now. |
| dm-pizza-echoes | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Dev paid $40 for pizza, split three ways: Maya and Sam $13.33 each, Dev $13.34. Not everyone in? Say w |
| stop-nudging-me | core | act/hard-trigger/core | set_nudges | ✅ |  | Done, no more nudges. Reminders you set will still come through. |
