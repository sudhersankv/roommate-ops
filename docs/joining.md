# Joining a Group's dashboard

How people get from the group chat to the dashboard ([ADR 0014](./adr/0014-joining-a-group-dashboard.md)). Code:
`src/services/joins.ts` (the rules), `src/onboarding.ts` (the setup DM), `src/app/j/[code]/` (the picker),
`src/toolkits/core/dashboard.ts` (the chat tools), the Members page and Settings → Joining.

## The flow

1. **Roomie is added.** The adder is the first Admin. Besides the intro in the group, they get a private **setup DM**:

   > Hi Maya 👋 You added me to Apt 4B, so you're its admin. Your own dashboard link is below (just for you, it works once).
   > Answer the setup here or in the group: what's the group for, currency, city, vibe.

   with their Claim link as a button (on WhatsApp a last line `Open dashboard — https://...`).
   - **WhatsApp** sends it at once (Roomie can message anyone).
   - **Telegram** can't message first: Roomie tries (it works if they pressed Start for Roomie before), else the intro
     keeps "tap @bot and press Start, so I can DM you the setup and your dashboard link", and `/start` sends the setup
     DM to an Admin of a Group that hasn't finished setup (`setupDmFor`). Anyone else gets the usual `/start` line.
2. **Setup is answered**, in the DM or in the group (`set_group_settings`). The result's `say` is two lines, posted as
   they are:

   > Learned Splitting, Groceries, Chores and Upkeep. Say "roomie, what can you do?" any time.
   > Everyone: your dashboard is at https://roomie.fly.dev/j/qk3dcb5btz. Sign in with Google and pick your name.

   Answered in a DM, the same two lines also go to the group chat (`postedInGroup: true`), since that's where everyone
   needs the link. This supersedes ADR 0001's "never post links in the group" for this one link: it binds nobody.
3. **Someone opens the Join link** (`/j/<code>`: `noindex`, and a `no-referrer` meta so the code never leaks as a Referer). Signed out, they go
   to `/signin?next=/j/<code>` first; nothing about the Group shows before that. Signed in, an Account already in the
   Group goes straight to `/g/<id>`. Everyone else sees the **seat picker**: the Group's name, the dino, "Which one are
   you?", the open seats, and "I'm not on this list".
4. **They pick** (`joins.claimSeat`, rate-limited to 10 picks an hour per IP and per Account):
   - **Connected at once** when the seat is open, the Group's Join policy is "free", the Chat's head count is known and
     fewer Accounts are connected than there are people. They land on the dashboard.
   - **Pending** otherwise: someone already has that seat, as many sign-ins as people, "I'm not on this list", "approve
     every join", or a Chat Roomie can't count. They become a Pending Member named after their Google name (made unique
     if it clashes, e.g. "Sam (sam.kim)"), remembering the seat they asked for, and see "An Admin needs to approve you;
     I'll let you know in the chat." Roomie asks in the chat (at most 5 asks per Group an hour):

     > Sam Kim signed in to the dashboard as Sam. Maya: approve them? Say "roomie approve Sam Kim" or use the Members page.
5. **An Admin approves** (chat: `roomie approve Sam Kim`, which prefers Pending people when names clash; or the Members
   page). A sign-in that asked for a seat that's still open is moved onto it (its placeholder row goes); otherwise they
   become a Member of their own. Approved on the dashboard, Roomie says it in the chat ("Sam Kim is in: connected to
   the dashboard as Sam.").

Claim links stay: the setup DM carries one, "roomie, send me the dashboard" still DMs one to someone without an Account,
and a used Claim link says "sign in with the same account, or open your group's Join link".

## Seats

A Seat is a Member as the picker sees them. The picker lists **active Members with no Account** by name; WhatsApp
Members still named by their number show as `+1 ••• 7393`. One Account has one Seat per Group. **Admin seats are never
on the picker** and a pick of one (a forged request) is Pending: a Join link can't hand out Admin powers; Admins connect
with their own Claim link (the setup DM, "roomie, send me the dashboard"), and the picker says so while one is open.

A Pending sign-in sees only the "Waiting for an Admin" screen: the page payload carries the Admins' names and their own
row (no one else's handles, Google names or avatars), and Ask Roomie refuses until they're approved.

| State | Members page | Admin can |
|---|---|---|
| connected | "On the dashboard as <Google name>" (+ avatar; the email for Admins only) | **Disconnect** (revoke: the Member stays, the seat is open again, and that Account goes back to waiting as a Pending sign-in, so it can't just pick the seat again), **Move to another seat** (reassign) |
| open | "Not on the dashboard yet." | (people pick it from the Join link) |
| pending sign-in | "Signed in with the Join link as … and says they're Sam." | Approve, Decline (final for that Account), **Pick their seat** (reassign = approve onto that seat) |

You can't revoke or move your own seat; another Admin can. Picks, approvals, revokes and moves lock the Group row and
the seats involved, and check again inside the change, so a racing pick is never overwritten. Every change is an
Activity row.

## Policies

Settings → Joining (Admins), or in chat `set_join_policy`:

- **Anyone in the chat picks their name** (`free`, default): connects at once while there are free seats.
- **I approve every join** (`approve_all`): every pick waits on the Members page.

## Head counts (who counts as "people in the chat")

`chats.participant_count` is the people besides Roomie, as the Channel last counted them:

- **WhatsApp**: the group's participants, at join and on every add / remove (`group-participants.update`).
- **Telegram**: `getChatMemberCount` minus Roomie, at join and on `new_chat_members` / `left_chat_member`. Telegram can't
  list members (ADR 0010), so people show on the picker once Roomie has heard them speak (or saw them join).
- **dev**: the Group's active Members.

A count older than 6 hours is refreshed from the Channel when a pick is made (when this process holds that Channel);
if it can't be refreshed it counts as unknown. Unknown = every pick waits for an Admin.

## Rotating

`rotate_join_link` (chat, Admins: "roomie rotate the join link") or **Rotate** on the Members page's Join link card. The
new code works at once and the old `/j/<old>` is a 404. People already connected stay connected. Codes are 10 base32
characters from `crypto.randomBytes` (50 bits), unique per Group, minted at creation or on first read for older Groups
(`npx tsx scripts/backfill-join-codes.ts` mints them all at once).

## Asking for the dashboard in chat

`get_dashboard_link`: for the whole group ("send us the dashboard") the Join link line; for the sender, their own
dashboard button when connected, else a Claim link in a DM (if the DM can't go out, Roomie offers the Join link
instead). `/help` ends its "Always" line with `Dashboard: <Join link>`.

## Why it's safe enough

Anyone in the chat can pick someone else's open seat. They can already read that chat, every seat shows who connected
to it, Admins can disconnect, and money entries record who acted. Groups that want more friction choose "I approve every
join". The Join link can create a Pending Member, so it's rate-limited and rotatable; it never connects anyone to a
seat that's taken.
