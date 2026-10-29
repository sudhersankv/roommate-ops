# Roomie

Roomie is an AI groupmate. You add it to a group chat and it becomes part of the conversation: it splits costs, keeps the group's grocery cart, tracks chores and upkeep, and sets reminders. Each Group also gets a dashboard that everyone signs in to with Google.

**Status: rebuild in progress.** See [docs/plan.md](docs/plan.md) for the plan, [GLOSSARY.md](GLOSSARY.md) for the vocabulary and [docs/adr/](docs/adr) for the decisions. Telegram (`npm run telegram`, [docs/telegram.md](docs/telegram.md)) and WhatsApp (Baileys, on Roomie's own number, [docs/whatsapp.md](docs/whatsapp.md)) sit behind the same Channel adapter. `npm run dev-chat` simulates a group chat in the terminal, and the dashboard's "Ask Roomie" panel works locally.

Architecture and conventions: [CLAUDE.md](CLAUDE.md).

## Stack

- **Next.js 16** dashboard (server components + server actions), Tailwind v4 + shadcn/ui
- **Neon Auth** (Managed Better Auth) with Google; Members are linked to Accounts by single-use **Claim links**
- One **Mastra** agent (`src/mastra`) with per-Group Toolkits, a **Jev Gate** that decides when Roomie speaks, Postgres memory with semantic recall, tracing and scorers; models via the **Neon AI Gateway** (`neon/<id>`)
- **Neon Postgres** with **Drizzle** migrations

## Local setup

```sh
npm ci
cp .env.example .env     # DATABASE_URL, NEON_AI_GATEWAY_*, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET (see comments)
npm run db:migrate       # apply drizzle/*.sql. The 0000 baseline drops the pre-step-4 tables: it wipes old dev data
npm run seed             # demo Group "Apt 4B"; prints its id, a Claim link for Maya and a Studio requestContext
npm run dev              # dashboard at http://localhost:3000 (DISABLE_SCHEDULER=1 to skip the scheduler)
```

Then open the Claim link the seed printed (it's single use and lasts 24 hours), sign in with Google, and you land on Apt 4B as Maya, its Admin. `npm run seed` again prints a fresh link; `npm run seed:demo` rebuilds the Group from scratch.

In dev, Google sign-in uses Neon's shared OAuth credentials (the consent screen shows Neon's name). Localhost is a trusted origin by default.

### Telegram

1. Create the bot with [@BotFather](https://t.me/BotFather): `/newbot`, then `/setprivacy` → **Disable** and `/setjoingroups` → **Enable** (full checklist in [docs/telegram.md](docs/telegram.md)).
2. Put `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` (no @) in `.env`.
3. `npm run telegram` (long polling; no public URL needed), and `npm run dev` for the dashboard.
4. `npm run telegram:check` (read-only) says whether the bot, privacy mode, `APP_URL`, the database and the gateway are ready.
5. Add the bot to a test group. After a minute (`JOIN_DELAY_MS`) it introduces itself; whoever added it is the Admin. Try `roomie who's here`, `I paid 20 for pizza`, `/help`, and `send me the dashboard` (press **Start** in a DM with the bot first, so it can send you the link). The 15-minute script for a first real group is [docs/first-group-test.md](docs/first-group-test.md).

### WhatsApp

Roomie is a linked device on a spare SIM number (unofficial client: ban risk, so not your own number). On Fly: `fly secrets set WHATSAPP_ENABLED=1 ROOMIE_OPERATOR_EMAILS=you@example.com`, deploy, open `/admin/whatsapp` and scan the QR (or use a pairing code). The login lives in Postgres, so redeploys stay linked. Then add the number to a group: everyone there becomes a Member, the adder its Admin. Locally: `npm run whatsapp` (only while Fly has it off). Details: [docs/whatsapp.md](docs/whatsapp.md).

### Chores, upkeep and reminders

Each Group has a time zone (Settings, or the setup answer: "Chicago", "CST", "India" all work), and "today", "Tuesday 8pm" and "this week" follow it. Chores can have a Rotation ("mopping every 3 days: Sam, then Dev, then me"); "skip my turn" passes it on. Roomie posts at most one chores nudge a day (default 9 AM, only when something is due) and a weekly Group Report (default Sunday 6 PM); Admins change both in Settings. Reminders for everyone go to the group chat, reminders for one person go to them privately. The scheduler that sends all of this runs inside `npm run dev`.

### Splitwise (optional)

Splitwise goes through [Composio](https://composio.dev) with Composio-managed OAuth, so there's no Splitwise app to register.

1. Create a project API key in the Composio dashboard and put it in `.env` as `COMPOSIO_API_KEY`.
2. Restart `npm run dev`, open the Group's **Settings** as an Admin and press **Connect** on the Splitwise card. The first time, Roomie finds or creates the Splitwise auth config and logs `COMPOSIO_SPLITWISE_AUTH_CONFIG_ID=ac_...`; copy it into `.env`.
3. Sign in to Splitwise on Composio's page. You come back to Settings (`/g/<id>/settings/splitwise/callback`).
4. Pick a Splitwise group, then **Import its history** (people + every expense and payment), **Copy ours to Splitwise** (a one-time export) or switch on **Live mirror** (new, changed and deleted expenses are pushed by the scheduler within a minute).

The same works in the chat: "roomie connect splitwise", "import our Apt 4B group from splitwise", "copy our expenses to splitwise", "turn on the splitwise mirror". Without a working key the card shows why it's off, and `npm run dev-chat` uses an in-memory Splitwise (`SPLITWISE_FAKE=1` turns that on anywhere). Splitwise's free API is for non-commercial use (ADR 0004).

Other tools:

```sh
npm run telegram         # Roomie on Telegram by long polling (docs/telegram.md)
npm run telegram:webhook -- --set|--delete|--info   # the webhook, once APP_URL is a public https URL
npm run telegram:check   # read-only readiness: bot, privacy mode, webhook, APP_URL, DB, gateway, Jev (before a real group)
npm run whatsapp         # Roomie on WhatsApp from this terminal: QR here, or -- --pair <digits> (docs/whatsapp.md)
npm run dev-chat         # a pretend group chat: join, add, say, photo, approve, link, ledger, cart (docs/dev-chat.md)
npm run mastra:dev       # Mastra Studio at http://localhost:4111: chat with Roomie, see traces and scores
npm run db:generate      # after changing src/db/schema.ts: write the next migration into drizzle/
```

`.env` overrides variables already set in your environment (`src/lib/env.ts`). **If you see 401 from the gateway, a system env var is shadowing `.env`** (for example a stale `NEON_AI_GATEWAY_BASE_URL` from another project); `.env` should win, so check that the entry point imports `@/lib/env` first.

## Tests

```sh
npm run typecheck     # tsc --noEmit
npm test              # unit tests for the pure functions (split math, Gate, permissions, receipts...), no .env needed
npm run test:tools    # every agent tool against the dev DB in throwaway Groups (Splitwise and Instacart on fakes), no LLM
npm run evals         # ~65 chat scenarios through the real Gate and agent; baseline in docs/evals-baseline.md
```

CI runs `typecheck` and `npm test` on every push and pull request.
