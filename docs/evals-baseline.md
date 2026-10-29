# Eval baseline

`npm run evals` on 2026-10-29: **66/68 (97%)**, 7.1 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. maya paid $60 for internet, $20 each for her, dev and sam. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $30 uber, sam paid, split with dev so $15 each. dev owes sam $15. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $90 dinner, you paid: you $45, dev $22.50, sam $22.50. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $41.25 wine and cheese, you paid. you and dev $16.50 each, sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | those parts add up to more than the $50 you paid. can you double check the numbers? maybe dev's is 25, or the  |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. concert tickets $100, dev paid $60 and you paid $40. split three ways: maya $33.33, sam $33.33, dev $3 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | deleted the pizza expense ($24.00). say "undo" if that was a mistake. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | pizza's back, $24.00 restored. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | done, venmo's set to @maya. settle up links will point there now. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | sam owes dev $30 and maya $30. dev owes maya $30 too, but that cancels out since sam owes dev. net: maya's up  |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | sam owes maya $60. dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $54 water bill, maya paid, $18 each so dev and sam owe her $18 apiece. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | you owe maya $20.00. venmo button's right there, just tell me once it's sent and i'll log it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | logged. luigi's trattoria, $137.97 total, you paid. dev's at $78.65 (steak plus his third of the rest), you an |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | dev owes maya $20, and sam owes maya $20. maya's up $40 overall. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | dev owes maya $20.00 and sam owes maya $20.00. maya's up $40.00 overall. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | logged. dev paid maya $20, you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | lately: pizza $24 (dev paid, $8 each) and internet $60 (you paid, $20 each). that's all so far. |
| unknown-name | splitting | act/hard-trigger/splitting | list_members | ✅ |  | Jordan isn't in the group, so I can't log that yet. Do you mean Dev or Sam? If Jordan's new, they'd need to jo |
| unprompted-pizza-asks-first | splitting | ignore/jev-ignore | - | ❌ | stayed quiet; reply lacks 40; doesn't ask | (quiet) |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | anotado. uber $30 pagado por ti, $10 cada uno (tú, Dev y Sam). Dev y Sam te deben $10 a cada uno. |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | is that for just you or the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | added dish soap to the cart as a shared item, about $3.49. cart's at $3.49 total. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | dev's got two things in there: oat milk and 6 bananas. estimated total is $13.93. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | took milk off the list. |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | checkout's ready: 2 items, est. $8.78. tell me the total once someone buys it and i'll split it up. cart's che |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | logged. $84 groceries (4 items), maya paid. maya's part is $32.57, dev owes $36.00 and sam owes $15.43. cart's |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | added 2 lb chicken to the house cart, about $8.99. that's the only thing in there so far. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | added dish soap to the cart as a house item, about $3.49. cart's at $3.49 total. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min) Need: 1.75 lb ground beef, 1 yellow onion, 3 cloves garlic, 2 tbsp chili powder |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | added 13 things to the shared cart, about $53.73 est. skipped the onion. oil and salt went in too, so say if y |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | They asked explicitly to add them, so add to cart.got it: garlic tomato spaghetti for 3, 25 min. all 10 ingred |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | here's the instacart page for the tacos for 5, button's attached. |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | the cart's got 12 items, est. $46.82. dev has oat milk, and the rest is the tacos for 5 stuff maya added (avoc |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | got it, salt and oil are in the pantry. i'll leave them off the cart when recipes come up. |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | we always have oil, rice and salt. tell me if anything's missing and i'll add it. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | logged. sam paid $42 for groceries (2 items): maya owes $22.24, dev owes $19.76. cart's cleared. |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | got it, salsa and 2 bags of chips. are those both just for you or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | logged, dishes done by dev. nice. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | want me to log the dishes as done by you, dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | dev's up. maya just did it, so it's not due until nov 1 (every 3 days). |
| add-chore | chores | act/hard-trigger/chores | add_chore | ✅ |  | added vacuuming to the chart, every 7 days. someone's gotta go first. |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | logged. trash is done by dev 🗑️ |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | add_maintenance | ✅ |  | tracking it. ac filter every 90 days, i'll nag when it's close. say "ac filter done" once it's changed. |
| maintenance-done | upkeep | act/hard-trigger/upkeep | maintenance_done | ✅ |  | logged. hvac filter's done as of today, nice one dev. |
| remind-trash-tuesday | reminders | act/hard-trigger | set_reminder | ✅ |  | done. everyone gets pinged tuesday nov 3 at 8pm. |
| list-reminders | reminders | act/hard-trigger/reminders | list_reminders | ✅ |  | just one: "rent is due" for everyone, going off monday nov 2 at 10:09pm. |
| group-report | core | act/hard-trigger/splitting | group_report | ✅ |  | 📣 Group report 💸 Dev pays Maya $20.00 💸 Sam pays Maya $20.00 🧹 No chores on the chart yet. ⏰ Nothing sched |
| members | core | act/hard-trigger | list_members | ❌ | reply lacks Dev | it's you, maya, and sam. maya's the admin, and all three of you are active. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | anytime. still need to know on the salsa though, just you or the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | who paid, and for what? give me the amount and who's in on it and i'll get it logged. |
| vibe-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | logged. maya paid $60 for internet, $20 each, so dev and sam owe her $20 apiece. |
| vibe-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged! Maya paid $60 for internet, split three ways: $20 each. Dev and Sam each owe Maya $20 🎉📶 |
| vibe-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $60 internet, Maya paid. $20 each, so Dev and Sam owe Maya $20. |
| name-dino-triggers | personality | act/hard-trigger/groceries | cart_add | ✅ |  | added oat milk to your stuff, about $4.99. cart's at $4.99 total. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ✅ |  | dev owes maya $20 and sam owes maya $20, so you're on the hook too. maya's up $40 total. |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $30 pizza, dev paid, $10 each. maya and sam owe dev $10 apiece. |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $30 pizza, dev paid, $10 each. maya and sam owe you $10 apiece. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | evening all |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | mmm that's the spot. good day, honestly, everyone's square and the house is quiet. i've mostly been guarding t |
| remember-vegetarian | personality | act/hard-trigger/groceries | remember | ✅ |  | got it, maya's vegetarian. i'll keep that in mind for recipes. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | veggie chickpea coconut curry for 1, about 30 min. you'd need chickpeas, coconut milk, onion, garlic, ginger,  |
| what-do-you-know-about-me | personality | act/hard-trigger | what_do_you_know_about_me | ✅ |  | you're vegan and you care about the plant. that's all i've got. "roomie forget me" wipes it if you want. |
| what-do-you-know-about-others | personality | act/hard-trigger | - | ✅ |  | can't share what i know about dev, that's his to tell. you can ask him directly. i'm happy to tell you what i' |
