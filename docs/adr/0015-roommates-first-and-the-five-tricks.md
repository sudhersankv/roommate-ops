# Roommates first: one Roomie, five Tricks, and everything else is a footnote

Roomie was built as "an AI that joins any group chat and learns Tricks". The landing page sold six kinds of group, the name said roommates, three of the four built Tricks were household-shaped, and the trip / friends / work presets reduced to "Splitwise with a personality". The product is sharper as **the roommate who actually keeps track**: it sits in a US apartment's group chat and handles rent, splits, groceries, chores and the landlord, so none of the people have to.

Decisions:

1. **Who.** US apartment renters, 2-5 people on one shared lease, on WhatsApp first (the beta form is the primary call to action), Telegram as "works today", Discord and iMessage as Soon. Other groups still work (the purposes and presets stay in code) but the landing page mentions them in one footnote, not a six-card grid.
2. **Words.** Nothing a person reads says AI, bot, brain, assistant or smart. Headline: *"The roommate who actually keeps track."* Subline: *"Add it to the group chat. It handles rent, splits, groceries, chores and the landlord, so none of you have to."* The demos section is titled *"Five apps and a group mom. Or Roomie."* The five apps it replaces: Splitwise, a list app, a chores app, calendar reminders, and the landlord's email thread one person is stuck forwarding.
3. **Five buckets.** Core (Roomie itself: Gate, memory, reminders, polls, DMs, documents, the weekly report) and four Tricks: **Money** (Splitting plus rent, utilities and the private settle nudge), **Groceries** (plus Restock), **House** (Chores and Upkeep merged, two tabs), **Lease Inbox** (ADR 0016). Roommates start with Money, Groceries and House on; Lease Inbox is taught on purpose because it needs a connection step.
4. **Coming soon** becomes Outings, Cooking, Trips, Stickers, **Guests** and **Move-out**. Research and PDFs leave the list: reading lease and notice PDFs is part of Lease Inbox; making PDFs stays parked.
5. **Tricks stay decoupled** (ADR 0011), and two leaks are closed: Groceries declares `requires: splitting` instead of reaching into Splitting silently (its "I paid 84" ends in an Expense), and scheduled posts become a manifest contribution (ADR 0017's bundle) instead of `if (on("chores"))` blocks in core.

## Consequences

- `docs/landing.md`, the hero, demos, Tricks section and FAQ are rewritten around an apartment. The "Pick its vibe" section goes (ADR 0020). "What's your group?" becomes a line.
- `PRESETS.roommates` = money, groceries, house. The House merge is a rename of two Toolkits into one with two tabs; chores and upkeep data and services are unchanged.
- The Settings page's "What it's for" keeps every purpose, so a trip group is still a trip group; only the marketing changes.
- Anyone writing copy checks it against this ADR and the glossary: Trick, teach, forget; never the Avoid words; no AI words.

## Considered options

- **Keep "any group chat":** broad, but every demo had to explain itself and the name fought the pitch. Rejected.
- **Rename away from Roomie:** the name is the positioning now. Kept.
- **Lease Inbox default-on for roommates:** the most differentiated Trick, but it does nothing until someone connects the landlord; a default-on empty state would read as broken. Opt-in, suggested at the end of setup.
