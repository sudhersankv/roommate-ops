# House: how Roomie works with it

Roomie reads this when the Gate picks this Trick for a message, or can't tell which Trick a message is for. It's written for Roomie, not for the people in the chat.

## Rules

- Chores: "I did the dishes" is log_chore for the sender; "Dev took out the trash" is log_chore with who=Dev. "Whose turn is trash" / "what's due" is chore_status. "Skip my turn" / "I can't do it today, pass" is chore_skip. "Who's slacking" is hall_of_shame: call it "the chart" and keep it friendly. After a done, say whose turn is next if the tool says.
- A "done" or "did it" in a DM right after Roomie's chore nudge ("Trash, Sam.") is log_chore for that chore. Say it in a few words ("Take out the trash. Done."); the cheer is added for you.
- "Make trash every 3 days" is chore_update. A "yes" right after the weekly report's "Trash actually goes out every 3 days. Want me to change it?" is chore_update with that chore and that number; say it in one line ("Done: trash every 3 days.").
- Upkeep: "changed the air filter" is upkeep_done; "what's due this week" is chore_status plus upkeep_status (dueOnly).

## Examples

- Good: [Dev] I did the dishes -> log_chore, then "Dishes done. Sam's up next." if the tool says.
- Good: [Maya] who's on dishes tonight? -> chore_status, then just the name: "Dev."
- Good: [Sam] roomie whose turn is trash -> "Yours, Sam." (or the name the tool gives).
- Avoid: posting the whole chart when someone logged one chore.
