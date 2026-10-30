# Joining a Group's dashboard: the Admin's setup DM, one Join link per Group, seats, and the Admin's approval

Claim links (ADR 0003) bind a Google Account to exactly one Member and stay the only way to bind *precisely*. But as the only
door they failed the first real groups: people had to know to ask Roomie, the Admin posted their own dashboard button and
others got a 404, and a Claim link used on a laptop "didn't work" on a phone. Joining becomes a flow Roomie drives:

1. **The Admin's setup DM.** When Roomie is added, the adder (the first Admin) gets a private message right away with their
   Claim link and the setup question. On WhatsApp this goes out immediately. On Telegram a bot cannot message first, so the
   intro keeps its one line ("tap @bot and press Start"), and the DM goes out the moment they do.
2. **One Join link per Group, posted once.** When setup finishes, Roomie posts the Group's Join link in the chat:
   `APP_URL/j/<code>` (a short, random, revocable code; the same code is the Group's stable "dashboard, always available"
   address). This supersedes ADR 0001's "never post links in the group": the Join link binds nobody by itself, so it is
   safe to share with the people who can already read the chat.
3. **Seats.** Opening a Join link means signing in with Google, then picking **which one you are** from the roster of
   unclaimed seats (display name; on WhatsApp a name when known, else the number with its middle hidden). A pick connects
   instantly when the seat is unclaimed and the Group still has free seats (claimed Accounts < people in the chat).
   Otherwise (a claimed seat, or more sign-ins than people) the person becomes **Pending** and an Admin approves them
   from the dashboard's Members page or in the chat ("roomie approve Sam"). Admins can reassign or revoke a seat and
   rotate the Join link any time; a Group can be set to **approve every join** in Settings.
4. **Stateless sign-in.** Signing in from any device is enough once an Account is connected: `/app` lists every Group
   the Account is in. A used Claim link offers "sign in with the same account"; it never dead-ends.
5. **Claim links stay** as the fallback ("roomie, send me the dashboard") and as the exact-binding path.

## Consequences

- Anyone in the chat can pick someone else's unclaimed seat. They can already read everything in that chat, every seat
  shows who connected to it, Admins can revoke, and money entries record the acting Account. Groups that want more
  friction turn on "approve every join".
- The Join link is a shared secret with the power to create a Pending member. Codes are 8+ base32 chars from
  `crypto.randomBytes`, rotate on demand, and are rate-limited per IP on the picker.
- A Group's Join link is also its short dashboard address, so WhatsApp (no buttons) gets one short URL instead of a UUID.
- Roster counts come from the channel (WhatsApp participants, Telegram's member count where available); when a channel
  cannot count, the free-seat rule falls back to "approve every join".

## Considered options

- **Keep Claim links only:** exact, private, and what the first groups tripped over. Rejected as the only door.
- **DM every Member a Claim link when Roomie joins (bulk links):** spammy on WhatsApp (ban risk) and impossible on
  Telegram. Rejected.
- **Match by phone number:** Google gives no phone number; WhatsApp gives no email. Nothing to match on.
- **Approve every join by default:** safest, but the Admin becomes a bottleneck for a 5-person flat. Made optional.
