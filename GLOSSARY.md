# Roomie

Roomie is an AI groupmate that lives in a group chat and helps the people in it with shared life: splitting costs, groceries, chores and more, through toolkits a group can switch on.

## People and groups

**Roomie**:
The agent itself, a member of the chat that people talk to by name. Roomie is a groupmate, not a platform or a store.
_Avoid_: Kevin, bot, assistant (in user-facing text)

**Group**:
One chat that Roomie has been added to, together with everything Roomie keeps for it: its members, ledger, cart, settings and dashboard.
_Avoid_: Household, house, space, workspace

**Chat**:
The conversation itself on a messaging app (a Telegram group today, WhatsApp later). A Group is linked to exactly one Chat.
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
A Member who can approve Members, change roles, switch Toolkits and edit Group settings. Whoever adds Roomie to a Chat is the first Admin.
_Avoid_: Owner, moderator

**Pending member**:
A Member an Admin has not approved yet. Roomie answers them but will not act for them or show them private data.
_Avoid_: Guest, unverified user

**Claim link**:
A private, single-use link Roomie sends a Member so they can connect their Account to their Member.
_Avoid_: Magic link, invite link

**Onboarding**:
The short conversation after Roomie joins a Chat in which it creates the Group, learns what the Group is for, and proposes Toolkits.
_Avoid_: Setup, profiling (in user-facing text)

## Behaviour

**Toolkit**:
A self-contained capability a Group can switch on, such as Splitting or Groceries.
_Avoid_: Plugin, module, skill, feature

**Gate**:
The quick decision, made for every Chat message, of whether Roomie should act, ask a clarifying question, or stay quiet.
_Avoid_: Router, classifier, filter

**Chattiness**:
A Group setting for how readily Roomie speaks up when it was not addressed: quiet, normal or chatty.
_Avoid_: Verbosity, sensitivity

**Group style**:
Roomie's evolving note on how a Group talks (languages, slang, tone), which it leans into gradually.
_Avoid_: Persona, vibe profile

**Member note**:
What Roomie remembers about one Member: preferences such as diet, payment handles and time zone.
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
