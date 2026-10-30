# Roomie on Telegram

Telegram is the first real Channel: the Bot API is official (no ban risk) and a bot can be added to a group people already have. The adapter is `src/channels/telegram.ts` (grammY); the app behind it is the same pipeline `npm run dev-chat` uses. WhatsApp sits behind the same Channel interface ([docs/whatsapp.md](./whatsapp.md)).

Local dev uses **long polling** (`npm run telegram`), so no public URL is needed. The webhook (`/api/telegram`) is for when Roomie runs on a public https URL.

## 1. Create the bot (BotFather, about 5 minutes)

In Telegram, open [@BotFather](https://t.me/BotFather):

1. `/newbot` → name: **Roomie** → username: something ending in `bot`, e.g. **`roomie_house_bot`**. BotFather replies with the token (`123456789:AA...`). Keep it secret.
2. `/setprivacy` → pick the bot → **Disable**. Otherwise Roomie only sees messages that @-mention it, reply to it, or start with `/`, and can't follow the chat. (If the bot was already in a group when you changed this, remove it and add it again: the setting applies when it joins.)
3. `/setjoingroups` → pick the bot → **Enable** (lets people add it to groups).
4. `/setuserpic` → pick the bot → send `public/brand/roomie-icon.png` (512×512).
5. `/setdescription` (shown on the empty chat before someone presses Start):
   > I'm Roomie, an AI groupmate. Add me to your group chat and I'll split costs, keep a shared cart, track chores and remind people. Press Start so I can DM you your dashboard link.
6. `/setabouttext` (the profile blurb):
   > Your group chat's groupmate: splits costs, keeps the cart, tracks chores. Brief, a bit witty, exact about money.
7. Optional: `/setcommands` → `help - What Roomie can do`. Roomie talks in plain language ("roomie ..."); `/help` (in a group or a DM) is the only command it answers, with five lines of examples. Other slash commands are ignored.

## 2. `.env`

```
TELEGRAM_BOT_TOKEN=123456789:AA...        # from /newbot
TELEGRAM_BOT_USERNAME=roomie_house_bot    # without the @
TELEGRAM_WEBHOOK_SECRET=                  # only for the webhook: 1-256 chars of A-Z a-z 0-9 _ -
JOIN_DELAY_MS=                            # pause before the intro after joining a group (default 60000)
REPLY_DELAY_MS=                           # pause after "typing" before a reply (default 600-1800 ms random; 0 = none)
```

`APP_URL` is used for the dashboard and Claim link buttons. Telegram won't accept `localhost` buttons, so with `APP_URL=http://localhost:3000` those links go out as text instead (the log says so once). For real buttons, use a tunnel (`cloudflared tunnel --url http://localhost:3000`, ngrok) and put its https URL in `APP_URL`.

## 3. Run it

```sh
npm run telegram:check   # read-only: getMe (privacy mode), the webhook, APP_URL, delays, DB, gateway, Jev; exits 1 with the fix
npm run telegram         # long polling; prints "@roomie_house_bot is polling". Ctrl+C stops it
npm run dev              # the dashboard (its scheduler posts reminders, the chores nudge and the weekly report to Telegram)
```

Only one process receives updates. `npm run telegram` deletes any webhook when it starts (so a deployed bot on that webhook stops getting messages until `npm run telegram:webhook -- --set` again). Without a token it exits with `TELEGRAM_BOT_TOKEN missing; see docs/telegram.md`.

Every message prints two lines, which is what to paste into a bug report:

```
[roomie] chat -1001234567890 Maya: "roomie I paid 60 for internet" | gate act/hard-trigger/splitting | tools log_expense | 6.2s | trace 4f0c...
[roomie]   -> "Logged: $60 internet, Maya paid, split 2 ways, $30 each 💸"
```

If handling a message fails, the log gets `[roomie] couldn't handle a message from ...` with the stack; the chat gets one friendly line, and only when Roomie was being talked to.

## 4. Try it in a test group

1. Create a Telegram group with one or two friends (or a second account), then add the bot (group → Add members → `@roomie_house_bot`). Whoever adds it is Roomie's Admin.
2. Wait `JOIN_DELAY_MS` (a minute by default): Roomie introduces itself, names the Admin, asks what the group is for, and asks everyone to tap `@roomie_house_bot` and press **Start** once. If someone talks to Roomie before then, the intro goes first.
3. Answer the setup in one line: `roommates, USD, Chicago`.
4. Each person who was already in the group should press **Start** in a 1:1 chat with the bot (needed for the private dashboard link; Telegram doesn't let bots message anyone first).
5. Try:
   - `roomie who's here` — lists Members with roles. People show up as they speak (see "Who is a Member" below).
   - `I paid 20 for pizza` (or `roomie I paid 20 for pizza, split with Sam`) — logs an Expense; check it on the dashboard.
   - A photo of a receipt with the caption `roomie split this receipt` — reads it and shows the breakdown.
   - `send me the dashboard` — Roomie DMs you a single-use Claim link. If you never pressed Start, Roomie says so in the group and sends nothing there.
   - Add a new person to the group later: Roomie welcomes them and asks the Admin to approve (`roomie approve <name>`).
   - A voice note replying to Roomie: transcribed when `OPENROUTER_API_KEY` is set; otherwise Roomie says once that it can't hear voice notes yet.

**Photos and voice notes only when Roomie is addressed.** A photo is downloaded only when its caption addresses Roomie ("roomie ...", @mention, the group's name for it), it replies to Roomie, or it arrives in the follow-up window (3 minutes / 3 messages after Roomie spoke). A voice note is transcribed only when it replies to Roomie, @mentions it, arrives in the follow-up window, or comes from the Admin while setup is open. Anything else is never downloaded or sent to the transcriber; the chat log just says "(photo)" (with its caption, which still counts as text) or "(voice note)". A voice note on its own is not a reason to answer.

**Limits.** One person can add Roomie to at most 3 new groups a day (after that Roomie says so and leaves). Per group, Roomie runs the model at most 30 times per 10 minutes and 200 a day, and 60 a day per person; past the daily ones it says "I'm taking a breather; back tomorrow." once and goes quiet until the next UTC day, past the 10-minute one "Give me a few minutes, I'm catching my breath." A paused group's photos and voice notes aren't fetched even when addressed. Messages are cut to 2,000 characters. `ROOMIE_PAUSED=1` stops everything (the webhook still answers 200, so nothing is replayed later); one group is paused or left from `/admin/groups`.

## Who is a Member (ADR 0010)

Telegram bots can't list a group's members. Roomie knows the person who added it (Admin) and the group's Telegram admins (active Members) at join time. Anyone else becomes a Member when they first speak: **active** if that's within 24 hours of Roomie joining (they were almost certainly already there), **Pending** after that. People Telegram reports as joining (`new_chat_members`) are Pending straight away, and Roomie asks the Admins to approve them.

## Private messages

A DM to the bot from someone who is a Member of exactly one Group is handled as that Group's conversation (Roomie answers in the DM; nothing is logged in the group chat). In no Group: "Add me to your group chat first"; in several: "ask me in the group chat you mean". `/start` from the Admin of a Group that hasn't finished setup sends the **setup DM** (their Claim link button and "Answer the setup here or in the group: what's the group for, currency, city, vibe.", [docs/joining.md](./joining.md)); otherwise one line: for a Member, that DMs work now and how to get the dashboard; for anyone else, how to add Roomie to a group, never a link. When setup is answered (DM or group), the Group's Join link is posted in the group, and `/help` names it. Reminders for one Member arrive here too.

## Webhook (public URL later)

```sh
# APP_URL=https://<public host>, TELEGRAM_WEBHOOK_SECRET set
npm run telegram:webhook -- --set      # points Telegram at <APP_URL>/api/telegram with the secret
npm run telegram:webhook -- --info     # what Telegram has (url, pending updates, last error)
npm run telegram:webhook -- --delete   # back to polling
```

The route answers 401 to anything without the right `X-Telegram-Bot-Api-Secret-Token` (and to everything while `TELEGRAM_WEBHOOK_SECRET` is unset). It answers 200 at once and replies in the background, so it needs a long-running Node server (`next start`), not a serverless function that stops after the response.

## Limits Roomie keeps to (ADR 0001)

Typing indicator and a short pause before each reply; at most about 1 message a second per chat, 20 a minute per group and 25 a second overall; replies over 4096 characters are split; links go as buttons with no previews, and Claim links only ever go out in a DM, on request.
