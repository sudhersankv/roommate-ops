# Baileys for WhatsApp groups, behind a Channel adapter

Roomie has to be added to a Chat people already have. Meta's Cloud API (and Photon and Composio, which sit on top of it) can't do that: a Business account can only join groups it created itself, and only after becoming an Official Business Account (business verification, 30+ days on the platform, 8-member cap, no buttons in groups). So Roomie runs on Baileys, an unofficial WhatsApp Web client, on its own dedicated number. All WhatsApp code sits behind a Channel adapter, so the rest of the app never imports Baileys.

**Telegram first (step 2b).** Telegram's Bot API is official (no ban risk) and a bot can be added to an existing group, so Roomie goes live there first to validate the Channel adapter and the flows (Onboarding, Pending members, private Claim links) with real people. The same anti-spam rules apply to it ([docs/telegram.md](../telegram.md)). WhatsApp follows when a dedicated number exists, through the Evolution API (a Baileys wrapper run in Docker: the same risk profile as raw Baileys, and swappable to the Cloud API later) behind the same adapter interface.

## Consequences

- Baileys breaks WhatsApp's terms, so Roomie's number can be banned. That's acceptable for friends and family, but not for a public launch. Roomie's number must be a real carrier SIM or eSIM: WhatsApp rejects VoIP numbers like Google Voice, and VoIP accounts get flagged more.
- Baileys keeps one long-lived socket open, so it runs as its own process (`npm run wa`), not inside a Next.js request.
- The number must be one we keep for good (prepaid eSIM or SIM), never a rented SMS-verification number. Baileys is a linked device: if the primary phone stays offline too long or WhatsApp re-verifies the number, a number we can't receive codes on loses Roomie from every Group, and whoever rents it next can take over the account.
- Anti-ban behaviour is part of the adapter, not optional:
  - Warm up a new number for a few days before linking.
  - Wait 1–3 minutes after joining a Chat before the first message.
  - Show typing indicators and short human-like delays before replies.
  - Rate-limit outbound messages per Chat and overall.
  - Never send links in bulk. Claim links go out only on demand, spaced apart, and only to Members who have already messaged Roomie.
- The session is stored in Postgres, so a restart or a move to another machine doesn't need re-pairing.
- Before a public launch, add a second adapter: the Cloud API (or Photon) with Roomie-created groups, or Photon iMessage groups.

## Considered options

- **Meta Cloud API directly:** can't join an existing group. Rejected for now.
- **Photon on WhatsApp:** 1:1 chats only. Rejected for groups.
- **Photon on iMessage:** real groups, but it's iMessage and $250 per line per month. Kept as a future adapter.
- **Composio WhatsApp:** Business API only, so the same limits. Rejected.
