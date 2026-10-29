# WhatsApp via Baileys, in the Next process, with the session in Postgres

ADR 0001 chose Baileys for WhatsApp and planned to run it through the Evolution API as its own process. Now that Roomie has a number, the adapter is built (`src/channels/whatsapp.ts`, [docs/whatsapp.md](../whatsapp.md)) and three details are settled differently or for the first time.

**Baileys, not the Cloud API.** Unchanged from ADR 0001: a WhatsApp Business (Cloud API) number can't be added to a group people already have; it can only join groups it created, after becoming an Official Business Account. Roomie's whole point is being added to an existing group, so it stays an unofficial linked device, on a spare carrier number, with the ban risk that brings.

**In-process Baileys, not the Evolution API.** One always-on Fly machine already runs Next (dashboard, API, Telegram webhook) and the scheduler. The Baileys socket runs in that same Node process, started from `instrumentation.ts` when `WHATSAPP_ENABLED=1`, once per process (a `globalThis` guard, like the scheduler). Evolution API would add a second service to deploy and secure, an HTTP hop and webhooks for every message, and a second copy of the session, to wrap the same library with the same ban risk. Calling Baileys directly keeps the adapter like Telegram's: events in, `IncomingMessage` out, `deliver()` and `deliverPrivate()` through the Channel registry, tests on a fake socket. Operators link the number on `/admin/whatsapp` (QR or pairing code), so nobody needs a terminal on the server.

**The session lives in Postgres.** Baileys' creds and Signal keys go to `wa_sessions` (one row per key, Baileys' BufferJSON form) instead of a folder on disk, so a redeploy or a new machine reconnects without anyone scanning again. A `loggedOut` close deletes the rows and waits for an operator; any other close reconnects with backoff (1 s doubling to a minute). Only one process may hold the session: when a second one connects, WhatsApp closes the first with `connectionReplaced`, and Roomie then stops instead of reconnecting, so two processes never fight.

**One canonical id per person.** WhatsApp now names people by a LID (an opaque `@lid` id) in many groups and by a phone JID elsewhere. `members.channel_user_id` is the phone JID whenever it can be resolved, the LID otherwise. Learned pairs go to `wa_contacts`, and a Member stored under a LID moves to the phone JID when the pair turns up (`members.rekeyChannelUser`). The phone JID wins because it's stable across groups and private chats and is what an Admin recognizes; the LID is only a fallback for people whose number WhatsApp hides.

## Consequences

- One machine holds WhatsApp. Scaling out means moving the socket to its own process, behind the same Channel interface (the adapter already takes its socket and deps from outside).
- `WHATSAPP_ENABLED` is off by default, so a deploy without a linked number changes nothing. Local testing against the same database has to turn it off on Fly first.
- WhatsApp lists group members, so ADR 0008 applies as written: everyone in the group when Roomie joins is an active Member, there's no roster window (ADR 0010 stays Telegram-only), and no "message me first" step: Roomie can DM any Member.
- Links go as trailing `text — url` lines, since unofficial clients can't send URL buttons reliably.
- Baileys is a release candidate (`7.0.0-rc14`), pinned exactly; upgrades are deliberate. The WhatsApp Web version is fetched at each connect (`fetchLatestBaileysVersion`), falling back to the one Baileys ships.

## Considered options

- **Evolution API in Docker:** a ready REST wrapper and a dashboard, but a second service and session for the same library. Kept as a fallback if Baileys in-process proves unstable.
- **Session files on a Fly volume:** simpler, but tied to one machine's disk, lost with the volume, and invisible to backups of the database.
- **The LID as the canonical id:** it's what new groups send, but it differs from the phone JID in private chats and isn't readable to people. Rejected in favour of phone-JID-first with a stored mapping.
