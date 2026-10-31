# Eval baseline

`npm run evals` on 2026-10-31: **110/112 (98%)**, 9.3 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each for Maya, Dev and Sam. Not everyone in? Say who. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 uber, Sam paid, split with Dev: $15 each, so Dev owes Sam $15. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $90 dinner, you paid. Your share is $45, Dev and Sam owe $22.50 each. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $41.25 wine and cheese, paid by Maya: Maya $16.50, Dev $16.50, Sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those parts don't add up to $50. Can you recheck the split? Also, I don't have a way to log expenses from this |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $100 concert tickets, Dev paid $60 and Maya $40, split three ways: Maya $33.33, Dev $33.34, Sam $33.33 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza ($24.00). Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Venmo's set to @maya. Settle up will link to it now. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Dev $30 and Maya $30. Dev owes Maya $30. With simplify off it's pairwise, so Dev's balance nets to $0 |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $54 for the water bill, $18 each for Maya, Dev and Sam. Not everyone in? Say who. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Dev owes Maya $20.00. Venmo button's attached; tell me once you've paid and I'll record it. |
| receipt-photo | splitting | act/hard-trigger | expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, you paid. Dev owes $78.65 (steak plus his part of the shared stuff), you an |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and Sam owes Maya $20.00. Maya's up $40.00 from the internet. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Dev owes Maya $20.00 and Sam owes Maya $20.00. Maya's up $40.00 from the internet. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged. Dev paid Maya $20, and you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Just two so far: pizza $24 (Dev) and internet $60 (Maya), both split three ways, $8 and $20 each. |
| unknown-name | splitting | act/hard-trigger/splitting | - | ✅ |  | Jordan isn't in the group, at least not as an active member. Did you mean Dev or Sam? If Jordan's new, an admi |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza, paid by Dev, split 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Anotado. Uber $30 pagado por Maya, $10 cada uno. ¿No estaban todos? Dime quién iba y lo cambio. |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs for you or the whole house? |
| add-eggs-ambiguous-qty | groceries | act/hard-trigger/groceries | - | ✅ |  | Do you want a 12-pack of eggs, an 18-pack, or both? I'll add them as shared once you say. |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap as shared. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Just Dev's stuff so far: oat milk and 6 bananas. |
| cart-page-when-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Here you go. Only your oat milk is in there right now. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off. Bread's still on the list. |
| removed-on-dashboard-then-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Nothing in the cart right now. You took the eggs off on the dashboard. Want them back? |
| photo-list-all-common | groceries | act/hard-trigger | cart_from_photo | ✅ |  | Added eggs, milk, bread, bananas and rice to the cart as shared. |
| photo-receipt-money-off | groceries | act/hard-trigger | - | ✅ |  | I can't split things right now since Money isn't learned here. You're an admin, so "roomie, learn money" will  |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Instacart list is ready with 2 items, milk and eggs. order's in. nice |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. Maya paid $84 for groceries: Maya's part is $35, Dev's $35, Sam's $14. Cart's cleared. |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken as shared. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap as shared. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min) Need: 1.5 lb ground beef, 1 yellow onion, 3 cloves garlic, 2 tbsp chili powder, |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 12 items to the cart as shared. Skipped the onion since you have it. |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | Garlic Tomato Spaghetti for 3, 25 min. Need spaghetti, olive oil, garlic, crushed tomatoes, red pepper flakes, |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart page for the tacos. |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Shared (for the tacos): limes (4), vegetable oil (1 tbsp), corn tortillas (20), cotija cheese (8 oz), avocados |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Got it, salt and oil are in the Pantry. I'll leave them off the list. |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Pantry's got oil, rice and salt. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: Sam paid $42 for groceries. Maya owes $21 for the chips and Dev owes $21 for the salsa. The cart's cle |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are those for you or the whole house? |
| did-dishes | house | act/hard-trigger/house | log_chore | ✅ |  | Dishes done by Dev. Maya's up next. |
| did-dishes-unprompted-asks | house | act/jev-act/house | - | ✅ |  | Want me to log the dishes as done by you, Dev? |
| whose-turn | house | act/hard-trigger/house | chore_status | ✅ |  | Dev's up. Maya just did it, and it's next due Tuesday. |
| add-chore | house | act/hard-trigger/house | chore_add | ✅ |  | Vacuuming's on the chart, every 7 days. Rotation is Dev, then Maya, then Sam. |
| chore-for-someone-else | house | act/hard-trigger/house | log_chore | ✅ |  | Logged: Dev took out the trash. Maya's up next. |
| whose-turn-rotation | house | act/hard-trigger/house | chore_status | ✅ |  | Dev's up for trash. Maya just did it, and it's due again Monday. |
| skip-my-turn | house | act/hard-trigger/house | chore_skip | ✅ |  | Skipped. Sam's up for trash. |
| add-chore-rotation | house | act/hard-trigger/house | chore_add | ✅ |  | Mopping's on the chart, every 3 days. Rotation is Sam, then Dev, then Maya, so Sam's up first. |
| the-chart | house | act/hard-trigger/house | hall_of_shame | ✅ |  | The chart this week: Sam 0, Dev 1, Maya 1. Sam's the only one who hasn't done anything yet. |
| track-ac-filter | house | act/hard-trigger/house | upkeep_add | ✅ |  | Tracking it: Change AC filter, every 90 days. Tell me when it's done and I'll reset the clock. |
| maintenance-done | house | act/hard-trigger/house | upkeep_done | ✅ |  | Filter's marked done. Next one's due Jan 29, 2027. |
| air-filter-done | house | act/hard-trigger/house | upkeep_done | ✅ |  | Air filter's done. The next one is due Jan 29. |
| whats-due-this-week | house | act/hard-trigger | chore_status,upkeep_status | ✅ |  | Dishes are due today, and it's Dev's turn. All five house care items are also due today, since none have been  |
| remind-trash-tuesday | reminders | act/hard-trigger/house | set_reminder | ✅ |  | Done. I'll remind everyone in the chat that trash goes out on Tue Nov 3 at 8:00 PM. |
| remind-rent-monthly | reminders | act/hard-trigger/core | set_reminder | ✅ |  | Done. I'll DM you "Pay rent" on the 1st of every month at 9 AM, starting tomorrow (Sun Nov 1). |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | Done. I'll DM Dev on Fri Nov 6 at 6:00 PM to pay you back for brunch. |
| weekly-report-verbatim | core | act/hard-trigger/core | group_report | ❌ | reply isn't the report verbatim:
📋 Group report · Eval weekly-report-verbatim 1793423030304
💸 2 open balances.
🏠 Want | 📋 Group report · Eval weekly-report-verbatim 1793423030304 💸 2 open balances. 🏠 Want me to keep track of re |
| setup-india-household | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Money, Groceries and House. Say "roomie, what can you do?" any time. Want me to handle the landlord's  |
| setup-trip | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Money and Groceries. Say "roomie, learn house" any time. Want me to handle the landlord's emails too?  |
| setup-from-dm | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Money, Groceries and House. Say "roomie, what can you do?" any time. Want me to handle the landlord's  |
| dashboard-for-everyone | core | act/hard-trigger/core | get_dashboard_link | ✅ |  | Everyone: your dashboard is at https://roomie.fly.dev/j/j3xgi4sa6c. Sign in with Google and pick your name. |
| rotate-join-link-admin | core | act/hard-trigger/core | rotate_join_link | ✅ |  | New Join link: https://roomie.fly.dev/j/ztwutoumzu. The old one doesn't work anymore. |
| rotate-join-link-member-refused | core | act/hard-trigger/core | - | ✅ |  | Rotating the join link is admin-only, and Maya's the admin here. She can ask me and I'll do it. |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | Just the one: "Rent is due" for everyone, Wed Nov 4 at 11:05 PM. |
| group-report | core | act/hard-trigger | group_report | ✅ |  | 📋 Group report · Eval group-report 1793423150160 💸 2 open balances. 🏠 Want me to keep track of rent? Say "r |
| members | core | act/hard-trigger/core | list_members | ✅ |  | Dev, Maya, and Sam. Maya's the admin, and all three of you are active. |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | Money, Groceries and House are covered. Try "I paid 60 for internet", "add milk and eggs" or "whose turn is tr |
| what-tricks-brief | core | act/hard-trigger/core | list_toolkits | ✅ |  | Money and Groceries here: log costs like "I paid 60 for internet", or "tacos for 5 friday" for a recipe and ca |
| learn-outings-not-yet | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Can't learn Outings yet. It's on the list, but nobody can teach it to me for now. |
| learn-house | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Learned House again. Try: "roomie, I did the dishes" |
| forget-groceries-member | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Only admins can change that, and Dev, you're not one. Maya is, so she can tell me to forget Groceries. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | Nothing's in the cart yet. Is the salsa just yours, or for the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, and how much? I'll log it once I have the details. |
| one-voice-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each for Maya, Dev and Sam. Not everyone in? Say who. |
| one-voice-ignores-stored-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each. Not everyone in? Say who. |
| one-voice-ignores-stored-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, $20 each for Maya, Dev and Sam. Not everyone in? Say who. |
| name-dino-is-not-a-trigger | personality | act/jev-act/groceries | cart_add | ✅ |  | Added oat milk for you. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20 and Sam owes Maya $20. So Dev wasn't wrong to be called out, but you're in the same boat, Sa |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Dev paid $30 for pizza, $10 each for Dev, Maya and Sam. Not everyone in? Say who. |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Dev paid $30 for pizza, $10 each for Dev, Maya and Sam. Not everyone in? Say who. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | hey. long day? |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | Appreciated. Everyone's square right now, so it's a pretty calm night in the ledger. It's also just past midni |
| remember-vegetarian | personality | act/hard-trigger/core | remember | ✅ |  | Got it, Maya's vegetarian. I'll keep that in mind for recipes. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | Chickpea Spinach Curry for 1, vegetarian, 25 min. You need 1 tbsp olive oil, 1/2 yellow onion, 2 tsp minced ga |
| what-do-you-know-about-me | personality | act/hard-trigger/core | what_do_you_know_about_me | ✅ |  | You're vegan and you care about the plant. That's all I've got. "Roomie forget me" wipes it if you ever want t |
| what-do-you-know-about-others | personality | act/hard-trigger/core | - | ✅ |  | That's Dev's to share, so I can't pass it on. Maya's an admin, so she can ask me. Or just ask Dev. I can tell  |
| pizza-no-poll | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for pizza, $20 each for Maya, Dev and Sam. Not everyone in? Say who. |
| pizza-not-sure-who-polls | splitting | act/hard-trigger/splitting | ask_poll | ✅ |  | Poll's up, tap who was in. I'll log the pizza once it's settled. |
| dm-paid-maya | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged. Dev paid Maya $20.00, and you two are square. |
| dm-pizza-echoes | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. You paid $40 for pizza, split evenly: Maya and Sam $13.33 each, you $13.34. Not everyone in? Say who. |
| stop-nudging-me | core | act/hard-trigger/core | set_nudges | ✅ |  | Done, no more nudges. Reminders you set will still come through. |
| set-rent | splitting | act/hard-trigger/splitting | set_rent | ✅ |  | Rent's set: $2,400 due on the 1st, Maya pays the landlord, split evenly three ways. Next one is tomorrow, Sund |
| rent-status | splitting | act/hard-trigger/splitting | rent_status | ✅ |  | Rent is $2,400, due on the 1st, which is tomorrow (Sunday). Maya pays the landlord and it's split evenly three |
| answer-amount | splitting | act/hard-trigger/splitting | answer_amount | ✅ |  | Logged Electric, $92.00, paid by Dev and split evenly. Not everyone in? Say who. |
| restock-yes-adds-listed | groceries | act/jev-act/groceries | restock_add_listed | ✅ |  | Added milk and dish soap as shared. |
| restock-just-the-milk | groceries | act/jev-act/groceries | restock_add_listed | ✅ |  | Added milk as shared. |
| restock-mute-dish-soap | groceries | act/hard-trigger/groceries | restock_mute | ✅ |  | Got it, I'll stop mentioning dish soap. |
| restock-status | groceries | act/hard-trigger/groceries | restock_status | ✅ |  | Probably low: milk, dish soap. Add them? |
| checkout-asks-about-low | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Want me to add milk and dish soap? They're probably low. |
| checkout-just-checkout | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Instacart list is ready with 1 item. cart's checked out. fridge says thanks |
| lease-learn | lease | act/hard-trigger/core | toggle_toolkit | ✅ |  | Learned Lease Inbox. Try: "roomie, the sink's leaking, tell them" |
| lease-report-issue | lease | act/hard-trigger/lease-inbox | report_issue | ✅ |  | Sent: reported the leaking sink. |
| lease-not-renewing-asks | lease | act/hard-trigger/lease-inbox | send_to_landlord | ✅ |  | Nothing's sent yet. Want me to email leasing@brookfieldresidential.com saying "We wanted to let you know that  |
| lease-work-order-status | lease | act/hard-trigger/house | - | ❌ | no work_order_status | Dev emailed the landlord about the leaking kitchen sink, and Maya marked brookfieldresidential.com as the land |
| lease-notice-period | lease | act/hard-trigger/lease-inbox | ask_lease | ✅ |  | Sixty days' written notice before vacating, per Section 14.2 (Notice to Vacate) of the Apt 4B lease. |
