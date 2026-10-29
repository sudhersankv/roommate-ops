# Eval baseline

`npm run evals` on 2026-10-29: **82/83 (99%)**, 8.7 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, split three ways at $20 each. Dev and Sam each owe Maya $20. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 uber, Sam paid, split with Dev at $15 each. Dev owes Sam $15. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $90 dinner, Maya paid: Maya $45 (steak), Dev $22.50, Sam $22.50. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $41.25 for wine and cheese, split 2:2:1: Maya $16.50, Dev $16.50, Sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those shares add up to $55, not the $50 you paid. Can you check the numbers? Also, I can't log custom splits f |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Concert tickets $100, Dev paid $60 and Maya $40. Split three ways: Maya $33.33, Sam $33.33, Dev $33.34 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza expense ($24.00). Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle-up links will point there now. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $30 and Dev $30. Dev owes Maya $30. Net, Maya is owed $60, Sam owes $60, and Dev's even. |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $54 for the water bill, split three ways at $18 each. Dev and Sam each owe Maya $18. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Dev owes Maya $20.00. The Venmo pay button is attached. Tell me once you've paid and I'll record it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, paid by Maya. Dev owes $78.65 (steak plus his cut of the rest), and Maya an |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and Sam owes Maya $20.00. Maya's the one getting paid. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and you owe Maya $20.00. Maya's up $40.00 overall. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged. Dev paid Maya $20, and you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Lately: pizza $24 (Dev, $8 each) and internet $60 (Maya, $20 each). Both split three ways, both today. |
| unknown-name | splitting | act/hard-trigger/splitting | - | ✅ |  | I don't have a Jordan in this group. It's just Dev, Maya and Sam. Did you mean one of them, or is Jordan not i |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 pizza (food), paid by Dev and split 3 ways with Maya and Sam? |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Anotado. Uber de $30 que pagó Maya, a $10 cada uno (Maya, Dev y Sam). |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs for just you, or the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Dish soap's in the cart as a shared item, about $3.49. That's the only thing in there so far. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart has two items, both Dev's: oat milk and 6 bananas. Estimated total is $13.93. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off the list. |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Checkout's ready: 2 items, estimated $8.78. The Instacart button is attached. Tell me the final total once som |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $84.00 for groceries (4 items), paid by Maya. Shares are Maya $32.57, Dev $36.00 and Sam $15.43, so De |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken to the cart as a shared item, estimated at $8.99. It's the only thing in the cart so far. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap to the cart as a shared item, about $3.49. It's the only thing in there so far. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (serves 5, 35 min), set for Friday. Need: 1.75 lb ground beef, 1 yellow onion, 3 cloves garlic, 3  |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 12 items to the shared cart, about $49.24, and I left out the onion. Ground beef, tortillas, and the res |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | They explicitly asked to add, so add.Garlic Tomato Spaghetti for 3, 25 min, 8 steps on the Cart page. I put al |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart page for Tacos for 5. The button's attached. |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's at 12 items, est. $46.82. Dev has oat milk. The rest is shared, from Maya's Tacos for 5: corn tortillas |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Got it, salt and oil are in the pantry. I'll leave them off any recipe lists. |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Oil, rice and salt. Those are the things we always have, so they stay off recipe carts. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. Sam paid $42.00 for groceries (2 items): Maya's part is $22.24 and Dev's is $19.76. |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are they both just for you, or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes done by Dev. Maya's up next. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Want me to log the dishes as done by Dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up for trash. Maya just did it today, and it's due again Sunday. |
| add-chore | chores | act/hard-trigger/chores | chore_add | ✅ |  | Added vacuuming, every 7 days. Rotation is Dev, then Maya, then Sam. |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Logged: Dev took out the trash. Maya's up next. |
| whose-turn-rotation | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up for trash. Maya did it today, and it's due again Saturday. |
| skip-my-turn | chores | act/hard-trigger/chores | chore_skip | ✅ |  | Skipped. Trash goes to Sam now, enjoy your night away. |
| add-chore-rotation | chores | act/hard-trigger/chores | chore_add | ✅ |  | Mopping's on the chart, every 3 days. Rotation is Sam, then Dev, then Maya. |
| the-chart | chores | act/hard-trigger/chores | hall_of_shame | ✅ |  | The chart this week: Sam's at 0, Dev and Maya have 1 each. Sam's got a clear shot at catching up. |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | upkeep_add | ✅ |  | Got it, I'm tracking "Replace AC filter" every 90 days. Tell me when it's changed and I'll reset the clock. |
| maintenance-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Logged. HVAC filter's done, and the next one is due January 27, 2027. Nice work, Dev. |
| air-filter-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Logged, Sam changed the air filter. Next one's due January 27, 2027. |
| whats-due-this-week | upkeep | act/hard-trigger | chore_status,upkeep_status | ✅ |  | Dishes are due today, and it's Dev's turn. Upkeep is all due today too, since none of it's been marked done ye |
| remind-trash-tuesday | reminders | act/hard-trigger/chores | set_reminder | ✅ |  | Done. I'll tell the whole group "Trash goes out" on Tuesday, Nov 3 at 8:00 PM. |
| remind-rent-monthly | reminders | act/hard-trigger/core | set_reminder | ✅ |  | Done. I'll message you privately on Sun Nov 1 at 9:00 AM to pay rent, then monthly on the 1st. You didn't give |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | Done. I'll message Dev privately Friday, Oct 30 at 6:00 PM to pay you back for brunch. |
| weekly-report-verbatim | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793314411019 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00.  |
| setup-india-household | core | act/hard-trigger/core | set_group_settings | ✅ |  | You're set: roommates, INR, India time. Learned Splitting, Groceries, Chores and Upkeep. Say "roomie, what can |
| setup-trip | core | act/hard-trigger/core | set_group_settings | ✅ |  | Trip, EUR, Lisbon time, all set. I learned Splitting and Groceries, so try "I paid 40 for dinner" any time. Sa |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | Just one coming up: "Rent is due" for everyone, Tuesday Nov 3 at 4:54 PM. |
| group-report | core | act/hard-trigger | group_report | ✅ |  | 📋 Group report · Eval group-report 1793314468449 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00. 🛒 The Car |
| members | core | act/hard-trigger/core | list_members | ❌ | reply lacks Dev | It's you, Maya, and Sam, all active. Maya's the admin. |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | I know Splitting ("I paid 60 for internet"), Groceries ("tacos for 5 friday"), Chores ("I did the dishes") and |
| learn-research-not-yet | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Research isn't something I can learn yet. It's on the list, though. |
| learn-chores | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Learned Chores. Try "roomie, I did the dishes" and I'll keep track. |
| forget-groceries-member | core | act/hard-trigger/core | - | ✅ |  | Only admins can make me forget a Trick, and that's Maya here. Ask her and she can turn groceries off. Nothing  |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger/groceries | - | ✅ |  | No problem. Salsa's still not on the list, though. Is it just yours or for the house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, what for, and how much? I'll log it once I have those. |
| vibe-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, split three ways at $20 each, so Dev and Sam each owe Maya $20. |
| vibe-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged! Maya paid $60 for internet, split three ways at $20 each 🎉 Dev and Sam each owe Maya $20 now. Thanks  |
| vibe-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, split three ways: $20 each. Dev and Sam owe Maya $20. |
| name-dino-triggers | personality | act/hard-trigger/groceries | cart_add | ✅ |  | Added oat milk to your side of the cart, about $4.99. It's the only thing in there so far. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and so do you. Maya's up $40.00 total, so Dev wasn't wrong to feel called out. |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 pizza, Dev paid, $10 each. Maya and Sam owe Dev $10 apiece. |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Dev paid $30 for pizza, $10 each for Maya, Dev and Sam, so Maya and Sam each owe Dev $10. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | hey all |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | Mm, that's the spot. Today's been a good one, everyone's square and the house is quiet. |
| remember-vegetarian | personality | act/hard-trigger/core | remember | ✅ |  | Got it, you're vegetarian. I'll keep that in mind for recipes. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | Black Bean and Sweet Potato Tacos for 1, vegetarian, 30 min. You'd need 1 small sweet potato, 1/2 can black be |
| what-do-you-know-about-me | personality | act/hard-trigger/core | what_do_you_know_about_me | ✅ |  | You're vegan and you care about the plant. That's all I've got on you. Say "roomie forget me" if you want it w |
| what-do-you-know-about-others | personality | act/hard-trigger/core | - | ✅ |  | That's Dev's to share, so I can't pass it along. Maya's an admin, so she can ask, or you can ask Dev yourself. |
