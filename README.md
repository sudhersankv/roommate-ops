# Roomie

Roomie is an AI groupmate. You add it to a group chat and it becomes part of the conversation: it splits costs, keeps the group's grocery cart, tracks chores and upkeep, and sets reminders. Each Group also gets a dashboard that everyone signs in to with Google.

**Status: rebuild in progress.** See [docs/plan.md](docs/plan.md) for the plan, [GLOSSARY.md](GLOSSARY.md) for the vocabulary and [docs/adr/](docs/adr) for the decisions. There is no live WhatsApp channel yet (step 2); `npm run dev-chat` simulates a group chat in the terminal, and the dashboard's "Ask Roomie" panel works locally.

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

Other tools:

```sh
npm run dev-chat         # a pretend WhatsApp group: join, add, say, approve, link (docs/dev-chat.md)
npm run mastra:dev       # Mastra Studio at http://localhost:4111: chat with Roomie, see traces and scores
npm run db:generate      # after changing src/db/schema.ts: write the next migration into drizzle/
```

`.env` overrides variables already set in your environment (`src/lib/env.ts`). **If you see 401 from the gateway, a system env var is shadowing `.env`** (for example a stale `NEON_AI_GATEWAY_BASE_URL` from another project); `.env` should win, so check that the entry point imports `@/lib/env` first.

## Tests

```sh
npm run typecheck     # tsc --noEmit
npm test              # unit tests for the pure functions (Gate, permissions, Claim links, Onboarding), no .env needed
npm run test:tools    # every agent tool against the dev DB in a throwaway Group, no LLM
npm run evals         # ~33 chat scenarios through the real Gate and agent; baseline in docs/evals-baseline.md
```

CI runs `typecheck` and `npm test` on every push and pull request.
