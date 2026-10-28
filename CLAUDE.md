# Roomie

Roomie is an AI groupmate that lives in a group chat and on a per-group dashboard. It splits costs, keeps the shared grocery cart, tracks chores and upkeep, and sets reminders. Persona: a friendly, witty, brief groupmate; exact about facts.

**Read first:** the rebuild plan is in `docs/plan.md`, the vocabulary in `GLOSSARY.md`, and the decisions in `docs/adr/`. They are the spec; where they conflict with this file, they win. Step 1 (rename and clean slate) is done; the code below is what exists today. Some names still predate the glossary (`households`/`householdId` become Groups in step 4).

Agent skills for this repo live in `.agents/skills/`.

## The one rule

**All business logic lives in `src/services/`.** The agent's tools (`src/agent/tools/`) and the dashboard (`src/app/`) are thin front doors that call the same service functions. Anything you can do in chat must be doable in the UI, and vice versa. Never put logic in a tool or a page that belongs in a service.

## Layout

```
src/
  db/schema.ts          Drizzle tables
  db/index.ts           db client
  services/             (ctx: Ctx, input) => result. Source of truth. index.ts re-exports as namespaces.
    types.ts            Ctx { householdId, actorId, source }, dollars()
    members.ts chatlog.ts money.ts cart.ts chores.ts reminders.ts upkeep.ts report.ts
  agent/roomie.ts       askRoomie(ctx, text, chatter) -> { text, buttons }. Mastra Agent built per request.
  agent/tools/*.ts      one file per module; createTool -> service call. index.ts merges them.
  channels/types.ts     IncomingMessage, Outgoing, Channel
  channels/index.ts     deliver(householdId, out): outbound posts; only logs until a channel exists (step 2)
  router.ts             logs every message, decides if Roomie replies (policy in router-policy.ts), calls askRoomie
  lib/llm.ts            model id for the Neon AI Gateway ("neon/<id>")
  lib/voice.ts          speech-to-text (OpenRouter, STT_MODEL), optional
  lib/prices.ts         grocery price estimates
  lib/dashboard.ts      dashboardCtx(): first household + "actor" cookie member (no auth until step 4)
  jobs/scheduler.ts     60 s tick: due reminders, weekly Group Report, upkeep nudge -> channels.deliver
  instrumentation.ts    starts the scheduler once (DISABLE_SCHEDULER=1 skips it)
  components/           ui.tsx (PageHead, Empty, NoHousehold), nav-links, ask-roomie panel, tz-offset
  app/                  dashboard pages + api/chat
    page.tsx            Home = the Group Report as cards
    money/ cart/ chores/ reminders/ upkeep/ members/
scripts/seed.ts         demo group "Apt 4B"; `npm run seed:demo` loads three weeks of history into it
spikes/                 throwaway experiments (WhatsApp/Baileys)
```

## Conventions

- Money is **integer cents** everywhere in services and the DB. Tools accept dollars from the model and convert with `toCents()`. The LLM never does math: balances, splits and totals come from services ([ADR 0007](docs/adr/0007-money-is-integer-cents-computed-in-code.md)).
- Every service takes `ctx: Ctx` first. `ctx.actorId` is the sender in chat or the selected member in the UI ("Acting as"); use it as the default payer/doer/adder.
- Tools resolve names to ids with `memberIdByName()` and throw a helpful error on unknown names (the model then asks).
- Tools attach buttons via the `outbox` (see `cart_add`), not by pasting URLs. Buttons need an absolute `APP_URL`.
- Dashboard pattern: see `app/members/page.tsx`. Server components read services; server actions write then `revalidatePath`. Pages are `force-dynamic`.
- Roomie's replies are 1 to 3 short lines unless someone asks for more. The trigger word is "roomie".
- Use the glossary's words in code and UI text (Member, Group, Expense, Cart...), and avoid the words it lists under _Avoid_.

## Library notes (versions in package-lock)

- **Mastra v1:** `createTool({ id, description, inputSchema, execute: async (input, context) => ... })`. The first arg is the parsed input, not `{ context }`. Agent needs `id`. Memory call: `agent.generate(text, { memory: { thread, resource } })`.
- **LLM:** Neon AI Gateway through Mastra's model router: `model = "neon/<id>"` in `lib/llm.ts`, which reads `NEON_AI_GATEWAY_BASE_URL` + `NEON_AI_GATEWAY_TOKEN`. Use ids from the branch's `/v1/models`.
- **Voice:** no Whisper on the gateway. `lib/voice.ts` sends the audio to OpenRouter (`OPENROUTER_API_KEY`, `STT_MODEL`, an audio-capable chat model) as an `input_audio` chat part and uses the text reply as the transcript. Optional; nothing calls it until a channel exists.
- **Next 16:** Mastra and pg are in `serverExternalPackages`. Read `node_modules/next/dist/docs/` before using Next APIs.

## Commands

```
npm install
cp .env.example .env          # fill DATABASE_URL, NEON_AI_GATEWAY_BASE_URL/TOKEN, LLM_MODEL (see comments in the file)
npm run db:push               # create tables on Neon
npm run seed                  # bare demo group, or:
npm run seed:demo             # Apt 4B with three weeks of history (SEED_CHAT_ID=... binds a chat id)
npm run dev                   # dashboard at localhost:3000 (scheduler runs here too; DISABLE_SCHEDULER=1 to skip)
npm run typecheck && npm test # tsc + unit tests (no .env); CI runs both
npm run test:tools            # every tool against the dev DB in a throwaway household, no LLM
```

## Before you commit

`npm run typecheck` and `npm test` must pass. Test a service with a `*.test.ts` before wiring its tool or page. Each plan step gets its own branch and PR.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
