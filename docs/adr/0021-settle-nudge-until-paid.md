# Money: the Settle nudge reminds per debt until it's paid

Supersedes the weekly cadence in ADR 0017 §4 and ADR 0019 §5. The weekly batch (owed more than $20 for more than 7 days, one DM on report day) meant a roommate could owe $40 for nearly two weeks before hearing anything, and then only once a week. In a roommate group the point is that nobody ever has to ask twice: the person who owes hears about it soon, privately, and again every few days until it's settled.

Decisions:

1. **Per debt, not per week.** Each pairwise debt over the Group's threshold (default **$5**) has its own cadence. The first DM goes once the debt's newest contribution is at least **4 hours** old, so a quick "paid" or a fixed typo doesn't trigger one. Then one every `everyDays` (default **2**, Admin-set 1-14) while it's still over the threshold, at most **5** per episode.
2. **Episodes.** An episode starts when the debt goes over the threshold, or with a Settlement from the debtor that leaves it over (a partial payment starts the count again, friendly first line included). The debt dropping to the threshold or under ends it; if it rises again, a new episode starts.
3. **Shorter each time, composed in code**, in the Group's currency: "Hey Dev, quick one: $40.73 to Maya for wifi + groceries. Whenever you can." (the up to two newest Expense descriptions in the debt, lowercased), then "Still $40.73 to Maya." (with a pay link) or "Still $40.73 to Maya. Say "paid" here once it's done." (without), then "Friendly nudge: $40.73 to Maya.". The payee's pay links are always attached when they exist. "paid" in the DM records the Settlement as before.
4. **When.** Daily, in the Bundle's hour (moved to 08:00 when it's inside quiet hours), from Money's `bundle()`, like the rent and restock DMs. Each DM claims `scheduled_posts` kind `nudge.settle` with period `<localDay>:<fromId>:<toId>`; those claims are the history the cadence reads. A failed send gives its claim back.
5. **Unchanged:** private only; "stop nudging me" opts a Member out; Admins set the amount and spacing or turn it off; a paused Group gets nothing; the weekly report says only how many balances are open ("2 open balances; I'm nudging people privately.").

## Consequences

- `nudgeDue` (pure) decides from the debt, its episode and the claims; `episodeOf` (pure) replays the pair's ledger by when each Expense was logged and each Settlement made. Both are tested in `settle-nudge.test.ts`.
- Settings are `{ thresholdCents, everyDays, enabled }`; an old stored `thresholdDays` is read as `everyDays` when it's 1-14, else the default. A stored `thresholdCents` (often the old $20 default) is kept.
- The report no longer runs the nudge; it only counts.
- With the morning post off (nudge hour null) there's no Bundle hour, so no Settle nudges either.

## Considered options

- **Keep weekly with a lower threshold:** still up to a week of silence. Rejected.
- **Nudge any time of day once eligible:** more scheduler work for little gain; the Bundle's hour is already the one daytime slot Roomie uses on its own. Rejected for now.
- **A stored episode table:** the claims already say when each DM went; the episode is derived from the ledger. Rejected.
