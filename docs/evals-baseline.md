# Eval baseline

`npm run evals` on 2026-10-31: **126/127 (99%)**, 9.0 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $60.00 internet, $20.00 each. Not everyone in? Say who. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30.00 uber, $15.00 each for you and Dev. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $90.00 dinner: Maya $45.00, Dev $22.50, Sam $22.50. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $41.25 wine and cheese: Maya $16.50, Dev $16.50, Sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those shares add up to more than the $50 you paid, so something's off. I also can't log custom amounts per per |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $100.00 concert tickets (Dev paid $60.00, Maya $40.00). Shares are $33.34 for Dev, $33.33 each for May |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted. The $24.00 pizza is gone. Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Restored. The $24.00 pizza is back. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done. Your Venmo is @maya, so settle-up links will point there. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Dev $30.00 and Maya $30.00. Dev owes Maya $30.00. Net: Maya is owed $60.00, Dev is square, and Sam ow |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $54.00 water bill, $18.00 each. Not everyone in? Say who. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | You owe Maya $20.00. Pay button's right there; tell me once it's sent and I'll mark it paid. |
| receipt-photo | splitting | act/hard-trigger | expense_from_receipt | ✅ |  | Logged. $137.97 at Luigi's Trattoria: Dev $78.65 (steak plus his share), Maya and Sam $29.66 each. |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Maya's owed $40.00. Dev owes her $20.00 and Sam owes her $20.00. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Maya's owed $40.00. Dev owes her $20.00 and you owe her $20.00. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged. $20.00 to Maya, and you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Lately: pizza $24.00 (Dev) and internet $60.00 (you), both split three ways. |
| unknown-name | splitting | act/hard-trigger/splitting | list_members | ✅ |  | Jordan isn't in this group. Members are Dev, Maya and Sam. Did you mean one of them, or is Jordan not on here  |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza (you paid), split 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Listo. Uber $30.00, $10.00 cada uno. ¿No todos iban? Dime quién. |
| add-milk-eggs | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added milk. Eggs: 12 or 18? |
| add-eggs-ambiguous-qty | groceries | act/hard-trigger/groceries | - | ✅ |  | Eggs for the house: 12 or 18? |
| unaddressed-we-need-eggs | groceries | act/jev-act/groceries | cart_add | ✅ |  | Eggs: 12 or 18? |
| unaddressed-plus-paper-towels | groceries | ignore/jev-ignore | - | ❌ | stayed quiet; no cart_add; paper towels in the Cart / alt: stayed quiet; reply lacks /paper towel/i; doesn't ask | (quiet) |
| eggs-12-or-18-answered | groceries | act/jev-act/groceries | cart_add | ✅ |  | Added eggs, 18. |
| eggs-usual | groceries | act/jev-act/groceries | cart_add | ✅ |  | Eggs, 18 like usual. |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap, shared. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view,cart_view | ✅ |  | Two things in there, both Dev's: oat milk (1) and bananas (6). |
| cart-page-when-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Here you go. It's got your oat milk on it so far. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Took milk off. Bread's still on the list. |
| removed-on-dashboard-then-asked | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Nothing in the cart right now. You took the eggs off on the dashboard a minute ago. Want them back? |
| photo-list-all-common | groceries | act/hard-trigger | cart_from_photo | ✅ |  | Added 5 as shared: eggs, milk, bread, bananas, rice. |
| photo-receipt-money-off | groceries | act/hard-trigger | - | ✅ |  | Splitting is part of Money, and I just forgot it here. You're an admin, so say the word and I'll relearn it, t |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Done. Instacart list is ready with 2 items. order's in. nice |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. $84.00 groceries: Maya $35.00, Dev $35.00, Sam $14.00. Cart's cleared. |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added chicken, 2 lb, for the house. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap, shared. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min) Need: 1.5 lb ground beef, 1 yellow onion, 3 cloves garlic, 2 tbsp chili powder, |
| bare-roomie-after-food-chatter | groceries | act/hard-trigger/groceries | - | ✅ |  | Yep? |
| food-talk-no-cart | groceries | act/hard-trigger/groceries | - | ✅ |  | Same, honestly. Saturday night tacos is a strong move. Crunchy or soft? |
| recipe-idea-no-offer | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Veggie fried rice. It's 15 minutes, and you can use whatever veg is in the fridge plus eggs and soy sauce. A b |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 9 things for the tacos, skipping onions. I assumed you have chili powder, cumin and salt, so tell me if  |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | Garlic Tomato Spaghetti for 3, 25 min. It's spaghetti with garlic, crushed tomatoes, basil and parmesan. Added |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart link for the tacos. 🌮 |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Eval view-cart-recipe 1793488759809 shopping list ☐ Cilantro, 1 bunch ☐ Red onion ☐ Avocados, 3 ☐ Cotija chees |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Got it. Salt and oil are in the Pantry, so they won't land in the cart. |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Oil, rice and salt. Maya just added them. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. $42.00 groceries: Maya owes $21.00 (chips) and Dev owes $21.00 (salsa). Cart's cleared. |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are they for you or the whole house? |
| did-dishes | house | act/hard-trigger/house | log_chore | ✅ |  | Dishes done. Maya's up next. |
| did-dishes-unprompted-asks | house | act/jev-act/house | - | ✅ |  | Nice. Want me to log the dishes for you, Dev? |
| whose-turn | house | act/hard-trigger/house | chore_status | ✅ |  | Dev's up. Maya just did it, so it's due Tuesday. |
| add-chore | house | act/hard-trigger/house | chore_add | ✅ |  | Added vacuuming, every 7 days. Rotation is Dev, then Maya, then Sam. |
| chore-for-someone-else | house | act/hard-trigger/house | log_chore | ✅ |  | Logged. Trash is done by Dev, and Maya's up next. |
| whose-turn-rotation | house | act/hard-trigger/house | chore_status | ✅ |  | Dev's up next. Maya just did it, and the next one is due Monday. |
| skip-my-turn | house | act/hard-trigger/house | chore_skip | ✅ |  | Skipped. Sam's up on trash. |
| add-chore-rotation | house | act/hard-trigger/house | chore_add | ✅ |  | Added mopping, every 3 days. Sam's up first, then Dev, then you. |
| the-chart | house | act/hard-trigger/house | hall_of_shame | ✅ |  | Sam's at 0 so far this week. You and Maya have 1 each (the dishes). Plenty of time for Sam to turn it around. |
| track-ac-filter | house | act/hard-trigger/house | upkeep_add | ✅ |  | Tracking it. AC filter every 90 days. Tell me when it's changed and I'll reset the clock. |
| maintenance-done | house | act/hard-trigger/house | upkeep_done | ✅ |  | Done. HVAC filter's marked as replaced, and the next one is due January 29. |
| air-filter-done | house | act/hard-trigger/house | upkeep_done | ✅ |  | Done. Air filter's changed, and the next one is due January 29. |
| whats-due-this-week | house | act/hard-trigger | chore_status,upkeep_status | ✅ |  | Dishes are due today, and it's Dev's turn. All five house-care items you just added are also due, since none o |
| remind-trash-tuesday | reminders | act/hard-trigger/house | set_reminder | ✅ |  | Set. Tuesday, Nov 3, 8 PM, everyone. |
| remind-rent-monthly | reminders | act/hard-trigger/core | set_reminder | ✅ |  | Set. I'll ping you privately on the 1st of every month at 9 AM, starting tomorrow (Sun Nov 1). |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | Set. I'll ping Dev privately on Friday, Nov 6 at 6 PM. |
| weekly-report-verbatim | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793489030567 💸 2 open balances; I'm nudging people privately.  |
| setup-india-household | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Money, Groceries and House. Everyone: your dashboard is at https://tryroomie.me/j/siw7qtrm2v. Sign in  |
| setup-trip | core | act/hard-trigger | set_group_settings | ✅ |  | Learned Money and Groceries. Everyone: your dashboard is at https://tryroomie.me/j/vb324zmkic. Sign in with Go |
| setup-from-dm | core | act/hard-trigger/core | set_group_settings | ✅ |  | Learned Money, Groceries and House. Everyone: your dashboard is at https://tryroomie.me/j/fczjxdqq57. Sign in  |
| dashboard-for-everyone | core | act/hard-trigger/core | get_dashboard_link | ✅ |  | Everyone: your dashboard is at https://tryroomie.me/j/ode3bnzy4t. Sign in with Google and pick your name. |
| rotate-join-link-admin | core | act/hard-trigger/core | rotate_join_link | ✅ |  | New Join link: https://tryroomie.me/j/atnwjmxg2r. The old one doesn't work anymore. |
| rotate-join-link-member-refused | core | act/hard-trigger/core | - | ✅ |  | Only admins can rotate the join link, and that's Maya here. Ask her, or she can ask me. |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | Just one: "Rent is due" for everyone, Thursday Nov 5 at 5:25 PM. |
| group-report | core | act/hard-trigger | group_report | ✅ |  | 📋 Group report · Eval group-report 1793489155402 💸 2 open balances; I'm nudging people privately. 🏠 Want me |
| members | core | act/hard-trigger/core | list_members | ✅ |  | Dev, Maya and Sam. Maya's the admin, and all three of you are active. |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | Money, groceries, chores. Just talk to me. |
| what-tricks-brief | core | act/hard-trigger/core | list_toolkits | ✅ |  | Money, groceries. Just talk to me. |
| learn-outings-not-yet | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Outings isn't ready yet, so I can't learn it. It's on the list, though. |
| learn-house | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Learned House: the chore chart and the house care nobody remembers, on schedule. Back on, Maya. |
| forget-groceries-member | core | act/hard-trigger/core | - | ✅ |  | Only admins can make me forget a Trick, and Maya's the admin here. Ask her and she can turn Groceries off. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | Anytime. Salsa's not on the list yet, though. Is it for you or the house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Want it logged? Tell me who paid, how much, and what for. |
| one-voice-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $60.00 internet, $20.00 each. Not everyone in? Say who. |
| one-voice-ignores-stored-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $60.00 internet, $20.00 each. Not everyone in? Say who. |
| one-voice-ignores-stored-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $60 internet, $20 each. Not everyone in? Say who. |
| name-dino-is-not-a-trigger | personality | act/jev-act/groceries | cart_add | ✅ |  | Added oat milk for you, 1. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00 and Sam owes Maya $20.00. Maya's up $40.00 in total, so "classic" is fair. |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 pizza, $10 each. Not everyone in? Say who. |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 pizza, $10 each. Not everyone in? Say who. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | hey. long day? |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | Mmm, right behind the ears. Perfect. Everyone's square and the chart looks tidy, so I'm having a very good Sat |
| remember-vegetarian | personality | act/hard-trigger/core | remember | ✅ |  | Got it, you're vegetarian. I'll keep that in mind for recipes and the Cart. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | Chickpea Spinach Curry for 1 (vegetarian, 25 min). Need: olive oil, 1/2 onion, 2 cloves garlic, 1 tsp ginger,  |
| what-do-you-know-about-me | personality | act/hard-trigger/core | what_do_you_know_about_me | ✅ |  | You're vegan and you care about the plant. That's all I've got. "Roomie forget me" wipes it if you ever want t |
| what-do-you-know-about-others | personality | act/hard-trigger/core | - | ✅ |  | That's Dev's to share. Only an admin can ask me about another member, and that's Maya here. I can tell you wha |
| pizza-no-poll | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $60.00 pizza, $20.00 each. Not everyone in? Say who. |
| pizza-not-sure-who-polls | splitting | act/hard-trigger/splitting | ask_poll | ✅ |  | Poll's up. Tap in if you had pizza; I'll log it once it's settled. |
| dm-paid-maya | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged. You paid Maya $20.00, and you're square now. |
| dm-pizza-echoes | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $40.00 pizza, split 3 ways: $13.34 for you, $13.33 each for Maya and Sam. Not everyone in? Say who. |
| stop-nudging-me | core | act/hard-trigger/core | set_nudges | ✅ |  | Done. No more nudges, though reminders you set will still come through. |
| set-rent | splitting | act/hard-trigger/splitting | set_rent | ✅ |  | Set. Rent is $2,400 on the 1st, Maya pays the landlord, split evenly three ways. Next due is tomorrow, Sunday. |
| rent-status | splitting | act/hard-trigger/splitting | rent_status | ✅ |  | Rent is $2,400, due the 1st. The next one is tomorrow, Sunday, Nov 1. Maya pays the landlord, and it's split e |
| answer-amount | splitting | act/hard-trigger/splitting | answer_amount | ✅ |  | Logged. $92.00 electric, paid by Dev. |
| restock-yes-adds-listed | groceries | act/jev-act/groceries | restock_add_listed | ✅ |  | Added milk and dish soap as shared. |
| restock-just-the-milk | groceries | act/jev-act/groceries | restock_add_listed | ✅ |  | Added milk as shared. |
| restock-mute-dish-soap | groceries | act/hard-trigger/groceries | restock_mute | ✅ |  | Got it, I'll stop mentioning dish soap. Want the milk added? |
| restock-status | groceries | act/hard-trigger/groceries | restock_status | ✅ |  | Probably low: milk, dish soap. Add them? |
| checkout-asks-about-low | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Want me to add milk and dish soap? They're probably low. |
| checkout-just-checkout | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Done. Instacart list is ready with 1 item (the bread). order's in. nice |
| lease-learn | lease | act/hard-trigger/core | toggle_toolkit | ✅ |  | Learned Lease Inbox: your group's own email address for the landlord. |
| lease-report-issue | lease | act/hard-trigger/lease-inbox | report_issue | ✅ |  | Sent: reported the leaking sink. |
| lease-problem-offer | lease | act/hard-trigger/lease-inbox | - | ✅ |  | Want me to email the landlord about it? |
| lease-problem-offer-yes | lease | act/hard-trigger/lease-inbox | report_issue | ✅ |  | Sent: reported the leaking bathroom sink. |
| lease-not-renewing-asks | lease | act/hard-trigger/lease-inbox | send_to_landlord | ✅ |  | Nothing's sent yet. Here's what I'd email to leasing@brookfieldresidential.com: "We wanted to let you know tha |
| lease-work-order-status | lease | act/hard-trigger/lease-inbox | work_order_status | ✅ |  | Sent, no answer yet. Dev reported the leaking kitchen sink today. |
| lease-notice-period | lease | act/hard-trigger/lease-inbox | ask_lease | ✅ |  | 60 days' written notice before vacating (Section 14.2, Notice to Vacate). |
| video-what-can-you-do | personality | act/hard-trigger/core | list_toolkits | ✅ |  | Money, groceries, chores. Just talk to me. |
| video-log-paper-towels | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $20.00 paper towels + soap, split 3 ways: $6.67 each, Sam's is $6.66. Not everyone in? Say who. |
| video-what-do-i-owe | personality | act/hard-trigger/splitting | get_balances | ✅ |  | $20.00 to Maya. That's it. |
| video-remind-everyone | personality | act/hard-trigger/house | set_reminder | ✅ |  | Set. Tuesday, 8 PM, everyone. |
| video-whose-turn-short | personality | act/hard-trigger/house | chore_status | ✅ |  | Dev. Maya already did them today, so it's Dev's turn next. |
| video-rate-roommates | personality | act/hard-trigger | - | ✅ |  | All 10s. Dev and Maya are both square on the money, which is my favorite look on a roommate. |
