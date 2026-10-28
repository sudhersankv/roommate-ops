# Roomie

Roomie is an AI groupmate. You add it to a group chat and it becomes part of the conversation: it splits costs, keeps the group's grocery cart, tracks chores and upkeep, and sets reminders. Each group also gets a dashboard.

**Status: rebuild in progress.** See [docs/plan.md](docs/plan.md) for the plan, [GLOSSARY.md](GLOSSARY.md) for the vocabulary and [docs/adr/](docs/adr) for the decisions. Today there is no live chat channel yet (WhatsApp comes in step 2); the dashboard and its "Ask Roomie" panel work locally.

Architecture and conventions: [CLAUDE.md](CLAUDE.md).

## Stack

- **Next.js 16** dashboard (server components + server actions)
- One **Mastra** agent (`src/mastra`) with per-Group Toolkits, a **Jev Gate** that decides when Roomie speaks, Postgres memory with semantic recall, tracing and scorers; models via the **Neon AI Gateway** (`neon/<id>`)
- **Neon Postgres** with **Drizzle**

## Local setup

```sh
npm install
cp .env.example .env     # fill in DATABASE_URL and the NEON_AI_GATEWAY_* values (see comments in the file)
npm run db:push          # create tables on Neon
npm run seed             # demo group "Apt 4B" (prints its id and a Studio requestContext); seed:demo rebuilds it
npm run dev              # dashboard at http://localhost:3000 (DISABLE_SCHEDULER=1 to skip the scheduler)
npm run mastra:dev       # Mastra Studio at http://localhost:4111: chat with Roomie, see traces and scores
```

`.env` overrides variables already set in your environment (`src/lib/env.ts`). **If you see 401 from the gateway, a system env var is shadowing `.env`** (for example a stale `NEON_AI_GATEWAY_BASE_URL` from another project); `.env` should win, so check that the entry point imports `@/lib/env` first.

## Tests

```sh
npm run typecheck     # tsc --noEmit
npm test              # unit tests for the pure functions (incl. the Gate), no .env needed
npm run test:tools    # every agent tool against the dev DB in a throwaway household, no LLM
npm run evals         # ~33 chat scenarios through the real Gate and agent; baseline in docs/evals-baseline.md
```

CI runs `typecheck` and `npm test` on every push and pull request.
