# Roomie

Roomie is the roommate who actually keeps track: it lives in an apartment's group chat and handles rent, splits, groceries, chores and the landlord's emails, through Tricks a group can teach it. Other kinds of group can use it too; roommates are who it's built for (ADR 0015).

## People and groups

**Roomie**:
The agent itself, a member of the chat that people talk to by name ("roomie", or the @mention). One Roomie, one voice, not renameable (ADR 0020); it quietly picks up how the group talks. Roomie is a roommate, not a platform, a store, or an "AI". How it talks and acts, and what it won't do: ADR 0022.
_Avoid_: Kevin, bot, assistant, AI, brain, smart (in user-facing text); pet (at most as flavour)

**Group**:
One chat that Roomie has been added to, together with everything Roomie keeps for it: its members, ledger, cart, settings and dashboard.
_Avoid_: Household, house, space, workspace

**Chat**:
The conversation itself on a messaging app (a Telegram or WhatsApp group). A Group is linked to exactly one Chat.
_Avoid_: Thread, channel (as a synonym for a single conversation)

**Channel**:
A messaging app Roomie can be reached on, such as Telegram or WhatsApp.
_Avoid_: Platform, provider

**Member**:
A person in a Group, known to Roomie by their messaging identity and, once claimed, by their Account.
_Avoid_: Roommate, user, participant

**Account**:
A person's signed-in identity on the dashboard (their Google account). One Account can be a Member of many Groups.
_Avoid_: User, login, profile

**Admin**:
A Member who can approve Members, change roles, teach Roomie Tricks and edit Group settings. Whoever adds Roomie to a Chat is the first Admin.
_Avoid_: Owner, moderator

**Pending member**:
A Member an Admin has not approved yet. Roomie answers them but will not act for them or show them private data.
_Avoid_: Guest, unverified user

**Claim link**:
A private, single-use link Roomie sends a Member so they can connect their Account to their Member.
_Avoid_: Magic link, invite link

**Join link**:
The Group's one shareable dashboard address (`/j/<code>`), posted in the Chat when setup finishes. It binds nobody by itself: opening it means signing in with Google and picking your Seat. An Admin can rotate it (the old one stops working).
_Avoid_: Invite link, magic link, dashboard link (that's the personal one)

**Seat**:
A Member as the Join link's picker shows them: open (no Account connected), connected (an Account is on it), or asked for by a Pending sign-in. An Admin can disconnect (revoke) or move (reassign) the Account on a Seat.
_Avoid_: Slot, profile

**Join policy**:
What a Join link pick does: "free" (anyone in the chat picks their name, connected at once while the Group has free Seats) or "approve every join" (every pick waits for an Admin).
_Avoid_: Privacy mode, invite mode

**Onboarding**:
The short conversation after Roomie joins a Chat in which it creates the Group, learns what the Group is for, and learns the Tricks that fit.
_Avoid_: Setup, profiling (in user-facing text)

**Beta request**:
Someone asking, through the form on the landing page, for Roomie in their WhatsApp group while WhatsApp is in beta. Not a Group or a Member yet: an operator follows up by hand and marks it contacted, onboarded or declined.
_Avoid_: Lead, signup, waitlist entry

**Operator**:
One of the people who run a Roomie deployment (`ROOMIE_OPERATOR_EMAILS`): links the WhatsApp number and works the Beta requests. Not anyone's Admin.
_Avoid_: Superuser, staff, owner

**LID**:
The opaque id WhatsApp uses for a person in many groups (`…@lid`) instead of their phone number. Roomie keeps a Member under their phone number when it can find it, and under the LID only when it can't.
_Avoid_: User id, WhatsApp id (ambiguous)

**Pairing code**:
The 8-character code that links Roomie's WhatsApp number to the server without scanning a QR: typed on the phone under Linked devices.
_Avoid_: OTP, verification code

## Behaviour

**Trick**:
Something Roomie can do in a Group: Money, Groceries, House and Lease Inbox (Outings, Cooking, Trips, Stickers, Guests and Move-out are coming). People **teach** Roomie a Trick ("roomie, learn lease inbox", or the dashboard's Tricks page) and can make it **forget** one; nothing is deleted. In code a Trick is a **Toolkit** (`src/toolkits/`, docs/toolkits.md): user-facing text always says Trick.
_Avoid_ (in anything a person reads): Toolkit, capability, module, plugin, feature, enable

**Money**:
The Trick for shared costs: Expenses, Balances, settling up, Rent, Utilities and the Settle nudge. In code the toolkit id stays `splitting`.
_Avoid_: Splitting (as the Trick's name in user-facing text from ADR 0015 on), finances

**House**:
The Trick for the chore chart and Upkeep, one Trick with two tabs (ADR 0015). In code: the `chores` and `upkeep` toolkits merged.
_Avoid_: Chores (as the Trick's name), household, home admin

**Lease Inbox**:
The Trick that gives the Group its own email address for the landlord or leasing office: Roomie reads what arrives (notices, rent changes, work-order replies), tells the chat what matters, files the rest, and sends emails the Members ask for (ADR 0016).
_Avoid_: Lease stuff, household admin, mailbox, email integration

**Bundle**:
Roomie's one morning post, at the Group's nudge hour, made of a line per Trick that has something to say: rent due, a landlord visit, chores due, items probably low (ADR 0017). The old chores Nudge is one of its lines.
_Avoid_: Digest, daily summary, notifications

**Urgent slot**:
The one extra unprompted post Roomie may make in a day, only for a landlord notice dated within 72 hours.
_Avoid_: Alert, push

**Quiet hours**:
22:00 to 08:00 in the Group's time zone: no unprompted posts and no DMs. What comes due at night waits for the morning.
_Avoid_: Do not disturb, mute

**Settle nudge**:
The private DM to a Member who owes someone more than $5: a few hours after the debt appears, then every couple of days (Admin-set) until it's settled, at most five times, shorter each time and with the pay link (ADR 0021). Never in the group ("so nobody has to be that guy"). "stop nudging me" turns it off for that Member.
_Avoid_: Debt reminder, dunning, chaser

**Poll**:
A question Roomie asks the chat with up to four options when more than one person's input is the answer: who's in on an Expense, who's shopping, which day. Resolves on a majority of active Members or after 2 hours; nothing is logged before. Never for how to split (ADR 0018).
_Avoid_: Vote (as the noun), survey, quiz

**Teach / Forget**:
Switching a Trick on or off for a Group (Admins only): "roomie, learn chores" / "roomie, forget chores" in the chat, Teach / Forget on the Tricks page. In code: `toggle_toolkit`, `setToolkit`.
_Avoid_: Enable, disable, install, turn on (in user-facing text)

**Trick vote**:
An "I want this" on a coming-soon Trick's card on the landing page: one row in `trick_votes` with an HMAC of the voter's IP, no Group or Account. Counts show from 5.
_Avoid_: Upvote, like, waitlist

**Gate**:
The quick decision, made for every Chat message, of whether Roomie should act, ask a clarifying question, or stay quiet.
_Avoid_: Router, classifier, filter

**Chattiness**:
A Group setting for how readily Roomie speaks up when it was not addressed: quiet, normal or chatty.
_Avoid_: Verbosity, sensitivity

**Group style**:
Roomie's evolving note on how a Group talks (languages, slang, tone), which it leans into gradually. Its data is the Learned style.
_Avoid_: Persona, vibe profile

**Archetype**:
One of six fixed voices in code (chill, hype, deadpan, mom, gremlin, butler). Since ADR 0020 Roomie has one voice (chill); the others are a dev-only switch and nothing user-facing offers them.
_Avoid_: Vibe, persona, character, mode (in user-facing text)

**DM**:
A private conversation between Roomie and one Member: a private Roomie for their Group, where "what do I owe" and the Settle nudge live. A DM write that moves shared money is **echoed** to the group as one line; Settlements stay between the two people (ADR 0020).
_Avoid_: Private chat, 1:1, direct message (spelled out)

**Echo**:
The one line Roomie posts in the group when something done privately (a DM, the dashboard) changed shared money, so no Balance moves invisibly.
_Avoid_: Notification, broadcast

**Learned style**:
What Roomie has picked up from a Group's messages, counted in code: languages and how often they mix, top slang with counts, tone, nicknames others use, running jokes, message length, emoji per message and busy hours, with a confidence that rises with messages seen. It decides how much slang Roomie may borrow.
_Avoid_: Style profile, training

**Member note**:
What Roomie remembers about one Member ("knows you"): preferred name, diet and allergies, payment handles, time zone, things they care about, birthday.
_Avoid_: Profile, user memory

## Splitting

**Expense**:
A cost that one or more Members paid and that is shared by some Members.
_Avoid_: Bill, transaction, receipt

**Payer**:
A Member who paid some or all of an Expense.
_Avoid_: Owner, spender

**Share**:
The part of an Expense one Member owes, however it was split (equally, exact amounts, percentages or shares).
_Avoid_: Split row, portion

**Balance**:
What a Member is owed (positive) or owes (negative) across the whole Group.
_Avoid_: Debt, total

**Settlement**:
A recorded payment from one Member to another that reduces what they owe.
_Avoid_: Payment, payback, transfer

**Settle plan**:
The smallest set of Settlements that would bring every Balance to zero.
_Avoid_: Debt graph, payout list

**Simplify debts**:
A Group setting for the Settle plan: on, the fewest payments overall (even between people who never shared an Expense); off, each pair settles what they shared.
_Avoid_: Debt optimization, netting

**Payment handle**:
A Member's own Venmo, PayPal or Cash App name, which Settle up turns into a pay link with the amount filled in.
_Avoid_: Payment method, account, username

**Recurring expense**:
An Expense that repeats monthly or weekly; Roomie adds a copy on each due day, split the same way. A **variable** one asks its Payer for the amount on the due day instead (Utilities).
_Avoid_: Subscription, standing order

**Rent**:
The Group's monthly recurring Expense with category `rent`: amount, due day, who pays the landlord, each person's share (often unequal). There is no separate rent object (ADR 0019). Roomie reminds three days before and DMs each person their own share.
_Avoid_: Rent tracker, lease payment

**Utility**:
A variable recurring Expense (electric, internet, water): on the due day Roomie DMs the Payer for the amount, then logs and splits it. With Lease Inbox on, the amount is pre-filled from the bill.
_Avoid_: Bill (as the term for the Expense), subscription

**Activity**:
The Group's record of who added, changed or deleted what, and where: its **source** is the chat or the dashboard (none for Roomie's own work). Roomie reads the Activity since it last spoke.
_Avoid_: Audit log, history, feed

## Groceries

**Cart**:
The Group's shared list of things to buy.
_Avoid_: Shopping list, basket, order

**Cart item**:
One thing in the Cart, added by a Member, either personal (charged to whoever added it) or shared (split evenly), with its quantity as said ("2 cartons"). A Cart item has no price; the receipt does.
_Avoid_: Product, line item, estimate

**Recipe**:
A dish Roomie wrote for the Group (or read from a photo), with ingredients scaled to the people eating. A Recipe does not touch the Cart unless someone asks.
_Avoid_: Meal plan

**Pantry**:
The things a Group always has (salt, oil, rice). When a Recipe's ingredients go into the Cart, the Pantry's are left out.
_Avoid_: Staples, inventory

**Usual**:
What a bare mention means: a Member's own ("Pepsi" is their 12 cans) or the house's, for shared items (the bread the Group always gets). What someone told Roomie (the answer to its one question, "from now on", an edit on the Cart page) comes first; otherwise it's the quantity in at least 2 of the last 3 adds of that thing. Shown and edited on the Cart page.
_Avoid_: Preference, default, favourite

**Checkout**:
The open Cart as it was when someone asked for the Instacart list, kept so that "I paid" can point at what was ordered.
_Avoid_: Order, purchase

**Restock**:
Roomie's guess that the Group is probably low on something, from how often it was bought before (three purchases or more, nudged at about 90% of the usual gap). Shared items in the Bundle, personal ones by DM; "we don't buy X anymore" mutes one.
_Avoid_: Prediction, auto-reorder, inventory

## Chores and upkeep

**Chore**:
Something on the Group's chart that comes around every few days, such as the dishes or the trash.
_Avoid_: Task, job, todo

**Rotation**:
The order in which Members take turns on one Chore. Without one, everyone takes turns and whoever did it least recently goes next.
_Avoid_: Schedule, roster, queue

**Pass**:
Giving up your turn on a Chore: the next Member in the Rotation is up, and the Chore stays due.
_Avoid_: Skip (in user-facing text "pass your turn" reads better), swap

**Streak**:
How many of a Member's own turns on a Chore in a row they did on time. A Pass or a late done ends it.
_Avoid_: Combo, score

**The chart**:
Who did how many chores this week, least first. Roomie keeps it friendly.
_Avoid_: Hall of shame (in user-facing text), leaderboard

**Upkeep item**:
House care that comes around every few weeks or months, such as the air filter or the smoke alarms. "Due soon" means within 7 days.
_Avoid_: Maintenance task, ticket

**Reminder**:
A message Roomie sends at a set time, once or repeating daily, weekly or monthly: to the Chat when it's for everyone, privately when it's for one Member.
_Avoid_: Alarm, notification

**Nudge**:
The chores line of the Bundle: what's on the chart today and whose turn it is, only when something is due or late.
_Avoid_: Ping, alert

**Group Report**:
One message with how many Balances are open (not who; see Settle nudge), chores this week, upkeep due soon, the Cart, what the Lease Inbox saw and what's coming up. Posted weekly at the Group's report day and hour, and on request.
_Avoid_: Digest, summary, newsletter

## Lease Inbox

**Inbox**:
The Group's own email address, one per Group, provisioned when Lease Inbox is taught. Shown on the dashboard with its mail sorted into Notices, Rent & lease, Work orders, Everything else and New senders.
_Avoid_: Mailbox, email account

**Landlord**:
Whoever the Group rents from, as the set of email addresses and domains Roomie trusts, not one person: learned from a Forward by a known Member or from the intro email, or confirmed by an Admin. A whole domain is trusted except public mail domains (gmail.com, outlook.com…), where only the exact address is. Only the Landlord's mail reaches the chat.
_Avoid_: Property manager (fine in copy, not as the term), sender, trusted sender (in user-facing text: say "the landlord")

**Forward**:
An email a Member forwards to the Inbox from their own mailbox. Roomie reads it as coming from the original sender (parsed from the quoted headers), and learns the Landlord from it only when the forwarder is a known Member (their sign-in email matches). A forward from anyone else is a New sender.
_Avoid_: Relay, bounce

**New sender**:
An address the Inbox hasn't seen and doesn't trust. Filed, never posted to the chat; the Admin is asked once, privately, whether it's the building.
_Avoid_: Unknown contact, spam (it may well be the landlord)

**Notice**:
An email from the Landlord with a date in it: an inspection, a water shut-off, a maintenance window. Gets one line in the chat, a Reminder the evening before, and is filed. Within 72 hours it is urgent.
_Avoid_: Announcement, alert

**Work order**:
A maintenance request the Group made through Roomie ("the sink's leaking, tell them"): what, who reported it, the email thread, and its Work order status.
_Avoid_: Ticket, maintenance request, repair request (as the term), issue

**Work order status**:
Where a Work order is, read from the Landlord's replies: **sent** (Roomie emailed it), **acknowledged** (they answered), **scheduled** (with the date they gave), **done**. Only forward moves; a reply that fits nothing leaves it where it was.
_Avoid_: State, stage, ticket status

**Simple email**:
One Roomie sends at once on a Member's word: a reply in a thread the Landlord started, or a new maintenance request, with no dollar amount, no date the Member didn't say and no lease or legal term. Anything else is **complex** and gets a question or two first (ADR 0016).
_Avoid_: Auto-send, approved email

**Signature**:
The two lines at the end of every email Roomie sends, naming the Group and the Member who asked for it.
_Avoid_: Disclaimer, footer

**Intro email**:
The one-time email Roomie offers to send a newly known Landlord, explaining the shared inbox and signed with every active Member's first name.
_Avoid_: Consent email, onboarding email

## Documents

**Document**:
A file the Group keeps: a receipt (with its Expense), the lease, a Notice, a utility bill, an email thread, a photo someone asked Roomie to keep. Stored in object storage per Group, listed on the Docs tab, found from chat ("roomie find the lease"). Every Trick files; none owns (ADR 0018).
_Avoid_: Attachment, upload, file (as the term)
