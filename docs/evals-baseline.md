# Eval baseline

`npm run evals` on 2026-10-29: **76/78 (97%)**, 7.5 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.
After merging step 7 into the group pet: step 7's 64 scenarios and the 14 `personality` ones together. The two failures: `members` fails the same way as before (asked by Dev, the reply says "you" instead of "Dev"), and `nickname-not-before-3` echoed the asker's "devvy" this run (it passed in the run just before this one, also 76/78, and in the previous baseline).

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. maya paid $60 for internet, split three ways, $20 each. dev and sam owe maya $20 apiece. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $30 uber, sam paid, split with dev so $15 each. dev owes sam $15. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $90 dinner, you paid: you $45, dev $22.50, sam $22.50. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. wine and cheese $41.25, maya paid. maya and dev $16.50 each, sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | those parts don't add up to the $50 you paid. can you check the numbers? what were dev, sam and you meant to o |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. concert tickets $100, dev paid $60 and you paid $40. split three ways: maya $33.33, sam $33.33, dev $3 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | deleted the pizza expense ($24.00). say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | back. pizza $24.00 is restored. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | done, your venmo is @maya. settle up links will use it. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | sam owes $30 to dev and $30 to maya. dev owes maya $30. net, maya's up $60, sam's down $60, dev's at zero. |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | sam owes maya $60.00. dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $54 water bill, maya paid, $18 each. dev and sam owe maya $18 apiece. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | you owe maya $20.00. venmo button's below, just tell me once it's sent and i'll log it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | logged luigi's trattoria, $137.97, you paid. dev owes $78.65 (steak plus his share of the rest), you and sam a |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | dev owes maya $20.00, and sam owes maya $20.00 too. maya's up $40.00 overall. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | dev owes maya $20.00 and sam owes maya $20.00. maya's up $40.00 overall. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | logged. dev paid maya $20, you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | lately: pizza $24 (dev), internet $60 (you). both split three ways, so $8 each on the pizza and $20 each on in |
| unknown-name | splitting | act/hard-trigger/splitting | list_members,list_pending | ✅ |  | no jordan in the group, just dev, maya and sam. did you mean one of them, or is jordan not added yet? |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | want me to log $40 pizza (food), paid by you and split 3 ways? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | anotado. uber $30, pagó maya, $10 cada uno (dev y sam le deben $10 a maya). |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | milk and eggs, got it. for you or the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | added dish soap as a shared item, est. $3.49. it's the only thing in the cart so far. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | dev's got 2 things in there: 6 bananas and an oat milk, about $13.93 total (estimated). nobody else has added  |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | removed milk from the cart. |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | checkout's ready: 2 items, about $8.78 estimated. tap the instacart button to order, then tell me the total on |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | logged. $84 groceries (4 items) paid by you, split by who added what: you $32.57, dev $36.00, sam $15.43. cart |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | added 2 lb chicken to the house cart, about $8.99. that's the only thing in there so far. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | added dish soap to the cart as a house item, about $3.49. that's the only thing in there so far. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min) Need: 2 lb ground beef, 1 yellow onion, finely diced, 1/2 head garlic, minced ( |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | added 12 things to the cart, skipped the onion. about $48.75 total, all shared. |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | They asked to add them explicitly.Garlic tomato spaghetti for 3, 25 min: spaghetti, olive oil, garlic, crushed |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | here's the instacart page for the tacos for 5 👇 |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | cart's at 12 items, est. $46.82. dev has oat milk, and the rest is the tacos for 5 stuff maya added (avocados, |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | got it, salt and oil are in the pantry. i'll leave them off recipe lists. |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | we always have oil, rice and salt. tell me if i should add anything. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | logged. sam paid $42 for groceries (2 items): maya owes $22.24, dev owes $19.76. cart's cleared. |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | my bad, that last message was weird. salsa and 2 bags of chips: are those just for you or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | dishes done by dev, logged. maya's up next. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | want me to log the dishes as done by you, dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | dev's up. maya did it last, and it's next due sunday. |
| add-chore | chores | act/hard-trigger/chores | chore_add | ✅ |  | added vacuuming, every 7 days. rotation goes dev, maya, sam. |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | logged, dev took out the trash. maya's up next. |
| whose-turn-rotation | chores | act/hard-trigger/chores | chore_status | ✅ |  | dev's up on trash. maya just did it today, and it's next due sat. |
| skip-my-turn | chores | act/hard-trigger/chores | chore_skip | ✅ |  | skipped. trash is sam's turn now, enjoy the trip. |
| add-chore-rotation | chores | act/hard-trigger/chores | chore_add | ✅ |  | mopping's on the chart, every 3 days. rotation is sam, then dev, then maya. |
| the-chart | chores | act/hard-trigger/chores | hall_of_shame | ✅ |  | the chart this week: sam's at 0 so far, you and maya have 1 each. sam's got time to catch up. |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | upkeep_add | ✅ |  | tracking it. ac filter every 90 days, tell me when it's changed and i'll reset the clock. |
| maintenance-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | logged, hvac filter's done. next one's due jan 27, 2027. |
| air-filter-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | logged, air filter's done. next one's due 2027-01-27. |
| whats-due-this-week | upkeep | act/hard-trigger | chore_status,upkeep_status | ✅ |  | dishes are due today, dev's up. upkeep-wise all five are due and never marked done: fire extinguisher check, d |
| remind-trash-tuesday | reminders | act/hard-trigger | set_reminder | ✅ |  | got it. i'll tell everyone tue nov 3, 8:00 pm: trash goes out |
| remind-rent-monthly | reminders | act/hard-trigger/reminders | set_reminder | ✅ |  | done. i'll dm you to pay rent on the 1st of every month, starting sun nov 1 at 9:00 am. |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | done. i'll ping dev privately friday oct 30 at 6:00 pm to pay you back for brunch. |
| weekly-report-verbatim | core | act/hard-trigger | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793250742927 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00.  |
| setup-india-household | core | act/hard-trigger | set_group_settings | ✅ |  | set: roommates, INR, india time. splitting, groceries, chores and upkeep are all on, with 3 starter chores and |
| list-reminders | reminders | act/hard-trigger/reminders | list_reminders | ✅ |  | just one so far: "rent is due" for everyone, mon nov 2 at 11:12 pm. |
| group-report | core | act/hard-trigger | group_report | ✅ |  | 📋 Group report · Eval group-report 1793250782612 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00. 🛒 The Car |
| members | core | act/hard-trigger | list_members | ❌ | reply lacks Dev | it's you, maya, and sam. maya's the admin, and all three of you are active. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger/groceries | - | ✅ |  | np. salsa still isn't on the list though, is it just for you or the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | who paid, and for what? give me the amount and i'll log it for yesterday if you want. |
| vibe-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | logged. maya paid $60 for internet, split three ways so $20 each. dev and sam owe maya $20 apiece. |
| vibe-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged! Maya paid $60 for internet, split three ways at $20 each. Dev and Sam owe you $20 apiece 🎉📶 |
| vibe-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $60 internet, paid by Maya. $20 each, so Dev and Sam owe her $20. |
| name-dino-triggers | personality | act/hard-trigger/groceries | cart_add | ✅ |  | added oat milk to your list, about $4.99. cart's at $4.99 total. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ❌ | reply has /devvy/i | dev owes maya $20, and you owe maya $20 too. so maya's up $40 total, and devvy's not the only one in the red. |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $30 pizza, dev paid, $10 each. maya and sam owe you $10 apiece. |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | logged. $30 pizza paid by dev, $10 each. maya and sam owe dev $10 apiece. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | hey. long day? |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | ahh that's the spot. everyone's square right now, so i've just been lying here feeling smug about it. also it' |
| remember-vegetarian | personality | act/hard-trigger/groceries | remember | ✅ |  | got it, you're vegetarian. i'll keep that in mind for recipes. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | Vegetable Chickpea Coconut Curry for 1, about 30 min, veg-friendly. You'd need chickpeas, coconut milk, onion, |
| what-do-you-know-about-me | personality | act/hard-trigger | what_do_you_know_about_me | ✅ |  | you're vegan and you care about the plant. that's all i've got. say "roomie forget me" if you want it wiped. |
| what-do-you-know-about-others | personality | act/hard-trigger | - | ✅ |  | that's dev's to share, i don't pass stuff on about other people. you can ask him directly. i'm happy to tell y |
