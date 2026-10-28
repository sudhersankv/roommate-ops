# Telegram can't list group members, so early first-time senders count as already there

ADR 0008 makes everyone already in a Chat an active Member when Roomie joins, and later joiners Pending. On Telegram that rule can't be applied as written: the Bot API gives a bot the chat's administrators (`getChatAdministrators`) and a member count, never the member list. So Roomie learns about people at three moments: the person who added it (`my_chat_member.from`, the Admin), the group's Telegram admins (active), and everyone else when they first speak.

We take a first-time sender whose first message arrives within **24 hours** of Roomie joining as someone who was already in the Chat (active, no approval asked). After that, a first-time sender is Pending and the Admins are asked to approve, as in ADR 0008. People Telegram reports as joining (`new_chat_members`) are Pending at once, inside the 24 hours too, so a newcomer can't slip in as active by speaking early. People added in the same action as Roomie count as already there.

The window lives in `ROSTER_GRACE_MS` (`src/channels/types.ts`), keyed by Channel; `onboarding.onUnknownSender` applies it using the Chat's `created_at` (when Roomie joined). Channels that can list members (WhatsApp, dev) have no window.

## Consequences

- A quiet member who first speaks after a day starts Pending, even if they were in the group all along. An Admin approves them once ("roomie approve Sam"); that's the cost of failing safe.
- Someone who joined without Telegram telling the bot (missed update) and speaks within 24 hours is active. Telegram keeps undelivered updates for 24 hours, so this needs Roomie to be offline for most of the window.
- No schema change: the Chat's `created_at` is the join time.

## Considered options

- **Everyone Pending until approved:** safe, but the Admin's first job is approving the whole group (what ADR 0008 rejected).
- **Everyone active forever:** a stranger who joins months later could log Expenses before any Admin noticed.
- **Make Roomie an admin to receive `chat_member` updates:** shows joins and leaves, still not the people who were already there, and asks more trust of every group.
