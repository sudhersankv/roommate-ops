# Roomie

Roomie is an AI groupmate. You add it to a group chat and it becomes part of the conversation: it splits costs, keeps the group's grocery cart, tracks chores and upkeep, and sets reminders. Each group also gets a dashboard.

**Status: rebuild in progress.** See [docs/plan.md](docs/plan.md) for the plan, [GLOSSARY.md](GLOSSARY.md) for the vocabulary and [docs/adr/](docs/adr) for the decisions. Today there is no live chat channel yet (WhatsApp comes in step 2); the dashboard and its "Ask Roomie" panel work locally.

Architecture and conventions: [CLAUDE.md](CLAUDE.md).

## Stack

- **Next.js 16** dashboard (server components + server actions)
- **Mastra** agent (`askRoomie`) with tools; models via the **Neon AI Gateway** (`neon/<id>`), memory in Postgres
- **Neon Postgres** with **Drizzle**

## Local setup

```sh
npm install
cp .env.example .env     # fill in DATABASE_URL and the NEON_AI_GATEWAY_* values (see comments in the file)
npm run db:push          # create tables on Neon
npm run seed:demo        # optional: a demo group with three weeks of history (or `npm run seed`)
npm run dev              # dashboard at http://localhost:3000 (DISABLE_SCHEDULER=1 to skip the scheduler)
```

## Tests

```sh
npm run typecheck     # tsc --noEmit
npm test              # unit tests for the pure functions, no .env needed
npm run test:tools    # every agent tool against the dev DB in a throwaway household, no LLM
```

CI runs `typecheck` and `npm test` on every push and pull request.
