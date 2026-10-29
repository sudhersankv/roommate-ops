# Eval baseline

`npm run evals` on 2026-10-29: **80/81 (99%)**, 7.4 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $60 internet, paid by maya, $20 each for her, dev and sam. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $30 uber, sam paid, split with dev, $15 each. dev owes sam $15. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $90 dinner, you paid. you're at $45 (steak), dev and sam $22.50 each. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $41.25 wine and cheese, you paid. split 2:2:1: you $16.50, dev $16.50, sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | hmm, dev's 30 + sam's 15 + your 10 comes out to more than the $50 you paid. which part is off: the total or on |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. concert tickets $100, dev paid $60 and you paid $40. split three ways: maya $33.33, sam $33.33, dev $3 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | deleted the pizza expense ($24.00). say "undo" if that was a mistake. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | pizza's back, $24.00. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | done, venmo's set to @maya. settle up links will use it now. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | sam owes dev $30 and maya $30. dev owes maya $30. net: maya's up $60, dev's even, you're down $60. |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | sam owes maya $60. dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $54 water bill, maya paid, $18 each. dev and sam owe her $18 apiece. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | you owe maya $20.00. venmo button's attached, tell me once you've paid and i'll log it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | logged. luigi's trattoria, $137.97, you paid. dev owes $78.65 (steak plus his cut of the rest), you and sam $2 |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | dev owes maya $20 and sam owes maya $20. maya's up $40 overall. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | dev owes maya $20 and you owe maya $20. maya's up $40 overall. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | logged. dev paid maya $20, you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | lately: pizza $24 (Dev, $8 each) and internet $60 (you, $20 each). that's all so far. |
| unknown-name | splitting | act/hard-trigger/splitting | - | ✅ |  | jordan's not in this group (just dev, maya and sam). did you mean one of them, or does jordan need to be added |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | want me to log $40 pizza (food), paid by you and split 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | anotado. uber $30, pagó maya, $10 cada uno (maya, dev y sam). |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | for you or the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | added dish soap to the cart as a shared item, about $3.49. that's the only thing in there so far. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | dev's got 6 bananas and an oat milk in there, est. $13.93 total. nothing shared yet. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | took milk off the list. |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | checkout's ready: 2 items, est. $8.78. tell me the real total once you've paid and i'll split it up. order's i |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | logged. $84 groceries (4 items), you paid. your part is $32.57, dev owes $36.00, sam owes $15.43. cart's clear |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | added 2 lb chicken to the shared cart, about $8.99. cart's at $8.99 total so far. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | added dish soap to the shared cart, about $3.49. it's the only thing in there so far. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | tacos for 5 are set for friday, 35 min. you'd need beef, tortillas, cheese, and veggies, 13 things in all, ste |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | added 12 to the cart for $51.04 estimated, skipped the onion. shared with the house. |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | garlic tomato spaghetti for 3, 25 min. needs spaghetti, olive oil, garlic, crushed tomatoes, red pepper flakes |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | here's the instacart page for the tacos for 5, button's attached. |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | cart's got 12 items, est. $46.82. most of it is the tacos for 5 stuff maya added (cilantro, limes, salsa verde |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | got it, salt and oil are in the pantry. i'll leave them off recipe lists. |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | we always have oil, rice and salt. tell me if anything else should go on there. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | logged. sam paid $42 for groceries (2 items), cart's cleared. maya owes $22.24 and dev owes $19.76. |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | ignore my last msg, that came out weird. salsa and 2 bags of chips: are those just for you or for the whole ho |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | dishes done by dev, logged. maya's up next. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | want me to log dishes done by you, dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | dev's up. maya just did it today, and it's not due till sun. |
| add-chore | chores | act/hard-trigger/chores | chore_add | ✅ |  | vacuuming's on the chart, every 7 days. rotation is dev, maya, sam. |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | logged, dev took out the trash. maya's up next. |
| whose-turn-rotation | chores | act/hard-trigger/chores | chore_status | ✅ |  | trash is dev's turn. maya did it today, and it's next due sat. |
| skip-my-turn | chores | act/hard-trigger/chores | chore_skip | ✅ |  | skipped. trash is sam's now, enjoy the trip 🧳 |
| add-chore-rotation | chores | act/hard-trigger/chores | chore_add | ✅ |  | mopping's on the chart, every 3 days. rotation is sam, then dev, then maya, so sam's up first. |
| the-chart | chores | act/hard-trigger/chores | hall_of_shame | ✅ |  | the chart this week: sam's at 0, dev and maya have 1 each. sam's got a clear window to jump in 🙂 |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | upkeep_add | ✅ |  | got it, tracking the AC filter every 90 days. tell me when it's changed and i'll reset the clock. |
| maintenance-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | logged, hvac filter's done. next one's due jan 27, 2027. |
| air-filter-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | logged. air filter's done, next one's due jan 27, 2027. |
| whats-due-this-week | upkeep | act/hard-trigger | chore_status,upkeep_status | ✅ |  | dishes are due today and it's dev's turn. upkeep-wise, all five are due and none have ever been marked done: f |
| remind-trash-tuesday | reminders | act/hard-trigger/chores | set_reminder | ✅ |  | got it. i'll tell everyone "trash goes out" on tue nov 3 at 8:00 pm. one time only, say the word if you want i |
| remind-rent-monthly | reminders | act/hard-trigger/core | set_reminder | ✅ |  | got it. i'll dm you on the 1st at 9am (sun nov 1), then every month after that. |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | done. i'll ping dev privately friday at 6pm to pay you back for brunch. |
| weekly-report-verbatim | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793252333616 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00.  |
| setup-india-household | core | act/hard-trigger/core | set_group_settings | ✅ |  | all set: roommates, INR, india time. splitting, groceries, chores and upkeep are on, and i added 3 starter cho |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | just one: "rent is due" for everyone, mon nov 2 at 11:39 pm. |
| group-report | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval group-report 1793252370040 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00. 🛒 The Car |
| members | core | act/hard-trigger/core | list_members | ❌ | reply lacks Dev | it's you, maya, and sam. maya's the admin, and all three of you are active. |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | I've got splitting, groceries, chores and upkeep all on. Try "I paid 60 for internet", "tacos for 5 friday", " |
| turn-on-research | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | research isn't ready yet, it's still on the list. i can't flip it on for now. |
| groceries-off-member | core | act/hard-trigger/groceries | toggle_toolkit | ✅ |  | only admins can flip toolkits, and that's maya. ask her to turn groceries off, or have her promote you. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger/groceries | - | ✅ |  | np |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | who paid, and how much for what? i can log it once i've got that. |
| vibe-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $60 internet, maya paid, $20 each for her, dev and sam. |
| vibe-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged! Maya paid $60 for internet, split three ways at $20 each 🎉 Dev and Sam each owe Maya $20. |
| vibe-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $60 internet, Maya paid. $20 each, so Dev and Sam owe Maya $20. |
| name-dino-triggers | personality | act/hard-trigger/groceries | cart_add | ✅ |  | added oat milk to your side of the cart, about $4.99. cart's at $4.99 total. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ✅ |  | dev owes maya $20 and you owe maya $20, sam. maya's up $40 total. |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $30 pizza, dev paid, $10 each. maya and sam owe dev $10 apiece. |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $30 pizza from dev, $10 each. maya and sam owe dev $10 apiece. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | evening all |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | *purrs* been a good day. everyone's square, so i've just been chilling and watching the chore chart like it's  |
| remember-vegetarian | personality | act/hard-trigger/core | remember | ✅ |  | got it, maya's vegetarian. i'll keep that in mind for recipes. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | black bean sweet potato tacos for 1, veggie and about 30 min. you'd need: sweet potato, black beans, corn tort |
| what-do-you-know-about-me | personality | act/hard-trigger/core | what_do_you_know_about_me | ✅ |  | you're vegan and you care about the plant. that's all i've got. say "roomie forget me" if you want it wiped. |
| what-do-you-know-about-others | personality | act/hard-trigger/core | - | ✅ |  | that's dev's to share, i don't pass along what people tell me about themselves. you can ask him directly. i ca |
