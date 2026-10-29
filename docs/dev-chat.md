# dev-chat: a pretend WhatsApp group

`npm run dev-chat` runs a group chat in the terminal through the real pipeline: the Gate (Jev), the Roomie agent, its tools and the dev Channel adapter (`src/channels/dev.ts`). Group posts print as `[Roomie]`, private 1:1 messages as `[Roomie -> Name, private]`, and every reply shows the Gate decision and the tools called. It's how Onboarding, approvals and Claim links get tested until the WhatsApp adapter exists (step 2).

```
join <adder> [others...]    Roomie is added by <adder>; <others> were already in the chat
add <name>                  someone joins later: Pending, and Roomie asks the Admins
say <name> <text>           a chat message (quotes optional)
photo <name> <path|url> [caption]   a photo (a receipt): saved under public/uploads/dev/, sent with the caption
approve <name> [by <admin>] approve directly, without the agent
link <name>                 mint a Claim link and print it
ledger [n]                  the last n Expenses in cents (method, Payers, Shares) and the Balances, from the services
cart [total]                open Cart items; with a total, the Shares "Maya paid <total>" would save
who                         Members with role and status
chat <id>                   switch to another dev Chat
quit
```

Flags: `--chat <id>` attaches to an existing dev Chat (the seed's Apt 4B is `dev-apt-4b`), `--cleanup` deletes the Group on exit. Lines can be piped in, and `#` starts a comment:

```powershell
Get-Content walk.txt | npm run dev-chat -- --chat walk-1
```

Claim links point at `APP_URL`; open one in the browser while `npm run dev` runs to connect your Google account to that Member.

Splitwise: when `COMPOSIO_API_KEY` is missing or Composio rejects it, dev-chat says so once and uses the in-memory Splitwise (`FakeSplitwise`: groups "Apt 4B (Splitwise)" with Maya, Dev, Sam and Jordan, and "Tahoe weekend"). The fake connects instantly.

## Walkthrough (recorded 2026-10-28)

Step 4's done-criteria in one run: Onboarding, settings applied by a tool, a Pending member refused and then approved, a private Claim link, and "forget me".

```
> join Maya Dev Sam
(Group 8f724e64-… created; Maya admin/active, Dev member/active, Sam member/active)
[Roomie] Hey all, I'm Roomie 👋 Maya added me, so Maya's my admin. I split costs, keep a shared Cart and track chores.
         Quick setup, one reply is plenty: what's this group for (roommates, a trip, friends, family, work), which
         currency, and which time zone? Just "roommates" works too: I'll go with USD, Chicago time and switch everything on.

> say Maya "roommates, USD, Chicago"
         (gate act/hard-trigger, tools set_group_settings, 19.0s)
[Roomie] You're all set: roommates, USD, Chicago time. Splitting, groceries, chores and upkeep are all on 🏠

> add Priya
(Priya is pending)
[Roomie] Welcome, Priya 👋 Maya: approve Priya? Say "roomie approve Priya". Until then I'll chat, but I won't log anything for them.

> say Priya "I paid 20 for pizza"
         (gate maybe/follow-up, 9.7s)
[Roomie] Can't log that yet, Priya. You're still waiting on approval, so I'm not logging anything for you. Maya's the
         admin and can say "roomie approve Priya". Once she does, send the pizza $20 again and I'll add it 🍕

> say Maya "approve Priya"
         (gate act/jev-act, tools approve_member, 9.6s)
[Roomie] Priya's in ✅ Send the pizza $20 again and I'll log it.

> say Priya "I paid 20 for pizza"
         (gate act/jev-act, tools log_expense, 9.5s)
[Roomie] Logged: $20 pizza, Priya paid, split 4 ways, $5 each 🍕

> say Priya "send me the dashboard"
[Roomie -> Priya, private] Here's your link to the group's dashboard. It works once and expires in 24 hours.
         [button] Open dashboard -> http://localhost:3000/claim/yx_U0Q…
         (gate act/jev-act, tools get_dashboard_link, 10.3s)
[Roomie] Sent you a private sign-in link in a 1:1 message, Priya. It's single-use and expires in 24 hours.

> say Dev "roomie forget me"
         (gate act/hard-trigger, tools forget_me, 12.0s)
[Roomie] Done, Dev. I've deleted your chat history and your member note. Your expenses and shares stay, so the
         balances still add up.

> who
  Maya         admin   active
  Dev          member  active
  Sam          member  active
  Priya        member  active
```

Notes:

- "roommates, USD, Chicago" doesn't say "roomie". While Onboarding is open (the Group has no settings yet), an active Member's reply in the follow-up window after Roomie's question counts as addressed (`pipeline.ts`).
- Priya's first "I paid 20 for pizza" came through the follow-up window, and the agent declined from its instructions without calling a tool. When it does call `log_expense`, the service refuses (`services/authz.ts`) and the tool returns the reason as text; `npm run test:tools` covers that path.
- The Claim link only ever goes out in a private message (ADR 0003); in the group chat Roomie just says where it went.

## Step 5 walkthrough: splitting (recorded 2026-10-28)

`Get-Content walk5.txt | npm run dev-chat -- --chat walk-5c`, on a fresh Group (Maya, Dev, Sam; Onboarding answered with "roommates, USD, Chicago"). `ledger` prints what the services stored, in cents. Composio's key is rejected, so Splitwise is the in-memory fake. Replies trimmed to the interesting part; gate/tool lines kept.

```
> say Maya "roomie $90 dinner, I paid. I had the steak so 50/25/25"
         (gate act/hard-trigger, tools log_expense, 10.6s)
[Roomie] Logged: $90 dinner, Maya paid. Split 50/25/25, so Maya $45, Dev and Sam $22.50 each 🥩
> say Maya "roomie $41.25 for wine and cheese, I paid, split 2:2:1 between me, Dev and Sam"
         (gate act/hard-trigger, tools log_expense, 7.2s)
[Roomie] Logged: $41.25 wine and cheese, Maya paid. Maya $16.50, Dev $16.50, Sam $8.25 🧀
> say Maya "roomie concert tickets were $100, Dev paid 60 and I paid 40, split three ways"
         (gate act/hard-trigger, tools log_expense, 6.9s)
[Roomie] Logged: $100 concert tickets, Dev paid $60 and Maya $40, split 3 ways. Dev $33.34 (the extra penny), Maya and Sam $33.33 each 🎟️
> ledger 3
  2026-10-28 concert tickets 10000c [equal, entertainment] paid: Dev 6000 + Maya 4000 | shares: Maya 3333, Dev 3334, Sam 3333
  2026-10-28 wine and cheese 4125c [shares, groceries] paid: Maya 4125 | shares: Maya 1650 (2), Dev 1650 (2), Sam 825 (1)
  2026-10-28 dinner 9000c [percent, food] paid: Maya 9000 | shares: Maya 4500 (50), Dev 2250 (25), Sam 2250 (25)
  balances: Maya 7642, Dev -1234, Sam -6408

> say Dev "roomie I paid 24 for pizza"
[Roomie] Logged: $24 pizza, Dev paid, split 3 ways, $8 each 🍕
> say Maya "roomie delete the pizza expense"
         (gate act/hard-trigger, tools delete_expense, 6.0s)
[Roomie] Deleted the $24 pizza. Say "undo" if that was a mistake.
> say Maya "undo"
         (gate act/jev-act, tools restore_expense, 6.9s)
[Roomie] Pizza's back: $24, Dev paid, $8 each 🍕

> say Dev "roomie set my cashapp to $dev"
         (gate act/hard-trigger, tools set_payment_handle, 7.0s)
[Roomie] Saved your Cash App as $dev, Dev. Settle-up links will use it 💸
> say Maya "roomie my venmo is @maya-r and my paypal is mayar"
         (gate act/hard-trigger, tools set_payment_handle,set_payment_handle, 7.4s)
[Roomie] Saved Maya: Venmo @maya-r and PayPal mayar. Settle-up links are good to go 💸
> say Maya "roomie settle up with Sam"
         (gate act/hard-trigger, tools settle_up, 6.7s)
[Roomie] Sam owes Maya $68.42. Pay buttons for Venmo and PayPal are attached. Nothing's recorded until someone says it's paid 💸
         [button] Pay Maya on Venmo -> https://venmo.com/u/maya-r?txn=pay&amount=68.42&note=Dev%20chat
         [button] Pay Maya on PayPal -> https://paypal.me/mayar/68.42

> photo Maya C:\...\receipts\luigis.jpg "roomie log this receipt, I paid. The steak was Dev's, the wine we all shared"
[Maya] (photo http://localhost:3000/uploads/dev/<uuid>.jpg) roomie log this receipt, ...
         (gate act/hard-trigger, tools expense_from_receipt, 10.3s)
[Roomie] Logged: Luigi's Trattoria, $137.97, Maya paid. Dev owes $78.65 (steak plus his share), and Maya and Sam owe $29.66 each. The pizza, salad and tiramisu weren't claimed, so I split them three ways with the wine 🍷

> say Maya "roomie turn off simplify debts"
         (gate act/hard-trigger, tools set_simplify_debts, 6.3s)
[Roomie] Simplify debts is off, so settling is now pairwise. Dev owes Maya $109.65, Sam owes Maya $67.08, and Sam owes Dev $34.66.

> say Maya "roomie connect splitwise"
         (gate act/hard-trigger, tools splitwise_connect,splitwise_status, 7.9s)
[Roomie] Splitwise is connected. I can see two groups: "Apt 4B (Splitwise)" and "Tahoe weekend". ...
> say Maya "roomie import our old Apt 4B group from splitwise"
         (gate act/hard-trigger, tools splitwise_import, 9.0s)
[Roomie] Imported Apt 4B: 3 expenses and 1 settlement. It also brought in a new person, Jordan Lee, and skipped 1 deleted expense. ...
         [button] See expenses -> http://localhost:3000/g/<id>/money?tab=expenses
> say Maya "roomie copy our expenses to splitwise"
         (gate act/hard-trigger, tools splitwise_export, 9.8s)
[Roomie] Copied 5 expenses over to Apt 4B on Splitwise, with no settlements to add and nothing skipped. ...
  balances: Maya 21573, Jordan Lee -1600, Dev -9199, Sam -10774
```

Notes:

- The receipt is a real photo read by `claude-sonnet-5-5` on the gateway (`services/receipts.ts`): items, tax $10.97 and tip $20.00 came back as printed strings; the total ($137.97) was recomputed from them. Dev's $78.65 is the steak plus a third of the shared items, with tax and tip spread by each person's items. "Log this receipt" was explicit, so it logged straight away; otherwise Roomie shows the breakdown and asks.
- "Two handles in one message" is two parallel `set_payment_handle` calls; they're merged in SQL, so both stick.
- Importing the fake Splitwise group matched Maya, Dev and Sam by name and added Jordan Lee as a Pending member, so the Balances include Jordan's -$16.00.

### Chat vs dashboard, to the cent

The same inputs typed into the dashboard's add-expense drawer on Apt 4B (`npx next dev -p 3400`, `DEV_AUTH_EMAIL`, headless Chrome) saved:

| Input | dev-chat (`ledger`) | dashboard (DB) |
|---|---|---|
| $90, Maya paid, Maya 50% / Dev 25% / Sam 25% | Maya 4500, Dev 2250, Sam 2250 | Maya 4500, Dev 2250, Sam 2250 (weights 50/25/25) |
| $41.25, shares Maya 2 / Dev 2 / Sam 1 | Maya 1650, Dev 1650, Sam 825 | Maya 1650, Dev 1650, Sam 825 (weights 2/2/1) |
| $100, Dev paid 60 + Maya 40, equal | Dev 3334, Maya 3333, Sam 3333 | (seed "Costco restock", Sam 60 + Maya 40: Sam 3334, Maya 3333, Dev 3333) |

Editing the 2:2:1 Expense to $50 kept the method (the drawer opened on Shares with 2/2/1) and re-split it 2000/2000/1000. Delete showed the Undo toast and Undo brought it back. Screenshots: `design/screens/real-money-*.jpeg`.

## Step 6: a Recipe, the Cart, the Instacart link and "I paid" (Apt 4B)

`npm run seed:demo`, then `npx tsx scripts/dev-chat.ts --chat dev-apt-4b` (Composio's key is rejected, so Splitwise and Instacart are on their fakes). The seed already has a Pantry (salt, oil, rice) and a "Tacos for 5" Recipe; this run writes a new one.

```
> say Maya roomie tacos for 5 on friday
         (gate act/hard-trigger, tools recipe_draft, 16.4s)
[Roomie] Tacos for 5, Friday, 30 min. Need: 1.5 lb ground beef, 15 corn tortillas, yellow onion, garlic, chili powder,
         cumin, 3 roma tomatoes, romaine, 8 oz cheddar, 3 limes, cilantro, and sour cream. We've already got salt and oil.
         The 9 steps are on the Cart page 🌮
         Add the 12 missing ingredients to the cart?
         [button] 🥘 See the recipe -> http://localhost:3000/g/<id>/cart?recipe=<recipe id>

> say Maya yes add them, we have onions
         (gate act/jev-act, tools recipe_add_to_cart, 7.3s)
[Roomie] Added 11 items to the shared cart, skipping the onion. That comes to about $44.55 🛒 Say the word when you
         want to check out.
         [button] 🛒 View cart -> http://localhost:3000/g/<id>/cart

> say Dev roomie add 2 lb chicken for the house
         (gate act/hard-trigger, tools cart_add, 6.1s)
[Roomie] Added 2 lb chicken to the shared cart, about $8.99. The cart's at 19 items, about $103.76 total.

> say Sam roomie checkout
         (gate act/hard-trigger, tools cart_checkout, 6.0s)
[Roomie] Checkout's ready: 19 items, about $103.76 estimated. Tap the Instacart button to order. Once someone pays,
         tell me the total and I'll split it 🧾
         [button] 🛒 Open in Instacart -> https://instacart.example/lists/419779d4

> cart 84
  ... 19 items: the seed's 7, 11 "Tacos for 5" items (shared), Dev's chicken (shared)
  if Maya paid 8400c: Maya 2975, Dev 2773, Sam 2652

> say Maya roomie I paid 84 for groceries
         (gate act/hard-trigger, tools cart_purchased, 11.7s)
[Roomie] Logged: $84.00 groceries, Maya paid. Shares: Dev $27.73, Sam $26.52, Maya $29.75. Cart's cleared 🧾
         [button] See the expense -> http://localhost:3000/g/<id>/money/<expense id>

> ledger 1
  2026-10-28 Groceries (19 items) 8400c [exact, groceries] paid: Maya 8400 | shares: Dev 2773, Sam 2652, Maya 2975
  balances: Maya 9675, Sam -3902, Dev -5773

> say Dev roomie what do we always have?
         (gate act/hard-trigger, tools pantry_list, 5.8s)
[Roomie] Pantry has cumin, oil, olive oil, and salt 🧂
```

Notes:

- The Recipe was written by `claude-sonnet-5-5` for 5 and saved, planned for Friday; nothing went into the Cart until "yes add them". Salt and the oil were left out by the Pantry, the onion by "we have onions".
- The checkout recorded a `cart_checkouts` row with the fake shopping-list link; "I paid 84" marked it paid with the new Expense's id. Balances moved from Maya +$42.50 / Dev -$30.00 / Sam -$12.50 by exactly the Shares.
- Between the checkout and "I paid", the dashboard's Cart (`npx next dev -p 3500`, `DISABLE_SCHEDULER=1`, `DEV_AUTH_EMAIL`, headless Chrome) showed the 11 items under "From Tacos for 5", the Get Instacart link button disabled with "Composio rejected COMPOSIO_API_KEY", and the "I paid" drawer at $84 previewed Dev $27.73, Maya $29.75, Sam $26.52: the same cents as `cart 84` and the saved Expense. On the same page the New recipe sheet drafted "Shakshuka for 3" through Sonnet (10 need, olive oil and salt have), and the Pantry chips took "cumin, olive oil" and dropped rice (hence the last line). Screenshots: `design/screens/real-cart-*.jpeg`.

## Walkthrough: the group pet (recorded 2026-10-28)

The personality branch end to end: the new intro, the default chill voice, the same question after switching the vibe to hype, a new name that works as a trigger, "remember I'm vegetarian" shaping a recipe later, `/pet`, and what Roomie knows about you.

```
> join Maya Dev Sam
[Roomie] Hey all, I'm Roomie, your group's new pet 🦖 Maya added me, so Maya's my admin. I split costs, keep a
         shared Cart, track chores, and slowly pick up how you all talk.
         Quick setup, one reply is plenty: what's this group for (roommates, a trip, friends, family, work), which
         currency, which time zone, and what vibe should I have (chill / hype / deadpan / mom / gremlin / butler)? Just
         "roommates" works too: I'll go with USD, Chicago time, chill, and switch everything on.

> say Maya "roommates, USD, Chicago"
         (gate act/hard-trigger, tools set_group_settings, 10.0s)
[Roomie] all set: roommates, USD, Chicago time, chill vibe. splitting, groceries, chores and upkeep are all on.

> say Maya "roomie I paid $60 for internet"
         (gate act/hard-trigger, tools log_expense, 6.6s)
[Roomie] logged. maya paid $60 for internet, $20 each for maya, dev and sam.

> say Dev "roomie who owes what?"
         (gate act/hard-trigger, tools get_balances, 5.5s)
[Roomie] dev owes maya $20 and sam owes maya $20. maya's up $40 total.

> say Maya "roomie switch your vibe to hype"
         (gate act/hard-trigger, tools set_group_settings, 6.3s)
[Roomie] vibe switched to hype! let's gooo 🎉

> say Dev "roomie who owes what?"
         (gate act/hard-trigger, tools get_balances, 5.5s)
[Roomie] Same as before! Dev owes Maya $20 and Sam owes Maya $20. Maya's up $40 🎉 Dev, want the pay buttons?

> say Maya "roomie from now on your name is Dino"
         (gate act/hard-trigger, tools set_group_settings, 6.5s)
[Roomie] Dino it is! 🦖 Love it, Maya. Name's locked in ✨

> say Sam "dino add oat milk for me"
         (gate act/hard-trigger, tools cart_add, 6.0s)
[Roomie] Oat milk's in the cart for you, Sam! 🥛 Est. $4.99, and that's the whole cart so far ✨

> say Maya "dino remember I'm vegetarian"
         (gate act/hard-trigger, tools remember, 7.1s)
[Roomie] Got it, Maya, you're vegetarian! 🌱 I'll keep that in mind for recipes.

> say Maya "dino write me a dinner recipe for tonight, just for me"
         (gate act/hard-trigger, tools recipe_draft, 12.4s)
[Roomie] Tonight's a Vegetarian Black Bean Quesadilla for 1, Maya! 🌮 20 minutes, 8 easy steps. You need tortillas,
         black beans, cheddar, bell pepper, red onion, corn, cumin, olive oil, lime, salsa and sour cream. Full steps are on
         the recipe page 🎉
         Want me to add the 11 missing ingredients to the cart, just for you or for the whole house?

> say Dev "/pet"
         (gate act/hard-trigger, 5.9s)
[Roomie] Aww, thanks Dev!! 🦖 Today's been a good one: I got a new name, Maya's quesadilla plan sounds delicious,
         and Sam's oat milk is waiting in the cart 🥛✨

> say Maya "dino what do you know about me?"
         (gate act/hard-trigger, tools what_do_you_know_about_me, 6.4s)
[Roomie] Here's what I've got on you, Maya: you're vegetarian 🌱 That's all so far!
```

Notes:

- The same "who owes what?" came back lowercase and dry under chill, and with exclamation marks and emoji under hype; the numbers came from `get_balances` both times.
- "dino ..." never says "roomie": the Group's name for its pet is a hard trigger (`callsPet`), next to "roomie" and the @mention.
- `remember` saved `diet: vegetarian` to Maya's Member note; the instructions' "what you know about people" block made the recipe request vegetarian without being told again.
- No greeting on the join day: Roomie had already posted its intro. On a later day the first message gets one line in the pet's voice (`services/pet.ts`).
- The dashboard's Settings -> Personality (headless Chrome, `DEV_AUTH_EMAIL`, `DISABLE_SCHEDULER=1`): an Admin picks a vibe and the preview line changes at once ("Dev owes you $30! Pay day incoming! 🎉💸" for hype, "Dev owes you $30. He knows." for deadpan); a Member sees the same section read-only, with no reset button. Screenshots: `design/screens/real-personality-*.jpeg`.
