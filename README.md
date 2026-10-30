# Roomie

**The roommate who actually keeps track.** Add it to the group chat. It handles rent, splits, groceries, chores and the landlord, so none of you have to.

Roomie is a member of your apartment's WhatsApp or Telegram group (WhatsApp in a small beta, Telegram today; Discord and iMessage soon). Say "roomie" and ask; message it privately for what you owe. Every Group also gets a dashboard that everyone signs in to with Google.

## Who it's for

US apartment renters, two to five people on one lease, who'd rather not run Splitwise, a list app, a chores app, calendar reminders and the landlord's email thread one of them is stuck forwarding. Not roommates? It works for trips and friends too (the presets are in code); roommates are who it's built for ([ADR 0015](docs/adr/0015-roommates-first-and-the-five-tricks.md)).

## What it does

Roomie knows Tricks. Roommates start with the first three; Lease Inbox is taught when the group is ready to give the landlord an address.

| Bucket | What it is | Say |
|---|---|---|
| **Roomie itself** | Knows who's in the group, Reminders, the one morning post (rent due, a landlord visit, chores due, items probably low), Polls, DMs, Documents, the weekly Group Report | "remind everyone trash goes out Tuesday 8pm", "what do I owe" (privately) |
| **Money** | Expenses split any way, Balances, Settle up with pay links, Rent and Utilities as recurring Expenses, the private Settle nudge | "I paid 60 for internet", "rent is 2400 on the 1st, Maya pays" |
| **Groceries** | One shared Cart, Recipes, the Pantry, an Instacart list, "I paid 84" splits the shop, Restock ("probably low: milk") | "add milk and eggs", "we're out of dish soap" |
| **House** | The chore chart (Rotation, passes, Streaks) and Upkeep (filters, smoke alarms) in one Trick, two tabs | "I did the dishes", "whose turn is trash?" |
| **Lease Inbox** | The Group's own email address for the landlord: Notices to the chat, Work orders from "the sink's leaking, tell them", replies filed | "the sink's leaking, tell them", "did the landlord email?" |

Outings, Cooking, Trips, Stickers, Guests and Move-out are coming; the landing page takes votes.

## The first five minutes

1. **Add it to the group chat.** Whoever adds it is the Admin. After a minute it says hi in three lines.
2. **Answer one question.** What the group's for, your currency, your city ("roommates, USD, Chicago"). It learns the right Tricks; roommates also get three starter chores and the usual upkeep items.
3. **Open the Join link.** When setup's done Roomie posts one link for everyone. Sign in with Google, pick your name, and the dashboard is yours.
4. **The first morning.** At the Group's nudge hour (9 AM by default) Roomie posts what matters today, and nothing more until someone asks.

## The code

`CLAUDE.md` is the architecture and the conventions; `GLOSSARY.md` the words; `docs/plan.md` the plan; `docs/adr/` the decisions. The short version: all business logic is in `src/services/`, the agent's tools (`src/toolkits/`) and the dashboard (`src/app/`) are thin front doors onto it, and a Trick is a Toolkit folder with a manifest ([docs/toolkits.md](docs/toolkits.md)).

- **Next.js 16** dashboard (server components + server actions), Tailwind v4 + shadcn/ui
- **Neon Auth** (Managed Better Auth) with Google; Members are linked to Accounts by Join links and single-use Claim links
- One **Mastra** agent (`src/mastra`) with per-Group Toolkits, a **Jev Gate** that decides when Roomie speaks, Postgres memory with semantic recall, tracing and scorers; models through Neon's model gateway (`neon/<id>`)
- **Neon Postgres** with **Drizzle** migrations; Telegram (grammY) and WhatsApp (Baileys) behind one Channel adapter

## Local setup

```sh
npm ci
cp .env.example .env     # DATABASE_URL, NEON_AI_GATEWAY_*, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET (see comments)
npm run db:migrate       # apply drizzle/*.sql. The 0000 baseline drops the pre-step-4 tables: it wipes old dev data
npm run seed             # demo Group "Apt 4B"; prints its id, a Claim link for Maya and a Studio requestContext
npm run dev              # dashboard at http://localhost:3000 (DISABLE_SCHEDULER=1 to skip the scheduler)
npm run dev-chat         # a pretend group chat in the terminal, through the real pipeline (docs/dev-chat.md)
```

Open the Claim link the seed printed (single use, 24 hours), sign in with Google, and you land on Apt 4B as Maya, its Admin. `npm run seed` again prints a fresh link; `npm run seed:demo` rebuilds the Group. In dev, Google sign-in uses Neon's shared OAuth credentials (the consent screen shows Neon's name).

`.env` wins over variables already set in your environment (`src/lib/env.ts`). **A 401 from the gateway usually means a system env var is shadowing `.env`**; check that the entry point imports `@/lib/env` first.

### Telegram

1. Create the Telegram account with [@BotFather](https://t.me/BotFather): `/newbot`, then `/setprivacy` â†’ **Disable** and `/setjoingroups` â†’ **Enable** (full checklist in [docs/telegram.md](docs/telegram.md)).
2. Put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` (no @) in `.env`.
3. `npm run telegram` (long polling; no public URL needed), and `npm run dev` for the dashboard.
4. `npm run telegram:check` (read-only) says whether the token, privacy mode, `APP_URL`, the database and the gateway are ready.
5. Add Roomie to a test group. After a minute (`JOIN_DELAY_MS`) it introduces itself. Try `roomie who's here`, `I paid 20 for pizza`, `/help`, and `send us the dashboard`. The 15-minute script for a first real group is [docs/first-group-test.md](docs/first-group-test.md).

### WhatsApp

Roomie is a linked device on a spare number (unofficial client, so not your own number). On Fly: `fly secrets set WHATSAPP_ENABLED=1 ROOMIE_OPERATOR_EMAILS=you@example.com`, deploy, open `/admin/whatsapp` and scan the QR (or use a pairing code). The login lives in Postgres, so redeploys stay linked. Add the number to a group: everyone there becomes a Member, the adder its Admin. Locally: `npm run whatsapp` (only while Fly has it off). The beta allowlist and the landing page's beta form: [docs/whatsapp.md](docs/whatsapp.md), [docs/landing.md](docs/landing.md).

### Splitwise (optional)

Splitwise goes through [Composio](https://composio.dev) with Composio-managed OAuth. Put a Composio project key in `.env` as `COMPOSIO_API_KEY`, open a Group's **Settings** as an Admin and press **Connect** on the Splitwise card; the first run logs `COMPOSIO_SPLITWISE_AUTH_CONFIG_ID=ac_...` for `.env`. Then import a Splitwise group's history, copy ours there once, or keep the two in sync. The same works in the chat ("roomie connect splitwise"). Without a key, `npm run dev-chat` uses an in-memory Splitwise (`SPLITWISE_FAKE=1` anywhere). Details: [ADR 0004](docs/adr/0004-composio-for-instacart-and-splitwise.md), [docs/toolkits.md](docs/toolkits.md).

### Other commands

```sh
npm run telegram         # Roomie on Telegram by long polling (docs/telegram.md)
npm run telegram:webhook -- --set|--delete|--info   # the webhook, once APP_URL is a public https URL
npm run telegram:check   # read-only readiness: token, privacy mode, webhook, APP_URL, DB, gateway, Jev (before a real group)
npm run whatsapp         # Roomie on WhatsApp from this terminal: QR here, or -- --pair <digits> (docs/whatsapp.md)
npm run dev-chat         # a pretend group chat: join, add, say, photo, approve, link, ledger, cart (docs/dev-chat.md)
npm run mastra:dev       # Mastra Studio at http://localhost:4111: chat with Roomie, see traces and scores
npm run db:generate      # after changing src/db/schema.ts: write the next migration into drizzle/
npx tsx scripts/og-image.ts   # rebuild the landing page's share image after changing the headline
```

## Tests

```sh
npm run typecheck     # tsc --noEmit
npm test              # unit tests for the pure functions (split math, Gate, permissions, the landing copy...), no .env needed
npm run test:tools    # every agent tool against the dev DB in throwaway Groups (Splitwise and Instacart on fakes), no LLM
npm run evals         # ~65 chat scenarios through the real Gate and agent; baseline in docs/evals-baseline.md
```

CI runs `typecheck` and `npm test` on every push and pull request.
