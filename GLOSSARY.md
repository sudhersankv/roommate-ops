# Roomie

Roomie is an AI groupmate that lives in a group chat and helps the people in it with shared life: splitting costs, groceries, chores and more, through toolkits a group can switch on.

## People and groups

**Roomie**:
The agent itself, the group chat's pet: a member of the chat that people talk to by name ("roomie", or the name the Group gave it). Each Group's Roomie takes its personality from the Group. Roomie is a pet and a groupmate, not a platform or a store.
_Avoid_: Kevin, bot, assistant (in user-facing text)

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
Something Roomie can do in a Group, such as Splitting, Groceries, Chores or Upkeep (Research, Trips, PDFs and Stickers are coming). People **teach** Roomie a Trick ("roomie, learn trips", or the dashboard's Tricks page) and can make it **forget** one; nothing is deleted. In code a Trick is a **Toolkit** (`src/toolkits/`, docs/toolkits.md): user-facing text always says Trick.
_Avoid_ (in anything a person reads): Toolkit, capability, module, plugin, feature, enable

**Teach / Forget**:
Switching a Trick on or off for a Group (Admins only): "roomie, learn chores" / "roomie, forget chores" in the chat, Teach / Forget on the Tricks page. In code: `toggle_toolkit`, `setToolkit`.
_Avoid_: Enable, disable, install, turn on (in user-facing text)

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
The vibe a Group picks for its Roomie: chill, hype, deadpan, mom, gremlin or butler. Each is a voice with example replies, an emoji policy and a brevity target. Called "vibe" in the chat and the dashboard.
_Avoid_: Persona, character, mode

**Quirk**:
One of up to three short traits a Group gives its Roomie ("obsessed with the plant"), shown now and then.
_Avoid_: Trait list, custom instructions

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
An Expense that repeats monthly or weekly; Roomie adds a copy on each due day, split the same way.
_Avoid_: Subscription, standing order

**Activity**:
The Group's record of who added, changed or deleted what.
_Avoid_: Audit log, history, feed

## Groceries

**Cart**:
The Group's shared list of things to buy.
_Avoid_: Shopping list, basket, order

**Cart item**:
One thing in the Cart, added by a Member, either personal (charged to whoever added it) or shared (split evenly).
_Avoid_: Product, line item

**Recipe**:
A dish Roomie wrote for the Group, with ingredients scaled to the people eating. A Recipe does not touch the Cart unless someone asks.
_Avoid_: Meal plan

**Pantry**:
The things a Group always has (salt, oil, rice). When a Recipe's ingredients go into the Cart, the Pantry's are left out.
_Avoid_: Staples, inventory

**Checkout**:
The open Cart as it was when someone asked for the Instacart list, kept so that "I paid" can point at what was ordered.
_Avoid_: Order, purchase

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
The one line Roomie posts on its own each morning (at the Group's nudge hour) when chores are due or late. Never more than one a day, and none when nothing is due.
_Avoid_: Ping, alert

**Group Report**:
One message with who owes whom, chores this week, upkeep due soon, the Cart and what's coming up. Posted weekly at the Group's report day and hour, and on request.
_Avoid_: Digest, summary, newsletter
