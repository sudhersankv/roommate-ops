# Roomie speaks up on its own: one morning bundle, one urgent slot, private nudges, quiet hours

ADR 0001 made Roomie quiet by default and ADR 0002's Gate decides when it answers. A roommate that only answers is a tool; one that posts six times a day gets muted. Roomie becomes a participant with a fixed budget of unprompted posts, and the things nobody wants said in front of everyone go to DMs.

Decisions:

1. **The morning bundle.** One post a day at the Group's nudge hour (default 9:00 local, the existing setting), made of lines in a fixed order: money (rent due within 3 days or overdue) → landlord (a visit today or tomorrow, a work order gone quiet) → house (chores due or late) → groceries (items probably low). Only lines with something to say; no post when none do. The existing daily chores nudge becomes one line of the bundle.
2. **The urgent slot.** One more unprompted post a day, only for a landlord notice with a date inside 72 hours. Nothing else qualifies.
3. **Quiet hours** 22:00-08:00 local for every unprompted post and every DM; something that becomes due at night waits for 08:00. Chattiness (quiet / normal / chatty) keeps governing conversation only: a "quiet" Group still gets its one morning line.
4. **Private nudges, so nobody has to be that guy.** On report day, anyone who has owed the same person more than $20 for more than 7 days gets a DM with the amount and a pay link; the group hears nothing. The weekly report stops naming debtors: "3 open balances; I've DM'd everyone." A Member says "stop nudging me" to opt out of settle and restock DMs (one switch; reminders they set still arrive). Admins change the threshold or turn it off for the Group. Personal restock items and the utility-amount question are DMs too.
5. **Bundle lines are a manifest contribution.** A Toolkit declares `bundle` (its line for the morning post, computed by a service in its own folder) in its manifest-backed server entry, in the same way it declares Home and Settings sections. The scheduler composes the bundle from the enabled Toolkits; core never names a Toolkit. The weekly report's sections move onto the same contract.
6. **Once per period, across restarts.** The bundle, the urgent post and each nudge claim a `scheduled_posts` row (group, kind, local period) before sending, as the chores nudge and the report already do.

## Consequences

- A paused Group gets none of this; a Group over its Jev or run caps still gets the bundle (it costs no model call).
- The bundle is pure composition over service reads: one function that takes the lines and returns the text, unit-tested like `formatGroupReport`.
- The chores nudge's "only when something is due" rule is now the bundle's rule for every line.
- The Bundle is logged as Roomie's line (`chat_messages`, member null) so a "yes" can answer it: it opens the follow-up window and the agent sees it in the recent chat. The weekly report and urgent posts aren't logged.
- A Member without a DM path (Telegram, never pressed Start) gets one neutral group line with no amounts, at most weekly: "Dev, I've got something for you; tap @roomie and press Start."

## Considered options

- **Keep answer-only:** safe, and the product reads as a bot you have to remember to use. Rejected.
- **Per-Trick posting schedules:** four Tricks, four morning posts. Rejected; one bundle.
- **Settle nudges in the group:** that's the thing people are avoiding by not using Splitwise. Private only.
