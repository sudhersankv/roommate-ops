# Money: rent is a recurring Expense, utilities ask for their amount, and settling is nudged privately

Rent is the one roommate payment that is always shared, always due, and always awkward. Utilities are the same with a number nobody knows until the bill arrives. Both fit the existing money model (ADR 0007); what's new is how they're set up and how Roomie talks about them.

Decisions:

1. **Rent is a recurring Expense** with category `rent`, monthly, any split method the model already has (even, exact, percents, shares) and one payer (whoever pays the landlord). There is no second rent object: the recurring Expense *is* the rent configuration, and a Rent card on the Money page shows and edits it (amount, due day, who pays, each person's share).
2. **Set up on first mention, never in onboarding.** Onboarding stays one question. The first time anyone says "rent", or in the first weekly report if nobody has, Roomie offers once: "Want me to track rent? Tell me the amount, the due day and who pays the landlord (and how it's split, if not evenly)." The card's empty state offers the same.
3. **The rent reminder.** Three days before the due day, one group line: "Rent $2,400 is due Saturday. Maya pays the landlord." Each person who owes a share gets a DM with their own amount and a pay link. On the due day, a group line only if someone still owes. After that, nothing: the Balance already shows it.
4. **Utilities are recurring Expenses that ask for their amount.** A recurring Expense can be marked *variable*; on its due day Roomie DMs the payer "How much was the electric bill?", a number logs and splits it, and the group gets the one-line echo (shared money moved). With Lease Inbox on and the bill in the inbox, Roomie pre-fills the amount and asks the payer to confirm.
5. **The settle nudge** (ADR 0017): weekly, private, to anyone who has owed the same person more than $20 for more than 7 days, with a pay link. "paid" in the DM records the Settlement and the payee gets a one-line DM; the group hears nothing. Defaults on for roommates; Admins set the threshold or turn it off; a Member opts out with "stop nudging me".
6. **The weekly report** keeps the Settle plan's count, not its names.

## Consequences

- `recurring.ts` gains the variable-amount mode and the per-share reminder windows; the Rent card is a Money dashboard section reading the same rows.
- A rent change proposed by Lease Inbox (ADR 0016) updates this Expense only when the Admin confirms.
- Unequal rent is the common case (room sizes); the setup copy asks for the split explicitly rather than assuming even.
- Nudge eligibility (who, how much, since when) is a pure function over Balances and Settlement dates with tests; the DM text is composed in code.

## Considered options

- **A separate `rent` table:** two sources of truth for one monthly cost. Rejected.
- **Rent in onboarding:** a second question for every group, including the ones that don't split rent. Rejected.
- **Nudge in the group chat:** see ADR 0017. Private only.
