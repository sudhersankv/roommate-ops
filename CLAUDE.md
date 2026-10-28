# Kevin → Roomie (rebuild in progress)

> **Read first:** this project is being rebuilt as **Roomie**, an AI groupmate on WhatsApp with per-Group Toolkits.
> The plan is in `docs/plan.md`, the vocabulary in `GLOSSARY.md`, and the decisions in `docs/adr/`. Where they conflict
> with the description below, they win. Everything below describes the old Kevin code, which step 1 replaces.

# Kevin

Kevin is a roommate assistant that lives in the house group chat (Telegram first) and a dashboard. He splits bills, keeps the grocery cart, tracks chores, reminds about rent, and emails the leasing office. Persona: Kevin from Home Alone, left in charge of the house. Brief, cheeky, never mean. "Nobody cheats Kevin."

Hackathon build: deadline 4:30 PM, feature freeze 3:30 PM. Ship small, working slices. Full plan: `plans/kevin-build-plan.md`.

## The one rule

**All business logic lives in `src/services/`.** Kevin's tools (`src/agent/tools/`) and the dashboard (`src/app/`) are thin front doors that call the same service functions. Anything you can do in chat must be doable in the UI, and vice versa. Never put logic in a tool or a page that belongs in a service.

## Layout

```
src/
  db/schema.ts          Drizzle tables (shared contract; tell the other person before changing)
  db/index.ts           db client
  services/             (ctx: Ctx, input) => result. Source of truth. index.ts re-exports as namespaces.
    types.ts            Ctx { householdId, actorId, source }, dollars()
    members.ts chatlog.ts            implemented (P0)
    money.ts cart.ts chores.ts reminders.ts leasing.ts upkeep.ts report.ts   stubs: signatures fixed, bodies TODO
  agent/kevin.ts        askKevin(ctx, text, chatter) -> { text, buttons }. Mastra Agent built per request.
  agent/tools/*.ts      one file per module; createTool -> service call. index.ts merges them.
  channels/types.ts     IncomingMessage, Outgoing, Channel { send(householdId, msg) }
  channels/telegram.ts  grammY bot + telegram.send()
  router.ts             logs every message, decides if Kevin replies, calls askKevin
  lib/llm.ts            model id for the Neon AI Gateway ("neon/<id>")
  lib/voice.ts          speech-to-text (OpenRouter, STT_MODEL)
  lib/instacart.ts lib/agentmail.ts   integration clients
  lib/dashboard.ts      dashboardCtx(): first household + "actor" cookie member
  jobs/scheduler.ts     60 s tick: due reminders, weekly report, upkeep nudge, AgentMail inbox poll -> telegram.send
  instrumentation.ts    starts the scheduler once
  components/           ui.tsx (PageHead, Empty, NoHousehold), nav-links, ask-kevin panel, tz-offset
  app/                  dashboard pages + api/{telegram,chat,agentmail}
    page.tsx            Home = the Kevin Report
    money/ cart/ cart/checkout/ chores/ reminders/ inbox/ upkeep/ members/
scripts/poll.ts         local dev: Telegram long polling (deletes the webhook)
scripts/telegram-webhook.ts   setWebhook/deleteWebhook + getWebhookInfo (npm run telegram:webhook [-- --delete])
scripts/seed.ts         bare demo house "Apt 4B"; `npm run seed:demo` loads three weeks of history into it
scripts/kevin-smoke.ts  demo utterances through the real agent (npm run kevin:smoke)
docs/DEMO.md            presenter walkthrough
```

## Ownership

- **Sudhersan:** `src/services/*` and `src/app/**` pages (taken over from Ryan), plus `src/agent/**`, `src/channels/**`, `src/router.ts`, `src/lib/{llm,voice,instacart,agentmail}.ts`, `src/jobs/**`, `app/api/{telegram,chat}`.
- **Ryan:** `src/db/*`, `app/api/agentmail`, `scripts/seed.ts`. Older `TODO(Ryan, ...)` comments in services/pages now belong to Sudhersan.
- `TODO(Name, P#)` comments mark who fills what. Grep `TODO(` to see what's left.
- Service **signatures** are the contract. Change a body freely; change a signature only together with its tool.

## Conventions

- Money is **integer cents** everywhere in services and the DB. Tools accept dollars from the model and convert with `toCents()`. The LLM never does math: balances, splits and totals come from services.
- Every service takes `ctx: Ctx` first. `ctx.actorId` is the sender in chat or the selected member in the UI; use it as the default payer/doer/adder.
- Tools resolve names to ids with `memberIdByName()` and throw a helpful error on unknown names (the model then asks).
- Tools attach buttons via the `outbox` (see `cart_checkout`), not by pasting URLs.
- Dashboard pattern: see `app/members/page.tsx`. Server components read services; server actions write then `revalidatePath`. Pages are `force-dynamic`.
- Keep Kevin's replies to 1 to 3 short lines.

## Library notes (versions in package-lock)

- **Mastra v1:** `createTool({ id, description, inputSchema, execute: async (input, context) => ... })`. The first arg is the parsed input, not `{ context }`. Agent needs `id`. Memory call: `agent.generate(text, { memory: { thread, resource } })`.
- **LLM:** Neon AI Gateway through Mastra's model router: `model = "neon/<id>"` in `lib/llm.ts`, which reads `NEON_AI_GATEWAY_BASE_URL` + `NEON_AI_GATEWAY_TOKEN`. Use ids from the branch's `/v1/models`.
- **Voice:** no Whisper on the gateway. `lib/voice.ts` sends the Telegram .ogg to OpenRouter (`OPENROUTER_API_KEY`, `STT_MODEL`, an audio-capable chat model) as an `input_audio` chat part and uses the text reply as the transcript. The router then treats it like a typed message (voice notes always get a reply).
- **grammY:** webhook via `webhookCallback(bot, "std/http")` in `app/api/telegram`. Locally use `npm run poll` (it deletes the webhook; re-set it with `npm run telegram:webhook` after).
- **Next 16:** Mastra and pg are in `serverExternalPackages`.

## Commands

```
npm install
cp .env.example .env          # fill DATABASE_URL, NEON_AI_GATEWAY_BASE_URL/TOKEN, LLM_MODEL, OPENROUTER_API_KEY, STT_MODEL,
                              #      TELEGRAM_BOT_TOKEN/USERNAME/WEBHOOK_SECRET, AGENTMAIL_API_KEY/INBOX, APP_URL
npm run db:push               # create tables on Neon
TELEGRAM_CHAT_ID=-100... npm run seed        # bare house, or:
TELEGRAM_CHAT_ID=-100... npm run seed:demo   # Apt 4B with three weeks of history (the demo house)
npm run poll                  # Kevin in your group, locally (deletes the webhook)
npm run dev                   # dashboard at localhost:3000 (scheduler runs here too; DISABLE_SCHEDULER=1 to skip)
npm run typecheck && npm test # tsc + unit tests (no .env)
npm run test:tools            # every tool against the dev DB in a throwaway household, no LLM
npm run kevin:smoke           # demo utterances through the real agent (writes rows to the first household)
npm run telegram:webhook      # setWebhook -> $APP_URL/api/telegram, prints getWebhookInfo (-- --delete to remove)
```

Deploy: `fly launch --no-deploy` (once), `fly secrets set ...` for every var in `.env.example`, `fly deploy --ha=false` (one Machine; the scheduler is in-process), then `npm run telegram:webhook`. Deploy after every priority. Presenter notes: `docs/DEMO.md`.

## Before you commit

`npm run typecheck` must pass. Test a service with a quick `tsx` script or a `*.test.ts` before wiring its tool or page. Commit to `main` in small pieces.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
