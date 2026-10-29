# Roomie: rebuild plan

Status: **draft, waiting for sign-off.** Vocabulary is in [`GLOSSARY.md`](../GLOSSARY.md); the big decisions are in [`docs/adr/`](./adr).

## What Roomie is

Roomie is an AI groupmate. You add it to a WhatsApp group and it becomes part of the chat: it splits costs like a mini Splitwise, keeps the group's grocery cart, writes recipes, tracks chores, and later does research, makes PDFs, plans trips and makes stickers. Each of these is a **Toolkit** that a Group switches on. Everyone in the group signs in with Google to see their own view of that group's dashboard.

Roomie is a groupmate, not a platform: brief, witty, exact about facts, and it slowly picks up each group's slang and languages.

## Decisions

| Area | Decision |
|---|---|
| Channel | **Telegram first** (official Bot API, no ban risk; step 2b), then WhatsApp through **Baileys**, in the Next process with its session in Postgres, on a dedicated carrier number, both behind the Channel adapter ([ADR 0001](./adr/0001-baileys-for-whatsapp-groups.md), [ADR 0013](./adr/0013-whatsapp-via-baileys.md)). |
| Agent | One **Mastra** agent (`roomie`), built once. Per-request context goes through `RequestContext`, and tools come from the Group's Toolkits ([ADR 0005](./adr/0005-toolkits-and-one-agent.md)). |
| Models (Neon AI Gateway) | `claude-sonnet-5-5` for the agent and recipes. `claude-haiku-5-5` for background summaries and Group style. `typesafeai-jev-1-14-0` for the Gate ([ADR 0002](./adr/0002-jev-gate-before-the-agent.md)). `qwen3-embedding-0-6b` for semantic recall. |
| Observability | Mastra tracing to the **Mastra platform** (`MastraPlatformExporter`) and to local storage for Studio. About 10% of live replies are scored. `npm run evals` runs a fixed scenario set. |
| When Roomie speaks | Hard triggers ("roomie", @-mention, a reply to Roomie, a voice note); the follow-up window after it speaks; or the Gate says act or clarify above the Group's Chattiness thresholds (default: normal). Roomie asks before logging anything it wasn't asked to log. |
| Identity | **Neon Auth** with Google. Members are linked to Accounts by **Claim links** sent in private messages ([ADR 0003](./adr/0003-neon-auth-and-claim-links.md)). Whoever adds Roomie is the first Admin. New Members are Pending until an Admin approves them in the chat or on the dashboard. |
| Integrations | Instacart and Splitwise through **Composio**, wrapped in Roomie's own tools ([ADR 0004](./adr/0004-composio-for-instacart-and-splitwise.md)). |
| Money | Integer cents, computed in code ([ADR 0007](./adr/0007-money-is-integer-cents-computed-in-code.md)). One currency per Group. |
| Personality | Each Group's Roomie is its pet: an archetype (chill by default, hype, deadpan, mom, gremlin, butler), a name, quirks and sliders the Admin sets, plus a Learned style counted from the messages. It borrows slang gradually and never more than the group ([ADR 0012](./adr/0012-personality-archetype-sliders-learned-style.md), [docs/personality.md](./personality.md)). Jokes are a trait, not a Toolkit. |
| Privacy | Raw chat is kept for 30 days. "roomie forget me" and an Admin "delete group data" are available ([ADR 0006](./adr/0006-chat-retention.md)). |
| Dashboard | Next.js 16, mobile-first, **Tailwind + shadcn/ui**. One dashboard per Group, with a group switcher. An app-style dock (Home, up to 3 learned Tricks, Ask Roomie, More); More opens a drawer with every Trick (greyed slots for not learned yet and Soon), Members and Settings. |
| Vocabulary (in-app) | People see **Tricks**: Roomie joins any group (roommates, a trip, friends, family, work, a club) and is **taught** Tricks ("roomie, learn trips") or made to **forget** them. "Toolkit" stays a code word only; "pet" and the slow adaptation stay implicit (GLOSSARY, docs/toolkits.md, docs/personality.md). |
| Data | Fresh schema, using Drizzle **migrations** (`drizzle-kit generate` + `migrate`) instead of `push`. The new Neon database starts empty. |
| Hosting | One always-on Fly machine (`fly.toml`, `Dockerfile`): Next serves the dashboard, API and Telegram webhook, runs the scheduler and, with `WHATSAPP_ENABLED=1`, holds the WhatsApp socket. Locally: `npm run dev`, `npm run telegram` (long polling), `npm run whatsapp`. CI runs typecheck and tests. |

## How a message flows

```
WhatsApp ─▶ Channel adapter (Baileys) ─▶ normalize to IncomingMessage
   ─▶ resolve Group + Member (create on first contact; Pending if new)
   ─▶ store chat line (30-day retention)
   ─▶ Gate: hard trigger? follow-up window? else Jev {intent, addressed, toolkit}
   ─▶ ignore ──▶ done
   ─▶ act / clarify ──▶ roomie.generate(text, { requestContext: {groupId, memberId, role, toolkit}, memory })
          tools = enabled Toolkits ∩ Gate's toolkit (+ core tools)
          services enforce permissions (Pending, Admin, ownership)
   ─▶ reply text + attachments/links ─▶ Channel adapter ─▶ WhatsApp
Every step is one Mastra trace tagged with groupId, memberId, toolkit, and the Gate's decision.
```

The dashboard's "Ask Roomie" panel and Mastra Studio use the same path without the Channel adapter.

## Target layout

```
src/
  mastra/
    index.ts              new Mastra({ agents, storage, observability, scorers })
    agents/roomie.ts      instructions(fn of requestContext), tools(fn), memory
    gate/                 Jev Gate + fallback, Chattiness thresholds
    memory.ts             PostgresStore + PgVector, Group style, Member notes
    scorers/              brevity/tone + built-ins
    evals/                scenarios + runner
  toolkits/
    registry.ts           the list of Toolkits
    core/                 members, onboarding, approvals, reminders, settings
    splitting/            manifest, tools, service, schema, page
    groceries/
    chores/
    upkeep/
  channels/
    types.ts              IncomingMessage, Outgoing, Channel
    whatsapp/             Baileys adapter + session store
  pipeline.ts             the flow above, channel-agnostic
  db/                     schema barrel (imports each Toolkit's tables), client, migrations/
  auth/                   Neon Auth setup, session → Member for a Group
  integrations/composio.ts
  app/                    dashboard (per-Group routes), api/
scripts/                  wa.ts, seed.ts, evals.ts
```

## Data model (sketch, finalized in step 4)

- **Core:** `groups` (name, currency, timezone, chattiness, purpose); `chats` (group, channel, external id); `members` (group, account?, channel identity, display name, role admin|member, status pending|active|removed); `claim_tokens`; `group_toolkits` (group, toolkit, enabled, settings); `chat_messages` (30-day retention); `member_notes`; `activity`.
- **Splitting:** `expenses` (group, description, category, note, date, currency, cents, recurring?, created_by, deleted_at); `expense_payers` (expense, member, cents); `expense_shares` (expense, member, cents, method); `settlements`; `payment_handles` (member, venmo|paypal|cashapp, handle); `splitwise_links` (group, splitwise group id, mode import|mirror, last sync).
- **Groceries:** `cart_items` (group, name, qty, added_by, shared, est_cents, status); `recipes` (group, title, servings, ingredients, steps, instacart_url).
- **Chores / Upkeep / Reminders:** carried over from today's tables, re-keyed to `groups`.

## Steps

Each step gets its own branch and PR, and you test locally before it's merged. Steps 1 to 7 are done (step 2, WhatsApp, waits for its live test on Fly). Next: the first real Telegram and WhatsApp groups ([docs/first-group-test.md](./first-group-test.md)).

### 1. Rename and clean slate (`step/1-roomie`) ✅ done
- Rename Kevin to Roomie everywhere: package, code identifiers, UI text, docs. "roomie" becomes the trigger word, with a fresh neutral-witty persona. The full persona work happens in step 3.
- Delete Telegram, AgentMail/leasing, rent reminders, the fake "Kevin's Market", Fly (`fly.toml`, `.github/workflows/fly-deploy.yml`) and the smoke scripts that write to real data.
- Rewrite `.env.example`, `README.md` and `CLAUDE.md`. Add CI (typecheck + `npm test`).
- **Done when:** typecheck and tests pass, `git grep -i kevin` finds only ADRs and history notes, and the dashboard boots against the empty database.

### 2. WhatsApp channel (`feat/whatsapp`) ✅ built, waiting for the live test
- [x] Baileys 7 in the Next process (`src/channels/whatsapp.ts`, [ADR 0013](./adr/0013-whatsapp-via-baileys.md), [docs/whatsapp.md](./whatsapp.md)): Roomie added -> Onboarding with the whole member list (adder = Admin, everyone active), later joiners Pending + approval ask, text / captions / photos (receipts) / voice notes (OpenRouter when set), @-mentions and replies, DMs from a Member of one Group, subject changes.
- [x] Session in Postgres (`wa_sessions`), reconnect with backoff, `loggedOut` clears it; login by QR or pairing code on `/admin/whatsapp` (operators only, `ROOMIE_OPERATOR_EMAILS`); `npm run whatsapp` for local runs.
- [x] One canonical id per person: the phone JID when resolvable, else the LID; pairs in `wa_contacts`, Members moved when the number turns up.
- [x] Anti-ban: join delay, "typing..." and pauses, per-Chat and global rate limits, links as trailing lines without previews, Claim links only in private chats. Replays after a reconnect are deduplicated.
- **Done when:** Roomie in a test group answers "roomie hi", transcribes a voice note, and can send a private message to a Member.
  - [x] all of it offline against a fake socket (`whatsapp.test.ts`) · [ ] live, on Fly with the real number ([first-group-test.md](./first-group-test.md#whatsapp-variant))

### 2b. Telegram channel (`step/2b-telegram`) ✅ done
- [x] grammY adapter (`src/channels/telegram.ts`): Roomie added to a group -> Onboarding (adder = Admin, the group's Telegram admins active, intro after `JOIN_DELAY_MS`), `new_chat_members` -> Pending + approval ask, text / captions / photos (receipts) / voice notes (OpenRouter when set), @-mentions and replies to Roomie, DMs from a Member of one Group, supergroup upgrades.
- [x] Outbound: typing + human-like pause, per-Chat and global rate limits, 4096-character chunks, URL buttons. Claim links only by DM; when Telegram refuses (the person never pressed Start) Roomie tells them to tap @bot and press Start.
- [x] Telegram can't list members: first-time senders within 24 h of the join are active, later ones Pending ([ADR 0010](./adr/0010-telegram-cant-list-group-members.md)).
- [x] `npm run telegram` (long polling, local) and `/api/telegram` (webhook with a secret, for a public URL; `npm run telegram:webhook`). Offline tests with fake updates.
- **Done when:** in a real test group, Roomie introduces itself, logs "I paid 20 for pizza", approves a newcomer, and DMs a Claim link that signs someone in ([docs/telegram.md](./telegram.md)).
  - [x] all of it offline against the real pipeline and dev DB with a fake token · [ ] live, waiting for the bot token (BotFather checklist in docs/telegram.md)

### 3. Mastra agent rebuild (`step/3-agent`) ✅ done
- [x] `src/mastra/` with a `roomie` agent built once: `RequestContext` with a schema, dynamic instructions (persona, Group style, Members, time zone) and dynamic tools from the Toolkit registry.
- [x] Memory: Postgres storage, a thread per Group, semantic recall with pgvector embeddings (`qwen3-embedding-0-6b` on the gateway), and Member notes plus the Group style in working memory (refreshed by Haiku every 50 chat lines).
- [x] The Gate (Jev, with a hard-trigger fallback) and Chattiness (`groups.chattiness`).
- [x] Observability: platform and storage exporters, a sensitive-data filter, `requestContextKeys`, and trace tags. The platform exporter switches on when its token and project id are in `.env`.
- [x] Scorers sampled on live traffic, and a scenario set of about 30 cases with `npm run evals` ([baseline](./evals-baseline.md)). Mastra Studio via `npm run mastra:dev` with request-context presets.
- [x] Move today's tools into the Toolkit shape: core, splitting (basic), groceries (basic), chores, upkeep.
- **Done when:** Studio chats work, traces show up on the Mastra platform, the Gate has unit tests, and the eval baseline is recorded.
  - [x] Studio chats work · [ ] traces on the Mastra platform (waiting for `MASTRA_PLATFORM_ACCESS_TOKEN` / `MASTRA_PROJECT_ID`; traces are in Postgres and Studio today) · [x] Gate unit tests · [x] eval baseline

### 4. Identity, Groups and dashboard shell (`step/4-identity`) ✅ done
- [x] Fresh schema with migrations (`drizzle/`, `npm run db:migrate`). Neon Auth with Google. Claim links, roles, Pending members, and the approval flow in both chat and dashboard. Permission checks in services (`services/authz.ts`).
- [x] Onboarding: Roomie joins, introduces itself, creates the Group, makes the adder Admin, reads the members, and asks the Group's purpose, currency, time zone and Toolkits in one message (`src/onboarding.ts`; the 1–3 minute wait belongs to the WhatsApp adapter). Claim links are **not** sent in a burst. A Member gets theirs privately when they ask for the dashboard ([ADR 0001](./adr/0001-baileys-for-whatsapp-groups.md)). People already in the Chat are active; later joiners are Pending ([ADR 0008](./adr/0008-who-is-pending.md)).
- [x] Dashboard rebuilt on Tailwind + shadcn from the prototype: sign in, group switcher, a personal home ("you owe / you're owed", your Cart items, your chores), and Members and Settings for Admins.
- [x] The 30-day retention job, "forget me", and "delete group data".
- [x] `npm run dev-chat` stands in for WhatsApp until step 2 ([walkthrough](./dev-chat.md)).
- **Done when:** a new person in the test group goes from Pending to approved to claimed to seeing their own dashboard, and a non-Admin can't change Members or settings anywhere.
  - [x] Pending -> approved -> claimed -> own dashboard (dev-chat + browser, with the dev sign-in bypass for the Google step) · [x] non-Admins see no admin controls and every admin service refuses them · [ ] the same in a real WhatsApp group (step 2)

### 5. Splitting Toolkit (`step/5-splitting`) ✅ done
- [x] Split equally, by exact amounts, by percentages or by shares. Multiple Payers. Categories (picked by Roomie), notes, dates, recurring Expenses, edit/delete/undo, Activity, a simplify-debts toggle, and a Settle plan with Venmo, PayPal and Cash App links (`services/split.ts`, `services/money.ts`, `services/recurring.ts`; migration 0001).
- [x] Receipt photo to Expense (vision model: `claude-sonnet-5-5` reads `image_url` on the gateway), with per-item assignment ("I had the steak"); sums are recomputed and a mismatch makes Roomie ask (`services/receipts.ts`, `expense_from_receipt`, Scan receipt in the drawer).
- [x] Splitwise through Composio: connect, import a group (people plus full history), and export as a one-time copy or a live mirror (`integrations/splitwise.ts`, `services/splitwise.ts`, the outbox in [ADR 0009](./adr/0009-outbox-for-splitwise-mirror-pushes.md)).
- [x] A Splitwise-style money page: a balances header, an Expense list with Shares visible, and add/edit sheets with every split method, several Payers, category, date, note and repeats.
- **Done when:** the "$90 dinner, 50/25/25" scenario, multi-payer, edit and undo all match to the cent between chat and dashboard, and a Splitwise import and export round-trips on a test group.
  - [x] 50/25/25, 2:2:1, multi-payer, edit and undo match to the cent between dev-chat and the dashboard ([walkthrough](./dev-chat.md)) · [x] Splitwise import, export and mirror round-trip against the in-memory fake (`npm run test:tools`) · [ ] the same against real Splitwise (blocked on a valid `COMPOSIO_API_KEY`; the current one gets 401, which the app reports as "Splitwise isn't available")

### 6. Groceries Toolkit (`step/6-groceries`) ✅ done
- [x] Cart (personal vs shared items, estimated prices, Recipe sub-groups, remove your own or as an Admin) and an Instacart shopping-list link through Composio, recorded as a Checkout (`services/cart.ts`, `integrations/instacart.ts`; migration 0003). "I paid $84" becomes one exact Expense (category groceries) split by who wanted what, weighted by the estimates (`computeCartSplits`, which the dashboard previews with).
- [x] Recipes: "tacos for 5 friday" gives a scaled Recipe (Sonnet, strict JSON, Instacart units, one retry) and an Instacart recipe link, cached until the ingredients change. Ingredients go into the Cart only when someone asks or clearly means it, minus the Pantry and what they say they have (`services/recipes.ts`, `services/pantry.ts`).
- [x] The Cart page: Recipe cards and detail, a New recipe sheet, the Pantry editor, Get Instacart link, and the "I paid" drawer. Home shows the next planned Recipe.
- **Done when:** a recipe, a cart, the checkout link and the paid-to-Expense step all work end to end in the test group.
  - [x] Recipe -> "yes add them, we have onions" -> checkout link -> "I paid 84" match to the cent between dev-chat and the dashboard's preview ([walkthrough](./dev-chat.md)) · [x] the Instacart link, verified against the fake · [ ] the real Instacart link (blocked on a valid `COMPOSIO_API_KEY`; Composio lists Instacart as "no auth", so no Instacart auth config is needed, but that is unconfirmed until a real call) · [ ] the same in a real WhatsApp group (step 2)

### 7. Chores and Upkeep Toolkits (`step/7-household`) ✅ done
- [x] Group time zones for real: `lib/time.ts` (wall-clock to instant across DST, local days, next weekday, "Chicago" / "CST" / "India" to IANA). Every "today", "Tuesday 8pm", "this week", due day and report window uses the Group's zone; the hard-coded Chicago is gone (migration 0004).
- [x] Chores: a Rotation per chore (or everyone, least recent first), passes (`chore_skip`), local due days, streaks per Member, logging for someone else, add and remove (Admin), the chart (`hall_of_shame`), Activity for done, pass, add, change and remove.
- [x] Upkeep: local due days, due soon (7 days) and late, `upkeep_add` / `upkeep_done` / `upkeep_status` / `upkeep_remove`, the usual five (added at Onboarding for roommates and families, together with three starter chores).
- [x] Reminders (core): one-off, daily, weekly, monthly; the whole Group's go to the Chat, one Member's privately ("(set by Maya)"); wall-clock in the Group's zone; list and cancel with privacy rules.
- [x] The scheduler: the daily chores nudge (`nudgeHour`, default 9 local, only when something is due) and the weekly Group Report (default Sunday 18:00 local), each claimed in `scheduled_posts` so it goes out once per period (ADR 0001). The upkeep nudge is folded into the report.
- [x] Dashboard: the Chores page (Chores / Upkeep / Reminders), Home's Today strip, Settings (time zone by region, nudge hour, report day and hour).
- [x] Telegram readiness: `npm run telegram:check`, `/help`, a one-line `/start`, friendly failures, `[roomie]` log lines, [docs/first-group-test.md](./first-group-test.md).
- **Done when:** the chores and upkeep scenarios pass in evals and show up on the dashboard.
  - [x] evals ([baseline](./evals-baseline.md)) · [x] the dashboard (`design/screens/real-chores-*.jpeg`) · [x] the dev-chat walkthrough ([docs/dev-chat.md](./dev-chat.md)) · [ ] the same in a real Telegram group ([docs/first-group-test.md](./first-group-test.md))

### Landing page and WhatsApp beta (`feat/landing`) ✅ done
- [x] `/` signed out is the public landing page ([docs/landing.md](./landing.md)): hero with Add to Telegram (`t.me/imroomiebot?startgroup=true`) and Join the WhatsApp beta, fake chats per Toolkit and per vibe (copy from `ARCHETYPES`), how it works, the dashboard in phones, the six vibes, the footer; Open Graph image `public/landing/og.png`. Signed in, `/` is unchanged.
- [x] Sign-in moved to `/signin` (Google, paste a Claim link, `auth_error`); the proxy sends signed-out dashboard visitors to `/signin?next=<path>` and `/signin` continues there after Google. `/admin/*` is a 404 for anyone but a signed-in operator.
- [x] The WhatsApp beta form -> `beta_requests` (migration 0007; honeypot, zod, 3 per IP per hour, IP stored only as an HMAC) -> a Telegram DM to the operator (or a `[beta]` log line) -> `/admin/beta` with a status per request. `/privacy`.
- **Done when:** a request from the form lands in the table, the operator hears about it and can mark it contacted.
  - [x] form -> row -> `[beta]` fallback log, in a local smoke test (`design/screens/landing-*.jpeg`) · [ ] the Telegram DM on Fly (needs `ROOMIE_OPERATOR_EMAILS` and the operator's claimed Telegram Member who pressed Start)

## Parked (v2 / v3)

- **v2:** Research (web search), PDF generation (itineraries, receipts, summaries), and Trip planning, which builds on Research, PDF and Splitting.
- **v3:** Stickers from Members' photos (the gateway lists no image-generation model yet, so check again when we get there).
- **Gmail through Composio:** rent and leasing-office email.
- **Before a public launch:** an official WhatsApp or Photon adapter, a Splitwise licence decision, and hosting.

## Your to-dos

- [ ] Create the Telegram bot with BotFather (privacy off, join groups on) and put `TELEGRAM_BOT_TOKEN` + `TELEGRAM_BOT_USERNAME` in `.env` ([docs/telegram.md](./telegram.md)).
- [ ] Roomie's WhatsApp number: a real prepaid eSIM or SIM you **keep** (for example Tello, about $5/month). Not Google Voice and not a rented SMS-verification number. Use the WhatsApp Business app, turn on two-step verification, warm it up for a few days, and open it at least weekly. Then link it on Fly ([docs/whatsapp.md](./whatsapp.md)): `fly secrets set WHATSAPP_ENABLED=1 ROOMIE_OPERATOR_EMAILS=<you>`, deploy, scan the QR at `/admin/whatsapp`.
- [ ] Mastra platform: `MASTRA_PLATFORM_ACCESS_TOKEN` and `MASTRA_PROJECT_ID` in `.env`.
- [ ] Composio: a valid `COMPOSIO_API_KEY` in `.env` (the current one is rejected with 401). Then connect Splitwise once from Settings and put the logged `COMPOSIO_SPLITWISE_AUTH_CONFIG_ID` in `.env`, and press "Get Instacart link" on the Cart page once to confirm Instacart works with no Instacart key.
- [ ] Google Cloud OAuth client for Neon Auth, before anyone outside the dev team signs in (dev uses Neon's shared Google keys; the consent screen shows Neon). Add it under the branch's Auth -> OAuth providers. At the same time, turn off email+password sign-up on that branch (Neon enables it by default; Roomie only uses Google).

## Environment

```
DATABASE_URL                     Neon Postgres (app + Mastra memory)
NEON_AI_GATEWAY_BASE_URL/TOKEN   models
LLM_MODEL=claude-sonnet-5-5      agent
SMALL_MODEL=claude-haiku-5-5     background jobs
GATE_MODEL=typesafeai-jev-1-14-0 Gate
EMBED_MODEL=qwen3-embedding-0-6b semantic recall
MASTRA_PLATFORM_ACCESS_TOKEN, MASTRA_PROJECT_ID
COMPOSIO_API_KEY, COMPOSIO_SPLITWISE_AUTH_CONFIG_ID   Splitwise (SPLITWISE_FAKE=1: in-memory fake)
                                 Instacart needs only the key (INSTACART_FAKE=1: instacart.example links)
NEON_AUTH_BASE_URL               Neon Auth URL (branch -> Auth)
NEON_AUTH_COOKIE_SECRET          32+ chars, ours
DEV_AUTH_EMAIL                   dev-only sign-in bypass for browser automation
APP_URL=http://localhost:3000    links Roomie sends
TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME, TELEGRAM_WEBHOOK_SECRET   Telegram (docs/telegram.md)
WHATSAPP_ENABLED=1               this process holds the WhatsApp socket (docs/whatsapp.md); WA_LOG = Baileys' log level
ROOMIE_OPERATOR_EMAILS           who may open /admin/whatsapp (comma-separated)
JOIN_DELAY_MS, REPLY_DELAY_MS    pacing: intro delay after joining, pause before replies
```
