# Roomie

Roomie is an AI groupmate that lives in a group chat and on a per-group dashboard. It splits costs, keeps the shared grocery cart, tracks chores and upkeep, and sets reminders. Persona: a friendly, witty, brief groupmate; exact about facts.

**Read first:** the rebuild plan is in `docs/plan.md`, the vocabulary in `GLOSSARY.md`, and the decisions in `docs/adr/`. They are the spec; where they conflict with this file, they win. Steps 1 (rename) and 3 (Mastra agent) are done; the code below is what exists today. Some names still predate the glossary (`households`/`householdId` become Groups in step 4).

Agent skills for this repo live in `.agents/skills/`.

## The one rule

**All business logic lives in `src/services/`.** The agent's tools (`src/toolkits/*/`) and the dashboard (`src/app/`) are thin front doors that call the same service functions. Anything you can do in chat must be doable in the UI, and vice versa. Never put logic in a tool or a page that belongs in a service.

## Layout

```
src/
  db/schema.ts          Drizzle tables (households.chattiness quiet|normal|chatty, households.style_note_at)
  db/index.ts           db client
  services/             (ctx: Ctx, input) => result. Source of truth. index.ts re-exports as namespaces.
    types.ts            Ctx { householdId, actorId, source }, dollars()
    members.ts chatlog.ts money.ts cart.ts chores.ts reminders.ts upkeep.ts report.ts
  pipeline.ts           the message flow, channel-agnostic: handleIncoming(msg) for channels, askRoomie(ctx, text)
                        for the dashboard. Logs the line, runs the Gate, calls the agent, collects links. One trace per message.
  mastra/
    index.ts            `mastra`: the roomie agent, PostgresStore, Observability, scorers, logger
    context.ts          RequestContext schema { householdId, actorId, actorName, source, toolkit?, gate?, mayStaySilent? } + ctxOf()
    agents/roomie.ts    ONE agent, built once. instructions(requestContext) = persona + members + time zone + Gate blocks;
                        tools(requestContext) = toolsFor(toolkit)
    memory.ts           Memory: thread household-<id>, resource <householdId>; last 30, semantic recall, working memory
    gate/               policy.ts (pure: decideGate, Chattiness thresholds, follow-up window, parseSilent), jev.ts, index.ts
    scorers/            relevancy (built-in) + brevity-tone (custom), Haiku judge, 10% of live replies
    evals/scenarios.ts  the fixed scenario set for `npm run evals`
  toolkits/
    registry.ts         TOOLKITS + toolsFor(gateToolkit, enabled) -> core + that Toolkit (or all when unset/"none")
    types.ts            ToolkitManifest { id, name, description, tools }
    util.ts             ctxOf, toCents, memberIdByName, dashboardLinks
    core/               members, reminders, group_report (always on)
    splitting/ groceries/ chores/ upkeep/   manifest.ts + the tools
  channels/types.ts     IncomingMessage, Outgoing, Channel
  channels/index.ts     deliver(householdId, out): outbound posts; only logs until a channel exists (step 2)
  lib/env.ts            loads .env with override (import first in every entry point)
  lib/llm.ts            model ids for the Neon AI Gateway ("neon/<id>"), the gateway embedder
  lib/voice.ts          speech-to-text (OpenRouter, STT_MODEL), optional
  lib/prices.ts         grocery price estimates
  lib/style-note.ts     pure helpers for the Group style section
  lib/dashboard.ts      dashboardCtx(): first household + "actor" cookie member (no auth until step 4)
  jobs/scheduler.ts     60 s tick: due reminders, weekly Group Report, upkeep nudge -> channels.deliver; Group style refresh
  jobs/style-note.ts    Haiku rewrites the Group style note every 50 chat lines
  instrumentation.ts    loads env, starts the scheduler once (DISABLE_SCHEDULER=1 skips it)
  components/           ui.tsx (PageHead, Empty, NoHousehold), nav-links, ask-roomie panel, tz-offset
  app/                  dashboard pages + api/chat (pipeline, source "ui")
scripts/seed.ts         demo group "Apt 4B"; prints its id + a Studio requestContext; `seed:demo` = three weeks of history
scripts/evals.ts        runs the scenarios in throwaway households; --baseline writes docs/evals-baseline.md
scripts/studio-presets.ts  writes .mastra-presets.json for Studio (run by mastra:dev)
spikes/                 throwaway experiments (WhatsApp/Baileys)
```

## The Gate (when Roomie speaks)

`mastra/gate/policy.ts`, ADR 0002. In order: hard trigger (voice note, reply to Roomie, @mention, the word "roomie", the dashboard) always speaks; Jev error or > 2.5 s means hard triggers only; p(act) over the Group's threshold acts; in the follow-up window (3 min / 3 messages after Roomie spoke) the agent decides with permission to answer `[silent]`, unless Jev is sure it's chatter; p(clarify) over its threshold asks. Thresholds (act / clarify): quiet .9/.8, **normal .75/.6** (default), chatty .6/.45. If nobody addressed Roomie and it's not a follow-up, the agent is told to ask before logging anything. Jev's toolkit narrows the agent's tools only at p ≥ 0.6.

## Conventions

- Money is **integer cents** everywhere in services and the DB. Tools accept dollars from the model and convert with `toCents()`. The LLM never does math: balances, splits and totals come from services ([ADR 0007](docs/adr/0007-money-is-integer-cents-computed-in-code.md)).
- Every service takes `ctx: Ctx` first. `ctx.actorId` is the sender in chat or the selected member in the UI ("Acting as"); use it as the default payer/doer/adder.
- Tools resolve names to ids with `memberIdByName()` and throw a helpful error on unknown names (the model then asks).
- Tools get the household and sender from `ctxOf(context)` (the RequestContext), never from closures.
- Tools attach buttons by returning `links: [{ text, url }]` (see `cart_add` / `dashboardLinks()`); the pipeline collects them from every tool result into `Outgoing.buttons`. Never paste URLs. Buttons need an absolute `APP_URL`.
- A new Toolkit = a folder with `manifest.ts` + tools, added to `TOOLKITS` in `toolkits/registry.ts` and to the Gate's toolkit choice in `gate/jev.ts` + `GATE_TOOLKITS`.
- Dashboard pattern: see `app/members/page.tsx`. Server components read services; server actions write then `revalidatePath`. Pages are `force-dynamic`.
- Roomie's replies are 1 to 3 short lines unless someone asks for more. The trigger word is "roomie".
- Use the glossary's words in code and UI text (Member, Group, Expense, Cart...), and avoid the words it lists under _Avoid_.

## Library notes (versions in package-lock)

- **Mastra v1** (docs in `node_modules/@mastra/core/dist/docs/`, and https://mastra.ai/llms.txt): `createTool({ id, description, inputSchema, execute: async (input, context) => ... })`; `context.requestContext` carries the household. Agent options (`instructions`, `tools`, ...) can be functions of `{ requestContext }`. Call it as `mastra.getAgentById("roomie").generate(text, { requestContext, memory: { thread, resource } })`. Results use chunk format: `step.toolCalls[i].payload.toolName`.
- **LLM:** Neon AI Gateway through Mastra's model router: `model = "neon/<id>"` in `lib/llm.ts`, which reads `NEON_AI_GATEWAY_BASE_URL` + `NEON_AI_GATEWAY_TOKEN`. Use ids from the branch's `/v1/models`. Embeddings go to `{base}/v1/embeddings` through `ModelRouterEmbeddingModel` with an explicit url (`gatewayEmbedder()`).
- **Jev** is not a chat model: `POST {base}/typesafe/v1/systemone` with typed questions (`gate/jev.ts`). The gateway rate limit (input tokens per minute, account-wide) also covers Jev; on a 429 the Gate falls back to hard triggers.
- **Env:** `.env` must win over the process environment, but Node's `--env-file` and Next never override. `lib/env.ts` loads it with `dotenv({ override: true })`; import it first in every entry point. `mastra dev` tree-shakes side-effect-only imports, so bundled code must call `loadEnv()` (`lib/llm.ts` and `mastra/index.ts` do). **If you see 401 from the gateway, a system env var (e.g. a stale `NEON_AI_GATEWAY_BASE_URL`) is shadowing `.env`.**
- **Observability:** traces go to Postgres (`mastra_ai_spans`, visible in Studio) and to the Mastra platform when `MASTRA_PLATFORM_ACCESS_TOKEN` + `MASTRA_PROJECT_ID` are set. API routes call `mastra.observability.flush()` at the end.
- **Voice:** no Whisper on the gateway. `lib/voice.ts` sends the audio to OpenRouter (`OPENROUTER_API_KEY`, `STT_MODEL`, an audio-capable chat model) as an `input_audio` chat part and uses the text reply as the transcript. Optional; nothing calls it until a channel exists.
- **Next 16:** Mastra and pg are in `serverExternalPackages`. Read `node_modules/next/dist/docs/` before using Next APIs.

## Commands

```
npm install
cp .env.example .env          # fill DATABASE_URL, NEON_AI_GATEWAY_BASE_URL/TOKEN, LLM_MODEL (see comments in the file)
npm run db:push               # create tables on Neon
npm run seed                  # demo group Apt 4B; prints its id and a Studio requestContext, or:
npm run seed:demo             # rebuild Apt 4B with three weeks of history (SEED_CHAT_ID=... binds a chat id)
npm run dev                   # dashboard at localhost:3000 (scheduler runs here too; DISABLE_SCHEDULER=1 to skip)
npm run mastra:dev            # Mastra Studio at localhost:4111, with request-context presets for Apt 4B's members
npm run typecheck && npm test # tsc + unit tests (no .env); CI runs both
npm run test:tools            # every tool against the dev DB in a throwaway household, no LLM
npm run evals                 # ~33 chat scenarios through the real Gate + Sonnet; prints a table and the pass rate
                              # (npx tsx scripts/evals.ts --only id,id   or   --baseline to rewrite docs/evals-baseline.md)
```

## Before you commit

`npm run typecheck` and `npm test` must pass. Test a service with a `*.test.ts` before wiring its tool or page. Each plan step gets its own branch and PR.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
