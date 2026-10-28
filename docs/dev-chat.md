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
