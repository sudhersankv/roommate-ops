# dev-chat: a pretend WhatsApp group

`npm run dev-chat` runs a group chat in the terminal through the real pipeline: the Gate (Jev), the Roomie agent, its tools and the dev Channel adapter (`src/channels/dev.ts`). Group posts print as `[Roomie]`, private 1:1 messages as `[Roomie -> Name, private]`, and every reply shows the Gate decision and the tools called. It's how Onboarding, approvals and Claim links get tested until the WhatsApp adapter exists (step 2).

```
join <adder> [others...]    Roomie is added by <adder>; <others> were already in the chat
add <name>                  someone joins later: Pending, and Roomie asks the Admins
say <name> <text>           a chat message (quotes optional)
approve <name> [by <admin>] approve directly, without the agent
link <name>                 mint a Claim link and print it
who                         Members with role and status
chat <id>                   switch to another dev Chat
quit
```

Flags: `--chat <id>` attaches to an existing dev Chat (the seed's Apt 4B is `dev-apt-4b`), `--cleanup` deletes the Group on exit. Lines can be piped in, and `#` starts a comment:

```powershell
Get-Content walk.txt | npm run dev-chat -- --chat walk-1
```

Claim links point at `APP_URL`; open one in the browser while `npm run dev` runs to connect your Google account to that Member.

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
