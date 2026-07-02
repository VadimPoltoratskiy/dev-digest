# server/ — @devdigest/api

Fastify 5 + Drizzle ORM + Postgres (pgvector). The orchestrator: clones repos, runs repo-intel indexing, drives reviewer-core, persists runs/findings.

## Commands
```sh
pnpm dev          # :3001, tsx watch
pnpm db:migrate   # apply migrations (NOT auto on boot — run this first)
pnpm db:seed      # idempotent: acme/payments-api + PR #482 + 2 agents
pnpm db:generate  # after schema changes — generates migration file
pnpm test         # unit + integration (both suites)
pnpm exec vitest run --exclude '**/*.it.test.ts'   # unit only (hermetic)
pnpm exec vitest run .it.test                       # integration only (needs Docker)
pnpm typecheck
```

## Structure
```
src/
  server.ts          # entrypoint
  app.ts             # Fastify app factory + plugin registration
  modules/           # feature modules (each: routes.ts + service + repo)
    agents/  polls/  pulls/  repo-intel/  repos/  reviews/  settings/  workspace/
    index.ts         # static registry — add new modules here
  db/
    schema/          # Drizzle table definitions (DO NOT hand-edit; use db:generate)
    migrate.ts  seed.ts
  adapters/          # ports: llm, github, git, astgrep, tokenizer, secrets, mocks.ts
  platform/
    container.ts     # DI container
    config.ts        # loadConfig — secrets are OPTIONAL, no boot failure without keys
  vendor/shared/     # @devdigest/shared Zod contracts (source of truth for API contracts)
  prompts/           # raw system prompts for built-in agents
```

## Non-obvious wiring
- **Validation is schema-first.** Routes declare Zod `params`/`body` schemas (`fastify-type-provider-zod`) — invalid input is rejected `422` before the handler. Never hand-roll `Schema.parse(req.body)` in a handler.
- **DI container** (`platform/container.ts`) — adapters are injected, never imported directly in services. Swap `mocks.ts` in tests.
- **Module registration** — `modules/index.ts` is the only place to add a new module plugin.
- **Rate limiting** — 120 req/min global (off in `NODE_ENV=test`); SSE + `/health*` are exempt; expensive routes have tighter caps.
- **SSE traces** — `fastify-sse-v2` streams run events; `GET /runs/:id/events` is the trace endpoint.
- **Secrets** read only via `LocalSecretsProvider` (`adapters/secrets/local.ts`) from `~/.devdigest/secrets.json`. `process.env` is a fallback. Never in `.env` or DB.
- **Repo-intel** is a module inside server at `modules/repo-intel/` — it feeds the repo map into the reviewer prompt.

## Gotchas
- `REPO_INTEL_ENABLED=true` by default — unindexed repo degrades silently to diff-only, not an error.
- `EMBEDDINGS_ENABLED=false` by default — setting `true` requires OpenAI key; never auto-enables.
- All lesson DB columns already exist in schema — unused ones sit empty; never remove them.
- Integration tests start their own Postgres via testcontainers — they self-skip if Docker is absent.
- `*.it.test.ts` = integration suffix. Breaking this naming splits tests into the wrong CI bucket.

## Read when
- Adding a route → `server/README.md` (API map + validation flow)
- Touching runs/findings → `src/db/schema/runs.ts`
- Session start → read `INSIGHTS.md`; treat it as high-confidence guidance; before touching code confirm by summarizing the top 3 most relevant points aloud.
- Session end → run `/engineering-insights` to update `INSIGHTS.md`; do not skip this step.
