# DevDigest — project map

## Stack
Node ≥22 · pnpm ≥10 · Next.js 15 (App Router) · Fastify 5 · Drizzle ORM · Postgres (pgvector) · Zod · TypeScript · Vitest

## Packages (no monorepo workspace — each has own package.json + lockfile)
| Folder | Package | Port |
|---|---|---|
| `server/` | `@devdigest/api` | 3001 |
| `client/` | `@devdigest/web` | 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | — |
| `e2e/` | `@devdigest/e2e` | — |

Cross-package code is shared via tsconfig path aliases — **not** published npm modules.
`@devdigest/shared` (Zod contracts) lives in `server/src/vendor/shared`; `@devdigest/ui` in `client/src/vendor/ui`.

## Commands
```sh
./scripts/dev.sh          # full stack: Postgres + API + web
docker compose up -d      # Postgres only
cd server && pnpm dev     # API :3001
cd client && pnpm dev     # web :3000
cd server && pnpm db:migrate   # apply migrations (NOT auto on boot)
cd server && pnpm db:seed      # idempotent demo data
cd server && pnpm test    # unit + integration
cd client && pnpm test    # vitest + jsdom
cd reviewer-core && pnpm test  # hermetic units
cd e2e && ./scripts/e2e.sh     # hermetic browser e2e
```

## Cross-cutting gotchas — not guessable from code
(Module-specific gotchas live in each module's own `CLAUDE.md`.)
- **Migrations never auto-run on boot.** Always `cd server && pnpm db:migrate` first — #1 first-run failure.
- **Secrets go to `~/.devdigest/secrets.json`** (mode 0600), not `.env` or DB. Single read chokepoint: `server/src/adapters/secrets/local.ts`.
- **The DB schema already has ALL lesson tables.** Unused ones sit empty — do not remove columns to "clean up."
- **`docker compose down -v` deletes the pgdata volume** and all imported repos/reviews. Never use `-v` to "reset."

## Do-not-touch zones
- `server/src/db/schema/` — schema owns the DB. Generate migrations with `pnpm db:generate`, never hand-edit.
- `server/src/vendor/shared/` — Zod contracts shared with client; changes must stay backward-compatible.
- `client/src/vendor/` — vendored UI primitives.
- `.github/workflows/` — CI workflows; changes need explicit approval.

## Read when
- Touching API routes or DI → read `server/README.md`
- Touching review pipeline → read `reviewer-core/README.md`
- Touching UI routes or data hooks → read `client/README.md`
- Running e2e → read `e2e/README.md`
- Before working in a module → read that module's `INSIGHTS.md`; treat as high-confidence guidance
- On session end → run `/engineering-insights` to update the relevant module's `INSIGHTS.md`; do not skip
