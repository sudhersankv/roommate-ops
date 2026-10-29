# Roomie on WhatsApp

WhatsApp runs on [Baileys](https://github.com/WhiskeySockets/Baileys) (`baileys` 7), an unofficial WhatsApp Web client: Roomie's number is a **linked device**, like WhatsApp Web on a laptop. The adapter is `src/channels/whatsapp.ts`; the app behind it is the same pipeline Telegram and `npm run dev-chat` use. Why Baileys and not the Cloud API, and why in-process: [ADR 0013](./adr/0013-whatsapp-via-baileys.md).

## 1. The number

- **A real carrier SIM or eSIM you keep** (a prepaid plan is fine). Not Google Voice or another VoIP number (WhatsApp refuses them or flags them), and never a rented SMS-verification number: if WhatsApp asks to re-verify and you can't receive the code, Roomie is gone from every group, and whoever rents the number next can take the account.
- **Use a spare number, not your own.** Unofficial clients break WhatsApp's terms, so the number can be banned. That's acceptable for friends and family, not for a public launch.
- Set it up on a phone with the WhatsApp (or WhatsApp Business) app: profile name **Roomie**, the picture `public/brand/roomie-icon.png`, two-step verification on. Use it like a person for a few days before linking (warm-up), and open the app at least every couple of weeks: a linked device stops working if the phone stays offline for about 14 days.

## 2. Turn it on (Fly)

```sh
fly secrets set WHATSAPP_ENABLED=1 ROOMIE_OPERATOR_EMAILS=you@example.com
fly deploy   # applies migration 0006_whatsapp (wa_sessions, wa_contacts) on start
```

- `WHATSAPP_ENABLED=1`: the Next server holds the WhatsApp socket (in and out) next to the scheduler. Off by default.
- `ROOMIE_OPERATOR_EMAILS`: comma-separated Google emails allowed on `/admin/whatsapp`. Everyone else gets a 404 there, signed in or not, and so does the page's API. The match only counts for an email the identity provider verified (`lib/operator.ts`), and the Neon Auth branch has email+password sign-in turned off, so nobody can register an operator's address to get in. Unset = nobody. `/admin` is `noindex` and disallowed in `robots.txt`, and nothing in the app links to it.
- Optional: `WA_LOG=info` (or `debug`) for Baileys' own logs; the default `warn` keeps the log readable. `JOIN_DELAY_MS` and `REPLY_DELAY_MS` work as on Telegram (WhatsApp's default reply pause is 1.2-3.2 s).

## 3. Log in (once)

Open `https://<app>/admin/whatsapp` and sign in with an operator's Google account.

- **QR:** press **Start (show a QR)**. On Roomie's phone: WhatsApp → Settings → Linked devices → Link a device, and scan. The QR refreshes by itself every 5 seconds while it waits.
- **Pairing code** (when you can't point the phone at the screen): type Roomie's number with its country code, digits only (`15551234567`), press **Get code**, then on the phone: Linked devices → Link a device → **Link with phone number instead**, and type the 8-character code.

The page then says **Connected** with the number and name. The login is saved in Postgres (`wa_sessions`), so restarts and redeploys reconnect by themselves; nobody needs to scan again. With no saved login the server waits for an operator instead of cycling QR codes nobody sees.

**Log out** on that page unlinks the device and deletes the saved login. Roomie goes quiet in every WhatsApp group until someone links it again.

## 4. Add Roomie to a group

Save Roomie's number in your contacts, open the group → Add members → Roomie. Whoever adds it is its Admin, and everyone already in the group is an active Member right away: unlike Telegram, WhatsApp lists a group's members, so there's no 24-hour roster window ([ADR 0010](./adr/0010-telegram-cant-list-group-members.md) is Telegram only). After `JOIN_DELAY_MS` (a minute by default) Roomie introduces itself and asks the setup questions; there's no "press Start" step, since WhatsApp lets Roomie message anyone first. People added later are Pending, and Roomie asks the Admins to approve them, as on Telegram.

Then it works like Telegram: say "roomie ...", @mention it, or reply to it. Receipts are photos (with a caption or not), voice notes are transcribed when `OPENROUTER_API_KEY` is set, and "send me the dashboard" sends the Claim link in a private chat, never in the group ([ADR 0003](./adr/0003-neon-auth-and-claim-links.md)). Links arrive as a last line `Open dashboard — https://...` (unofficial clients can't send URL buttons) and without previews. A private message from a Member of one Group is that Group's conversation; `/help` and `/start` work if someone types them, but nobody needs them.

## Who is who: phone numbers and LIDs

WhatsApp names a person by their phone JID (`15551234567@s.whatsapp.net`) or, in more and more groups, by a **LID** (`123456789012345@lid`), an id that hides the number. Roomie's rule: a Member's `channel_user_id` is **the phone JID whenever it can be resolved** (from the message's alternate id, the group's member list, Baileys' own LID map, or what Roomie learned before), and the LID only when it can't. Every LID ↔ phone pair goes into `wa_contacts`; when Roomie learns the number behind a LID it already stored, that Member moves to the phone JID, so one person stays one Member and private messages reach them. Until Roomie hears someone's name, their Member is called by their number (`+15551234567`, or "Someone" for a hidden number); the first message with a profile name replaces that placeholder, and never a name someone set.

## One process only

A WhatsApp session can be open in one place. Two processes with the same login kick each other off: the newer one wins, and Roomie's older process stops with "Another process took over this WhatsApp session" instead of fighting back. So:

- While Fly holds it, don't run Roomie on WhatsApp locally. To test locally, `fly secrets set WHATSAPP_ENABLED=0` first (or just test on Fly).
- Locally, with the same database: `npm run whatsapp` (`npx tsx scripts/whatsapp.ts`) holds the session and prints `[roomie]` lines per message, like `npm run telegram`. Not linked yet, it prints the QR in the terminal; `npx tsx scripts/whatsapp.ts --pair 15551234567` prints a pairing code instead. Ctrl+C stops it; the login stays saved. Or set `WHATSAPP_ENABLED=1` in `.env` and use `npm run dev` with `/admin/whatsapp`.

## When something's off

- **The page says `logged_out`:** WhatsApp unlinked the device (someone removed it under Linked devices, the number re-registered, or WhatsApp logged it out). The saved login is already deleted: log in again (step 3). If it keeps happening, check the phone still has the account and is online now and then.
- **`disconnected` with "Another process took over":** something else opened the session (a local `npm run whatsapp`, or a second machine). Stop the other one, then press Start.
- **`disconnected` with "The login wasn't finished in time":** nobody scanned the QR or typed the code within about a minute. Press Start (or Get code) again.
- **Roomie doesn't answer in a group:** the log should show `[roomie] chat <jid> ...` for each message. Nothing at all: check `/admin/whatsapp` says Connected. A line with `gate ignore`: the Gate chose quiet; say "roomie".
- **Banned number:** WhatsApp shows the ban on the phone. There's no appeal path for unofficial clients worth counting on; get a new number and warm it up.

Anti-ban behaviour is built in (ADR 0001): the join delay, "typing..." with a short pause before each reply, at most about one message every two seconds per chat and 12 a minute per group, Claim links only on request and only in private chats, and the phone keeps its notifications (Roomie doesn't mark itself online).
