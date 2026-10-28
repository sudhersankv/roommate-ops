# Eval baseline

`npm run evals` on 2026-10-28: **44/44 (100%)**, 6.5 s per scenario on average.
Agent `claude-sonnet-5-5`, Gate `typesafeai-jev-1-14-0` (normal Chattiness), through the Neon AI Gateway.
Scenarios are in `src/mastra/evals/scenarios.ts`; gate = decision/reason/toolkit, tools = what the agent called.

| scenario | area | gate | tools | pass | why | reply |
|---|---|---|---|---|---|---|
| split-basic | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $60 internet, Maya paid, split 3 ways, $20 each 💸 |
| split-subset | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $30 uber, Sam paid, split with Dev. Dev owes Sam $15.00 🚕 |
| split-uneven-50-25-25 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $90 dinner, Maya paid. Maya's share is $45.00 (steak tax 🥩), Dev and Sam owe $22.50 each. |
| split-shares-2-2-1 | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $41.25 wine and cheese, Maya paid. Split 2:2:1, so Maya $16.50, Dev $16.50, Sam $8.25 🧀🍷 |
| split-exact-doesnt-add-up-asks | splitting | act/hard-trigger/groceries | - | ✅ |  | Those shares don't add up to $50 (30 + 15 + 10 is $55), so one of the numbers is off. Can you check them? I al |
| multi-payer | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $100 concert tickets 🎟️ Dev paid $60, Maya paid $40, split three ways. Maya and Sam owe $33.33 each,  |
| delete-expense | splitting | act/hard-trigger/splitting | delete_expense | ✅ |  | Deleted the $24.00 pizza expense. Say "undo" if you want it back. |
| delete-then-undo | splitting | act/hard-trigger/splitting | restore_expense | ✅ |  | Pizza's back, $24.00 restored 🍕 |
| set-venmo | core | act/hard-trigger/splitting | set_payment_handle | ✅ |  | Done, your Venmo is set to @maya. Settle-up links will point there now 💸 |
| owes-pairwise-simplify-off | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam, you're down $60.00: $30.00 to Dev and $30.00 to Maya. Dev owes Maya $30.00 but is owed $30.00 by you, so  |
| owes-simplified | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Sam, you owe Maya $60.00. Dev's all square. Want the pay buttons? |
| category-utilities | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Logged: $54 water bill, Maya paid, split 3 ways, $18 each 💧 |
| settle-up-pay-links | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | You owe Maya $20.00. The Venmo button is attached, so you can pay her there 💸 Tell me once you've sent it and |
| receipt-photo | splitting | act/hard-trigger/splitting | expense_from_receipt | ✅ |  | Logged Luigi's Trattoria, $137.97, and you paid. Dev owes $78.65 (steak plus his third of the rest), and you a |
| owes-named | splitting | act/hard-trigger/splitting | get_balances | ✅ |  | Maya is owed $40.00 total. You owe Maya $20.00, and Sam owes Maya $20.00. Say "settle up with Maya" if you wan |
| owes-unaddressed-question | splitting | act/jev-act/splitting | get_balances | ✅ |  | Maya's owed $40.00 total: Dev owes her $20.00 and you owe her $20.00. Say "settle up with Maya" when you're re |
| settle-up | splitting | act/hard-trigger/splitting | settle_up | ✅ |  | Logged: Dev paid Maya $20.00. You two are square now ✅ |
| list-expenses | splitting | act/hard-trigger/splitting | list_expenses | ✅ |  | Just two so far, both today: pizza $24.00 (Dev paid) and internet $60.00 (you paid). Both split three ways 🍕 |
| unknown-name | splitting | act/hard-trigger/splitting | list_members | ✅ |  | Jordan isn't in this group. I only have Dev, Maya and Sam. Did you mean one of them, or is Jordan someone new  |
| unprompted-pizza-asks-first | splitting | act/jev-act/splitting | - | ✅ |  | Want me to log $40 for pizza, Dev paid, split equally 3 ways (Dev, Maya, Sam)? 🍕 |
| spanish | splitting | act/hard-trigger/splitting | log_expense | ✅ |  | Listo: Uber $30 pagado por Maya, dividido en 3, $10 cada uno 🚗 |
| add-milk-eggs | groceries | act/hard-trigger/groceries | - | ✅ |  | Milk and eggs for you, or for the whole house? |
| add-shared | groceries | act/hard-trigger/groceries | cart_add | ✅ |  | Added dish soap as a shared item, about $3.49. It's the only thing in the cart so far 🧼 |
| view-cart | groceries | act/hard-trigger/groceries | cart_view | ✅ |  | Cart's got Dev's 6 bananas and 1 oat milk, about $13.93 total (estimated). Nothing from you or the shared pile |
| remove-item | groceries | act/hard-trigger/groceries | cart_remove | ✅ |  | Milk's off the list ✅ |
| checkout-coming-soon | groceries | act/hard-trigger/groceries | cart_checkout | ✅ |  | Instacart checkout isn't live yet, so you'll need to buy it yourselves. The cart has 1 item, estimated at $4.4 |
| cart-purchased | groceries | act/hard-trigger/groceries | cart_purchased | ✅ |  | Logged: $42 groceries (2 items), Sam paid. Maya owes $22.24 and Dev owes $19.76, and the cart's cleared 🛒 |
| follow-up-window-chips | groceries | maybe/follow-up/groceries | - | ✅ |  | Got it, salsa and 2 bags of chips. Are they both just for you, or for the whole house? |
| did-dishes | chores | act/hard-trigger/chores | log_chore | ✅ |  | Dishes done by Dev ✨ That's streak 1, so keep it going. |
| did-dishes-unprompted-asks | chores | act/jev-act/chores | - | ✅ |  | Nice work, Dev. Want me to log the dishes as done by you? ✨ |
| whose-turn | chores | act/hard-trigger/chores | chore_status | ✅ |  | Dev's up. Maya just took it out today, and it's next due Saturday (every 3 days). |
| add-chore | chores | act/hard-trigger/chores | add_chore | ✅ |  | Vacuuming is on the chart, every 7 days 🧹 Who's up first? |
| chore-for-someone-else | chores | act/hard-trigger/chores | log_chore | ✅ |  | Trash logged for Dev ✨ That's a streak of 1. |
| track-ac-filter | upkeep | act/hard-trigger/upkeep | add_maintenance | ✅ |  | Tracking it: AC filter, every 90 days. Tell me when it's changed and I'll reset the clock. 🧰 |
| maintenance-done | upkeep | act/hard-trigger/upkeep | maintenance_done | ✅ |  | Marked done: HVAC filter replaced today, thanks Dev 🙌 |
| remind-trash-tuesday | reminders | act/hard-trigger | set_reminder | ✅ |  | Done. Tuesday, Nov 3 at 8:00 PM: trash out, everyone 🗑️ |
| list-reminders | reminders | act/hard-trigger/reminders | list_reminders | ✅ |  | Just one coming up: "Rent is due" on Monday, Nov 2 at 4:15 PM, for everyone. |
| group-report | core | act/hard-trigger | group_report | ✅ |  | 📣 Group report 💸 Dev pays Maya $20.00 💸 Sam pays Maya $20.00 🧹 No chores on the chart yet. ⏰ Nothing sched |
| members | core | act/hard-trigger | list_members | ✅ |  | It's Dev, Maya, and Sam, and all three of you are active. Maya's the admin 👑 |
| chatter-game | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| chatter-see-you | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| window-chatter-stays-quiet | gate | ignore/jev-ignore | - | ✅ |  | (quiet) |
| thanks-roomie | gate | act/hard-trigger | - | ✅ |  | Anytime! Salsa isn't in the cart yet, though. Is it just for you or for the whole house? |
| vague-clarifies | gate | clarify/jev-clarify/splitting | - | ✅ |  | Who paid, for what, and how much? Give me those and I'll get it logged. |
