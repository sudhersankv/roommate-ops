# Eval baseline

`npm run evals` on 2026-10-29: **80/81 (99%)**, 7.8 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, split three ways at $20 each, so Dev and Sam each owe Maya $20. |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $30 uber paid by Sam, split with Dev, $15 each, so Dev owes Sam $15. |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $90 dinner, you paid, split 50/25/25: you $45.00, Dev $22.50, Sam $22.50. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $41.25 wine and cheese, paid by Maya, split 2:2:1: Maya $16.50, Dev $16.50, Sam $8.25. |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those parts add up to $55, but you paid $50. Did you mean a different total, or should one of the shares chang |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $100 concert tickets, Dev paid $60 and Maya $40. Split three ways: Maya $33.33, Sam $33.33, Dev $33.34 |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the pizza expense ($24.00). Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00. |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle up links will point there now. |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Dev $30.00 and Maya $30.00. Dev owes Maya $30.00. Net, Maya is owed $60.00, Sam owes $60.00, and Dev  |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam owes Maya $60.00. Dev's all square. |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $54 for the water bill, split three ways at $18 each, so Dev and Sam each owe Maya $18. |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Dev owes Maya $20.00. The Venmo pay button's attached. Tell me once you've paid and I'll log it. |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, paid by you. Dev owes $78.65 (steak plus his part of the rest), and you and |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and Sam owes Maya $20.00. Maya's the one in the green. |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Dev owes Maya $20.00 and Sam owes Maya $20.00. Maya's up $40.00 overall. |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged. Dev paid Maya $20, and you two are square now. |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Lately: pizza $24 (Dev, $8 each) and internet $60 (you, $20 each). That's all so far. |
| unknown-name | splitting | act/hard-trigger/splitting | list_members | ✅ |  | Jordan isn't in this group. The members are Dev, Maya and Sam. Did you mean one of them, or does Jordan still  |
| unprompted-pizza-asks-first | splitting | ignore/jev-ignore | - | ❌ | stayed quiet; reply lacks 40; doesn't ask | (quiet) |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Anotado. Uber $30 que pagó Maya, dividido en partes iguales: $10 cada uno. Dev y Sam le deben $10 a Maya. |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs: just for you, or for the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap to the cart as a shared item, est. $3.49. It's the only thing in there so far. |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's got two things, both Dev's: oat milk and 6 bananas. Estimated total is $13.93. |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off the list. |
| checkout-link | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Checkout's ready: 2 items, about $8.78 estimated. Once you've bought it, tell me the total and I'll split it u |
| paid-84-after-checkout | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. Maya paid $84 for groceries (4 items), split by what each person added: Maya $32.57, Dev $36.00, Sam $ |
| add-chicken-for-house | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added 2 lb chicken to the house cart, est. $8.99. That's the only thing in there so far. |
| out-of-dish-soap | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap to the cart as a shared item, about $3.49. It's the only thing in there so far. |
| recipe-tacos-friday | groceries | act/hard-trigger/groceries | recipe_draft | ✅ |  | Tacos for 5 (35 min, Friday). Need: 2 lb ground beef, 1 yellow onion, 3 cloves garlic, 3 tbsp chili powder, 2  |
| recipe-yes-add-them | groceries | act/jev-act/groceries | recipe_add_to_cart | ✅ |  | Added 12 items to the shared cart, about $49.24, and left the onion out. The salt is in there too, so take it  |
| recipe-explicit-add | groceries | act/hard-trigger/groceries | recipe_draft,recipe_add_to_cart | ✅ |  | They asked explicitly to add, so add.Garlic Tomato Spaghetti for 3, 25 min: spaghetti, crushed tomatoes, garli |
| recipe-instacart-link | groceries | act/hard-trigger/groceries | recipe_link | ✅ |  | Here's the Instacart link for the tacos. It's the "Tacos for 5" recipe, and the button's attached. |
| view-cart-recipe | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's at 12 items, about $46.82 estimated. Dev has oat milk. The rest is shared, from Maya's Tacos for 5: cor |
| pantry-set | groceries | act/hard-trigger/groceries | pantry_set | ✅ |  | Got it, salt and oil are in the pantry. I'll leave them off the cart from now on. |
| pantry-list | groceries | act/hard-trigger/groceries | pantry_list | ✅ |  | Pantry's oil, rice and salt. Tell me if anything else should go on there. |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged. Sam paid $42.00 for groceries (2 items). Maya owes Sam $22.24 and Dev owes Sam $19.76. The cart's clea |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are they both just for you, or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes done by Dev, logged. Maya's up next. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Nice work on the dishes. Want me to log that for you, Dev? |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up for trash. Maya just did it today, and it's next due Sunday. |
| add-chore | chores | act/hard-trigger/chores | chore_add | ✅ |  | Added vacuuming to the chart, every 7 days. Rotation is Dev, Maya, then Sam. |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Logged: Dev took out the trash. Maya's up next. |
| whose-turn-rotation | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up for trash. Maya just did it today, and it's due again Saturday. |
| skip-my-turn | chores | act/hard-trigger/chores | chore_skip | ✅ |  | Done, your turn on trash is skipped. Sam's up next. |
| add-chore-rotation | chores | act/hard-trigger/chores | chore_add | ✅ |  | Mopping's on the chart, every 3 days. Rotation is Sam, then Dev, then Maya, so Sam's up first. |
| the-chart | chores | act/hard-trigger/chores | hall_of_shame | ✅ |  | The chart this week: Sam's at 0 so far, Dev and Maya have 1 each. Sam's got a clear runway to catch up. |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | upkeep_add | ✅ |  | Got it, tracking "Replace AC filter" every 90 days. Tell me when it's changed and I'll reset the clock. |
| maintenance-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Logged. HVAC filter's done, and the next one's due January 27, 2027 (every 90 days). |
| air-filter-done | upkeep | act/hard-trigger/upkeep | upkeep_done | ✅ |  | Logged, Sam changed the air filter. Next one's due January 27, 2027. |
| whats-due-this-week | upkeep | act/hard-trigger | chore_status,upkeep_status | ✅ |  | Dishes are due today and it's Dev's turn. On upkeep, five things are all due today and none have ever been mar |
| remind-trash-tuesday | reminders | act/hard-trigger/chores | set_reminder | ✅ |  | Done. I'll remind everyone in the chat Tue Nov 3 at 8:00 PM that trash goes out. |
| remind-rent-monthly | reminders | act/hard-trigger/core | set_reminder | ✅ |  | Done. I'll message you privately on the 1st of every month at 9:00 AM to pay rent. The first one is Sun Nov 1. |
| remind-dev-private | reminders | act/hard-trigger/splitting | set_reminder | ✅ |  | Done. I'll ping Dev privately Friday, Oct 30 at 6:00 PM to pay you back for brunch. |
| weekly-report-verbatim | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval weekly-report-verbatim 1793263215053 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00.  |
| setup-india-household | core | act/hard-trigger/core | set_group_settings | ✅ |  | Done: roommates, INR, India time. Splitting, Groceries, Chores and Upkeep are all on, with 3 starter chores an |
| list-reminders | reminders | act/hard-trigger/core | list_reminders | ✅ |  | Just one so far: "Rent is due" for everyone, Tue Nov 3 at 2:40 AM. Set by you. |
| group-report | core | act/hard-trigger/core | group_report | ✅ |  | 📋 Group report · Eval group-report 1793263254969 💸 Dev pays Maya $20.00 and Sam pays Maya $20.00. 🛒 The Car |
| members | core | act/hard-trigger/core | list_members | ✅ |  | It's Dev, Maya and Sam, and all three of you are active. Maya's the admin. |
| what-can-you-do | core | act/hard-trigger/core | list_toolkits | ✅ |  | Lots, honestly. I split costs ("I paid 60 for internet"), keep the grocery cart ("add milk and eggs"), track c |
| turn-on-research | core | act/hard-trigger/core | toggle_toolkit | ✅ |  | Research isn't available yet, Maya. It's on the list, but I can't switch it on. Splitting, groceries, chores a |
| groceries-off-member | core | act/hard-trigger/groceries | toggle_toolkit | ✅ |  | Only admins can switch Toolkits, and Maya's the admin here. Ask her and she can turn Groceries off. |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | No problem. Salsa's still not in the cart though. Is it just for you or for the house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, and how much for what? Once I have that I can log it for yesterday. |
| vibe-chill | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Maya paid $60 for internet, split three ways, $20 each. Dev and Sam owe Maya $20 apiece. |
| vibe-hype | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged! Maya paid $60 for internet, split three ways at $20 each 🎉 Dev and Sam, you owe Maya $20 apiece 💸 |
| vibe-deadpan | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. $60 internet, paid by Maya. $20 each, so Dev and Sam owe her $20. |
| name-dino-triggers | personality | act/hard-trigger/groceries | cart_add | ✅ |  | Added oat milk to your side of the cart, about $4.99. It's the only thing in there so far. |
| nickname-not-before-3 | personality | act/hard-trigger/splitting | get_balances | ✅ |  | Dev owes Maya $20.00, and you owe Maya $20.00 too. Maya's the one who's owed, at +$40.00. |
| slang-low-confidence | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Dev paid $30 for pizza, split three ways at $10 each, so Maya and Sam owe Dev $10 apiece. Glad it was  |
| slang-budget-spent | personality | act/hard-trigger/splitting | log_expense | ✅ |  | Logged. Dev paid $30 for pizza, split three ways at $10 each, so Maya and Sam each owe Dev $10. |
| greeting-first-message | personality | ignore/jev-ignore | - | ✅ |  | evening all |
| greeting-once-a-day | personality | ignore/jev-ignore | - | ✅ |  | (quiet) |
| pet-command | personality | act/hard-trigger | - | ✅ |  | Ah, that's the spot. Everyone's square right now, so I've mostly been lying here feeling smug about it. Also,  |
| remember-vegetarian | personality | act/hard-trigger/core | remember | ✅ |  | Got it, Maya's vegetarian. I'll keep that in mind for recipes. |
| recipe-respects-diet | personality | act/hard-trigger/groceries | recipe_draft | ✅ |  | Chickpea Spinach Coconut Curry for 1, vegetarian and about 30 min. You'll need olive oil, onion, garlic, ginge |
| what-do-you-know-about-me | personality | act/hard-trigger/core | what_do_you_know_about_me | ✅ |  | You're vegan and you care about the plant. That's all I've got on you. Say "roomie forget me" if you want it w |
| what-do-you-know-about-others | personality | act/hard-trigger/core | - | ✅ |  | That's Dev's to share, so I can't pass it along. Ask Dev directly. Maya's an admin, but I only keep that kind  |
