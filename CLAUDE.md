# Roomie

Roomie is an AI groupmate that lives in a group chat and on a per-group dashboard. It splits costs, keeps the shared grocery cart, tracks chores and upkeep, and sets reminders. Persona: a friendly, witty, brief groupmate; exact about facts.

**Read first:** the rebuild plan is in `docs/plan.md`, the vocabulary in `GLOSSARY.md`, and the decisions in `docs/adr/`. They are the spec; where they conflict with this file, they win. Steps 1 (rename), 3 (Mastra agent) and 4 (identity, Groups, dashboard) are done; the code below is what exists today. WhatsApp (step 2) isn't: `npm run dev-chat` stands in for it.

Agent skills for this repo live in `.agents/skills/`.

## The one rule

**All business logic lives in `src/services/`.** The agent's tools (`src/toolkits/*/`) and the dashboard (`src/app/`) are thin front doors that call the same service functions. Anything you can do in chat must be doable in the UI, and vice versa. Never put logic in a tool or a page that belongs in a service. Permissions are business logic too: they live in services, never in prompts or pages alone.

## Layout

```
src/
  db/schema.ts          Drizzle tables: groups, chats, accounts, members, claim_tokens, group_toolkits, chat_messages,
                        member_notes, activity + the Toolkit tables (expenses, expense_splits, settlements, cart_items,
                        chores, chore_logs, reminders, maintenance), all keyed by group_id
  db/index.ts           db client
  services/             (ctx: Ctx, input) => result. Source of truth. index.ts re-exports as namespaces.
    types.ts            Ctx { groupId, memberId, source }, GroupCtx { groupId }, dollars()
    authz.ts            NotAllowedError, requireActive / requireAdmin (load the Member from the DB), canChangeExpense
    groups.ts           settings (validateSettings, defaultToolkitsFor purpose), Toolkit on/off, delete group data
    members.ts          list (active / active+pending), approve, decline, promote, payment handles, forgetMe
    claims.ts           Claim links: issueDashboardLink, createClaimToken, consumeClaim, upsertAccount
    activity.ts         record() + listActivity(): who added, changed or deleted what
    chatlog.ts          chat_messages: log, recent chatter, follow-up window facts, retention delete
    split.ts            splitEvenly (pure, no DB import, so the dashboard previews with it)
    money.ts cart.ts chores.ts reminders.ts upkeep.ts report.ts
  onboarding.ts         onGroupJoined (Group + Chat + Members, adder = Admin, intro + setup questions) and
                        onParticipantJoined (Pending + "approve X?"). Called by Channel adapters (ADR 0008)
  pipeline.ts           the message flow, channel-agnostic: handleIncoming(msg) resolves Group/Member itself (unknown
                        Chat -> Onboarding, unknown sender -> Pending), logs the line, runs the Gate, calls the agent,
                        collects links. askRoomie(ctx, text) for the dashboard. One trace per message.
  mastra/
    index.ts            `mastra`: the roomie agent, PostgresStore, Observability, scorers, logger
    context.ts          RequestContext schema { groupId, memberId, memberName, role, status, source, toolkits?,
                        toolkit?, gate?, mayStaySilent? } + ctxOf()
    agents/roomie.ts    ONE agent, built once. instructions(requestContext) = persona + members (roles, pending) +
                        Group time zone + Pending / Onboarding / Gate blocks; tools = toolsFor(toolkit, enabled Toolkits)
    memory.ts           Memory: thread group-<id>, resource <groupId>; last 30, semantic recall, working memory
    forget.ts           memory cleanup for "forget me" (a Member's lines + note) and "delete group data" (the thread)
    gate/               policy.ts (pure: decideGate, Chattiness thresholds, follow-up window, parseSilent), jev.ts, index.ts
    scorers/            relevancy (built-in) + brevity-tone (custom), Haiku judge, 10% of live replies
    evals/scenarios.ts  the fixed scenario set for `npm run evals`
  toolkits/
    registry.ts         TOOLKITS + toolsFor(gateToolkit, enabled). Wraps every tool so a NotAllowedError comes back as
                        { notAllowed, reason, message } text for Roomie to relay
    types.ts            TOOLKIT_IDS, ToolkitManifest { id, name, description, tools }
    util.ts             ctxOf, toCents, memberIdByName (opts.includePending), dashboardLinks
    core/               members (list, list_pending, approve/decline/promote, set_payment_handle, forget_me),
                        settings (set_group_settings, toggle_toolkit), dashboard (get_dashboard_link), reminders, report
    splitting/ groceries/ chores/ upkeep/   manifest.ts + the tools
  channels/types.ts     IncomingMessage { channel, chatExternalId, userExternalId, userName, text, ... }, Outgoing, Channel
  channels/index.ts     registry: registerChannel(); deliver(groupId, out) and deliverPrivate(memberId, out) go through
                        the Chat's adapter (only log when none is registered)
  channels/dev.ts       the dev adapter used by scripts/dev-chat.ts
  lib/auth/             server.ts (createNeonAuth), client.ts (createAuthClient), dev.ts (DEV_AUTH_EMAIL bypass)
  lib/session.ts        sessionUser -> currentAccount -> memberSession(groupId) / currentMember(groupId) (redirect/404)
  lib/env.ts            loads .env with override (import first in every entry point)
  lib/llm.ts            model ids for the Neon AI Gateway ("neon/<id>"), the gateway embedder
  lib/urls.ts           APP_URL links (dashboardUrl, linkFor)
  lib/dates.ts          day strings and labels in the Group's time zone (client-safe)
  lib/money.ts          formatMoney / parseMoney (client-safe)
  lib/voice.ts lib/prices.ts lib/style-note.ts
  jobs/scheduler.ts     60 s tick: due reminders, weekly Group Report, upkeep nudge -> channels.deliver; Group style
                        refresh; daily retention
  jobs/retention.ts     deletes chat_messages older than 30 days (ADR 0006)
  jobs/style-note.ts    Haiku rewrites the Group style note every 50 chat lines
  proxy.ts              Neon Auth middleware on /g/* (the dev bypass skips it)
  instrumentation.ts    loads env, starts the scheduler once (DISABLE_SCHEDULER=1 skips it)
  components/ui/        shadcn components; components/roomie/ the mascot; components/app/ shared app bits
                        (sign-in, doorway, avatars, money-bits, categories, theme)
  app/
    layout.tsx globals.css   Figtree, theme script, toasts; the design tokens
    page.tsx            signed out: sign-in; signed in: last/first Group, or "No groups yet"
    claim/[token]/      Claim link: sign in, consume, link the Account, -> /g/<id>
    g/[groupId]/        layout (session + GroupProvider + shell; Pending members see a waiting screen), Home, money
                        (+ ?tab=, [expenseId]), cart, chores, members, settings; actions.ts = every server action;
                        _components/data.ts = services -> screen shapes; _components/screens/*
    design/             the design-system page (dev only unless SHOW_DESIGN_PAGE=1)
    api/auth/[...path]  Neon Auth proxy; api/chat = Ask Roomie (session Member, 401/403)
drizzle/                generated migrations (0000 baseline drops the pre-step-4 tables)
scripts/migrate.ts      npm run db:migrate
scripts/seed.ts         demo Group "Apt 4B" (dev Chat dev-apt-4b); prints its id, a Claim link for Maya, a Studio requestContext
scripts/dev-chat.ts     the terminal WhatsApp stand-in (docs/dev-chat.md)
scripts/evals.ts        runs the scenarios in throwaway Groups; --baseline writes docs/evals-baseline.md
scripts/studio-presets.ts  writes .mastra-presets.json for Studio (run by mastra:dev)
spikes/                 throwaway experiments (WhatsApp/Baileys)
```

## Identity and permissions

- **Accounts and Claim links** (ADR 0003): a Member gets a single-use, 24-hour Claim link only when they ask for the dashboard (`get_dashboard_link`, which sends it privately and reuses a live one) or from `dev-chat link`. Never in bulk (ADR 0001). `/claim/<token>` signs them in with Google, upserts `accounts` from the session user (mirrored by `auth_user_id`, ADR 0008) and links `members.account_id`. One Account can be a Member of many Groups.
- **Who is what** (ADR 0008): whoever adds Roomie is Admin; people already in the Chat are active; later joiners and unknown senders are Pending until an Admin approves (chat or Members page).
- **Rules** (`services/authz.ts`): Pending members can chat and read, but every write service calls `requireActive` and refuses with "Hang on, an admin needs to approve you first. <Admin> can approve you." Members, roles, settings, Toolkits and delete-group-data call `requireAdmin`. Expenses can be changed by whoever added or paid them, anyone with a Share, or an Admin.
- **Dashboard:** every page and action goes through `lib/session.ts`; nothing trusts a member id from the client. Non-Admins don't see admin controls, and the actions return 403 anyway.
- **Dev sign-in bypass:** with `NODE_ENV !== "production"` and `DEV_AUTH_EMAIL` set, that email is the signed-in Account (loud warning in the log). For automated browser checks only.
- **Privacy** (ADR 0006): chat_messages live 30 days; `forget_me` deletes a Member's chat lines, note and memory lines (ledger stays; a removed Member becomes "Former member"); "delete group data" wipes the Group's data and Roomie's memory but keeps the Group, Chat and Members.
## The Gate (when Roomie speaks)

`mastra/gate/policy.ts`, ADR 0002. In order: hard trigger (voice note, reply to Roomie, @mention, the word "roomie", the dashboard) always speaks; Jev error or > 2.5 s means hard triggers only; p(act) over the Group's threshold acts; in the follow-up window (3 min / 3 messages after Roomie spoke) the agent decides with permission to answer `[silent]`, unless Jev is sure it's chatter; p(clarify) over its threshold asks. Thresholds (act / clarify): quiet .9/.8, **normal .75/.6** (default), chatty .6/.45. If nobody addressed Roomie and it's not a follow-up, the agent is told to ask before logging anything. Jev's toolkit narrows the agent's tools only at p ≥ 0.6. While Onboarding is open (`groups.onboarded_at` null), an active Member's message in the follow-up window counts as a hard trigger, so "roommates, USD, Chicago" reaches `set_group_settings`.

## Conventions

- Money is **integer cents** everywhere in services and the DB. Tools accept dollars from the model and convert with `toCents()`. The LLM never does math: balances, splits and totals come from services ([ADR 0007](docs/adr/0007-money-is-integer-cents-computed-in-code.md)).
- Every service takes `ctx: Ctx` first. `ctx.memberId` is the sender in chat or the signed-in Member on the dashboard; use it as the default payer/doer/adder. Group-level reads take `GroupCtx`.
- Tools resolve names to ids with `memberIdByName()` and throw a helpful error on unknown names (the model then asks).
- Tools get the Group and sender from `ctxOf(context)` (the RequestContext), never from closures.
- Tools attach buttons by returning `links: [{ text, url }]` (see `cart_add` / `dashboardLinks()`); the pipeline collects them from every tool result into `Outgoing.buttons`. Never paste URLs. Buttons need an absolute `APP_URL`.
- A new Toolkit = a folder with `manifest.ts` + tools, added to `TOOLKITS` in `toolkits/registry.ts`, `TOOLKIT_IDS`, and the Gate's toolkit choice in `gate/jev.ts` + `GATE_TOOLKITS`.
- Dashboard pattern: a page (server) calls `currentMember(groupId)`, reads services through `_components/data.ts` and renders a client screen; writes are server actions in `g/[groupId]/actions.ts` that call a service with the session's Ctx and `revalidatePath`. They return `{ ok, error, status }`, so screens toast errors. Features of steps 5-7 stay visible but disabled with a "Coming soon" hint.
- Schema changes: edit `src/db/schema.ts`, `npm run db:generate`, commit the SQL in `drizzle/`, `npm run db:migrate`. Never `drizzle-kit push`.
- Roomie's replies are 1 to 3 short lines unless someone asks for more. The trigger word is "roomie".
- Use the glossary's words in code and UI text (Member, Group, Expense, Cart...), and avoid the words it lists under _Avoid_.
## Library notes (versions in package-lock)

- **Mastra v1** (docs in `node_modules/@mastra/core/dist/docs/`, and https://mastra.ai/llms.txt): `createTool({ id, description, inputSchema, execute: async (input, context) => ... })`; `context.requestContext` carries the Group and Member. Agent options (`instructions`, `tools`, ...) can be functions of `{ requestContext }`. Call it as `mastra.getAgentById("roomie").generate(text, { requestContext, memory: { thread, resource } })`. Results use chunk format: `step.toolCalls[i].payload.toolName`.
- **LLM:** Neon AI Gateway through Mastra's model router: `model = "neon/<id>"` in `lib/llm.ts`, which reads `NEON_AI_GATEWAY_BASE_URL` + `NEON_AI_GATEWAY_TOKEN`. Use ids from the branch's `/v1/models`. Embeddings go to `{base}/v1/embeddings` through `ModelRouterEmbeddingModel` with an explicit url (`gatewayEmbedder()`).
- **Jev** is not a chat model: `POST {base}/typesafe/v1/systemone` with typed questions (`gate/jev.ts`). The gateway rate limit (input tokens per minute, account-wide) also covers Jev; on a 429 the Gate falls back to hard triggers.
- **Env:** `.env` must win over the process environment, but Node's `--env-file` and Next never override. `lib/env.ts` loads it with `dotenv({ override: true })`; import it first in every entry point. `mastra dev` tree-shakes side-effect-only imports, so bundled code must call `loadEnv()` (`lib/llm.ts` and `mastra/index.ts` do). **If you see 401 from the gateway, a system env var (e.g. a stale `NEON_AI_GATEWAY_BASE_URL`) is shadowing `.env`.**
- **Observability:** traces go to Postgres (`mastra_ai_spans`, visible in Studio) and to the Mastra platform when `MASTRA_PLATFORM_ACCESS_TOKEN` + `MASTRA_PROJECT_ID` are set. API routes call `mastra.observability.flush()` at the end.
- **Voice:** no Whisper on the gateway. `lib/voice.ts` sends the audio to OpenRouter (`OPENROUTER_API_KEY`, `STT_MODEL`, an audio-capable chat model) as an `input_audio` chat part and uses the text reply as the transcript. Optional; nothing calls it until a channel exists.
- **Neon Auth** (Managed Better Auth, `@neondatabase/auth`): `lib/auth/server.ts` = `createNeonAuth({ baseUrl, cookies: { secret } })`; `app/api/auth/[...path]` = `auth.handler()`; `proxy.ts` = `auth.middleware({ loginUrl: "/" })` matched to `/g/:path*` only; browser `createAuthClient()` (no args) and `signIn.social({ provider: "google", callbackURL })` with an absolute callback. `auth.getSession()` returns `{ data }`, user is `data.user`. Users live in `neon_auth` (Neon owns it; never write there). Dev Google uses Neon's shared OAuth keys.
- **Next 16:** Mastra and pg are in `serverExternalPackages`. Read `node_modules/next/dist/docs/` before using Next APIs.

## Commands

```
npm ci
cp .env.example .env          # DATABASE_URL, NEON_AI_GATEWAY_BASE_URL/TOKEN, NEON_AUTH_BASE_URL, NEON_AUTH_COOKIE_SECRET
npm run db:migrate            # apply drizzle/ (the 0000 baseline wipes pre-step-4 dev data)
npm run seed                  # demo Group Apt 4B; prints its id, a Claim link for Maya and a Studio requestContext
npm run seed:demo             # delete and rebuild Apt 4B
npm run dev                   # dashboard at localhost:3000 (scheduler runs here too; DISABLE_SCHEDULER=1 to skip)
npm run dev-chat              # terminal group chat through the real pipeline (docs/dev-chat.md)
npm run mastra:dev            # Mastra Studio at localhost:4111, with request-context presets for Apt 4B's Members
npm run db:generate           # after a schema change: write the next migration
npm run typecheck && npm test # tsc + unit tests (no .env); CI runs both
npm run test:tools            # every tool against the dev DB in a throwaway Group, no LLM
npm run evals                 # ~33 chat scenarios through the real Gate + Sonnet; prints a table and the pass rate
                              # (npx tsx scripts/evals.ts --only id,id   or   --baseline to rewrite docs/evals-baseline.md)
```

Adding deps: `npx -y npm@11 install <pkg>` (npm 10 trips on this lockfile; `npm ci` is fine).

## Before you commit

`npm run typecheck` and `npm test` must pass. Test a service with a `*.test.ts` before wiring its tool or page. Each plan step gets its own branch and PR.
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
