# First real group: a 15-minute test

You and one friend, a fresh Telegram group, and `@imroomiebot`. The point is to see Roomie the way a real group will: the first message, the tone, the timing, and when it speaks up or stays quiet (the Gate). Write down anything that feels off; the last section says how to report it.

## Before you start (5 minutes, once)

1. `.env`: for this first run set `JOIN_DELAY_MS=0`, so the intro comes right away (put it back to empty afterwards: in real groups Roomie waits a minute before its first message, ADR 0001). Leave `REPLY_DELAY_MS` empty.
2. `APP_URL`: Claim links and buttons point here.
   - Simplest: `APP_URL=http://localhost:3000`. Telegram refuses localhost buttons, so links arrive as text (`Open dashboard: http://localhost:3000/...`). They only open on the computer running `npm run dev`.
   - Real buttons that open on your phone: run `cloudflared tunnel --url http://localhost:3000` in a third terminal and put the `https://<random>.trycloudflare.com` URL it prints in `APP_URL` (then restart both terminals). The URL changes every time you start the tunnel.
   - If `APP_URL` points at a deployed app (for example a `*.fly.dev` host), links open that server, not your laptop. That's only right if it runs this branch on the same database.
3. Check everything without touching Telegram:

   ```powershell
   Remove-Item Env:NEON_AI_GATEWAY_BASE_URL -ErrorAction SilentlyContinue
   npm run telegram:check
   ```

   It must end with `Ready`. Every `FAIL` line comes with the fix. Two notes worth reading: `Webhook` (if one is set, `npm run telegram` deletes it when it starts, so a deployed bot on that webhook stops receiving messages until you set it again with `npm run telegram:webhook -- --set`) and `can_read_all_group_messages` (must be `true`).

## The two terminals

```powershell
# Terminal 1: the dashboard and the scheduler (reminders, the 9 AM chores nudge, the weekly report)
npm run dev

# Terminal 2: Roomie on Telegram (long polling). Keep this one visible: every message prints [roomie] lines
npm run telegram
```

Terminal 2 says `@imroomiebot is polling`. Leave both running for the whole test.

## The script

Two people: **you** (you add Roomie, so you're its Admin) and **Friend**. Send the messages exactly as written, one at a time, and give Roomie a few seconds between them. "Roomie should" is what good looks like.

| # | Who | Send | Roomie should |
|---|---|---|---|
| 1 | You | Create a new group with Friend, then add `@imroomiebot` to it | Post one intro: names you as admin, asks what the group is for, the currency and the time zone in the same message, and ends with "tap @imroomiebot and press Start". Terminal 2: `[roomie] joined ...` |
| 2 | Both | Open a 1:1 chat with `@imroomiebot` and press **Start** | Reply with one line: "Now I can DM you..." No link. |
| 3 | You | `roommates, USD, Chicago` | Confirm in one or two lines: Toolkits on, three starter chores and five upkeep items added. No "roomie" needed: it's the answer to its question. |
| 4 | Friend | `/help` | Five short lines of what it does. |
| 5 | Friend | `lol this is so weird` | **Nothing.** Chatter isn't for Roomie (a reply here is a Gate false positive). |
| 6 | You | `roomie I paid 60 for internet` | "Logged: $60 internet... $30 each". |
| 7 | Friend | `I did the dishes` | Ask first ("want me to log that?"), because nobody named it. Not log it silently. |
| 8 | Friend | `yes` | Log the dishes for Friend and say whose turn is next. |
| 9 | You | `roomie whose turn is trash?` | Name one person, from the chart. |
| 10 | (whoever's turn it is) | `roomie skip my turn on trash` | Pass it to the other person. If the wrong person sends it, a friendly "it's not your turn". |
| 11 | Friend | `roomie changed the air filter` | Mark the HVAC / air filter done, say when it's next due (about 3 months). |
| 12 | You | `roomie remind everyone trash goes out Tuesday 8pm` | Confirm "Tue <date>, 8:00 PM". Check the date is the coming Tuesday in Chicago time. |
| 13 | You | `roomie remind me in 2 minutes to check the oven` | Confirm the time. **Within about 3 minutes the reminder arrives in your DM**, not in the group (the scheduler in terminal 1 checks once a minute). |
| 14 | Friend | `roomie what's due this week?` | Chores due and upkeep due soon, a few lines. |
| 15 | You | `roomie weekly report` | One message, emoji lines (or plain sentences once Roomie thinks the chat is casual), about 8 lines, no extra chatter around it. |
| 16 | Friend | `send me the dashboard` | Friend gets a Claim link **in the DM**, and the group gets one line saying it went there. Never a link in the group. Open it, sign in with Google, see the Chores page. |
| 17 | Friend | `roomie book us a flight to Lisbon` | A short, honest "can't do that yet", not an invented booking. |

Optional if you have time: add a third person to the group (Roomie asks you to approve them, `roomie approve <name>`), send a receipt photo with `roomie split this receipt`, or change the time zone on the dashboard (Settings → Time zone) and ask `roomie what time is it for you?`.

## What to look for

- **Tone:** brief (1 to 3 lines), friendly, not a help desk. No bullet lists in normal replies. Amounts exact.
- **Timing:** "typing..." then the reply within a few seconds (Sonnet takes 4 to 10 s). Over 20 s is worth noting with the line number from the log.
- **The Gate:** step 5 must stay quiet; step 7 must ask first; steps with "roomie" must always answer. A reply to plain chatter is a false positive; silence after "roomie ..." is a false negative. Both go in the report.
- **Privacy:** Claim links and one-person reminders only ever in DMs.
- **Time zone:** "Tuesday 8pm" lands on the right date at 8:00 PM Chicago time (DST ended on Nov 1, so it's UTC-6).

## Reporting issues

For each problem, copy from terminal 2 the two `[roomie]` lines of that message, for example:

```
[roomie] chat -1001234567890 Friend: "lol this is so weird" | gate act/jev-act | 3.1s | trace 4f0c...
[roomie]   -> "Ha, it is a bit. Want me to..."
```

Add what you sent, what Roomie did, and what it should have done, plus a screenshot of the chat if the tone is the problem. The trace id opens the full run (Gate scores, prompt, tool calls) in Mastra Studio (`npm run mastra:dev`, Traces). Errors print as `[roomie] couldn't handle a message from ...` with the stack; the chat only ever sees "Something went sideways on my end...".

When you're done: Ctrl+C both terminals, set `JOIN_DELAY_MS` back to empty, and if a webhook was set before, run `npm run telegram:webhook -- --set` again.

## WhatsApp variant

The same 15 minutes on WhatsApp, with Roomie's own number linked on Fly ([docs/whatsapp.md](./whatsapp.md)). Easiest on Fly itself, so nothing fights over the session.

**Before you start:** `fly secrets set WHATSAPP_ENABLED=1 ROOMIE_OPERATOR_EMAILS=<your Google email> JOIN_DELAY_MS=0` (put `JOIN_DELAY_MS` back afterwards with `fly secrets unset JOIN_DELAY_MS`), deploy, open `https://<app>/admin/whatsapp`, and link the number (QR or pairing code) until it says **Connected**. Keep `fly logs` open: it shows the same `[roomie]` lines as terminal 2 above. Testing from your laptop instead: `fly secrets set WHATSAPP_ENABLED=0` first, then `npm run dev` + `npm run whatsapp` on the same database.

Run the script above with these differences:

| # | On WhatsApp |
|---|---|
| 1 | Create a WhatsApp group with Friend and add Roomie's number. The intro names you as admin and asks the setup questions, with **no** "press Start" line. Everyone in the group is already a Member (`roomie who's here` lists you both right away, not as they speak). |
| 2 | Skip it: WhatsApp lets Roomie message you first. Typing `/start` to Roomie privately still gets one line, never a link. |
| 4 | `/help` works if typed; nobody needs it. |
| 13 | The reminder arrives as a private WhatsApp chat from Roomie. |
| 16 | The Claim link arrives in a private chat from Roomie as a last line `Open dashboard — https://...` (no button), with no preview. Never in the group. |

Also try: @mention Roomie (type `@` and pick it) instead of writing "roomie", reply to one of its messages, send a voice note, send a receipt photo, add a third person (Roomie asks you to approve them), and rename the group (Roomie keeps the new subject as the Chat's title; the Group's own name doesn't change). On `/admin/whatsapp`, nothing should change during the test: it stays **Connected**.
