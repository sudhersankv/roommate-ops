# Neon Auth with Google, linked to Members by Claim links

Each Member signs in with Google to see their own view of the Group's dashboard. Roomie knows people by their WhatsApp identity and the dashboard knows them by Google Account, and nothing connects the two by itself. A Member's Account is linked only through a Claim link: a single-use, 24-hour token Roomie sends that Member in a private 1:1 message. So nobody can claim someone else's Member from the group chat. Accounts live in Neon Auth (managed Better Auth), in the same Neon database as the app.

## Consequences

- Roomie needs a private 1:1 message to every Member at least once, which Baileys supports.
- There is no anonymous dashboard access and no "acting as" picker. Every write uses the signed-in Account's Member in that Group.
- Admin approval is separate from claiming: a Member can claim their Account and still be a Pending member.

## Considered options

- **Better Auth we host ourselves:** full control, but more code. We fall back to it only if Neon Auth blocks us.
- **Matching by email:** WhatsApp never gives Roomie an email address, so there's nothing to match on.
