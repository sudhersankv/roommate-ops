# People already in the Chat are active; later joiners are Pending

When Roomie is added to a Chat, whoever added it becomes the first Admin, and everyone already in the Chat becomes an active Member right away: they were in the group before Roomie, and asking an Admin to approve a dozen existing friends one by one would make Onboarding a chore. Only people who join later, or who speak without Roomie having seen them join, start as Pending members until an Admin approves them in the chat ("roomie approve Priya") or on the dashboard. Approval is separate from claiming an Account (ADR 0003).

Our `accounts` table mirrors Neon Auth users by their id (stored as text) instead of joining into the `neon_auth` schema, which Neon Auth owns and we never write to. An Account row is created the first time a signed-in user is seen.

## Consequences

- A stranger who is already in the WhatsApp group when Roomie arrives can log Expenses straight away. Admins can still decline or remove people later.
- The pipeline treats an unknown sender in a known Chat as a later joiner, so a missed join event fails safe (Pending), not open.
- `neon_auth` can change shape between Neon Auth versions without a migration on our side; the cost is one upsert per sign-in.
- Telegram bots can't see who is already in a group, so there a first-time sender within 24 hours of Roomie joining counts as already there ([ADR 0010](./0010-telegram-cant-list-group-members.md)).

## Considered options

- **Everyone Pending until approved, including people already in the Chat:** safest, but the Admin's first job would be approving the whole group.
- **Foreign keys into `neon_auth.user`:** couples our migrations to a schema we don't own.
