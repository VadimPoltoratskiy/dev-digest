---
name: onion-architecture
description: "Answers 'what goes where' in the server — the layer and placement decision tree for every new file in the Fastify backend. Use when adding a new feature module, a route handler, a service method, a repository query, a new adapter, or a platform utility. Use when reviewing a PR for layer violations (routes querying the DB directly, services importing adapters without DI). Covers the annotated server directory map, the four-layer onion model (routes → service → repository → platform/adapters), module file anatomy, DI container usage patterns, module registration steps, import boundary rules, and anti-patterns. Trigger terms: where to put, new module, add route, service method, repository query, adapter, DI container, module registration, layer violation, backend architecture, server structure, which layer."
user-invocable: false
metadata:
  tags: architecture, structure, onion, layers, modules, DI, repository, service, routes, backend, server
---

# Onion Architecture (Server)

The placement and layer decision tree for the server package (`src/`). For _how_ to write Fastify routes (schemas, hooks, lifecycle), see [fastify-best-practices](../fastify-best-practices/SKILL.md). For _how_ to write Drizzle queries, see [drizzle-orm-patterns](../drizzle-orm-patterns/SKILL.md). For _how_ to design DB tables and indexes, see [postgresql-table-design](../postgresql-table-design/SKILL.md).

---

## Directory Map

```
src/
├── platform/                         # Core infrastructure — no business logic, no modules
│   ├── container.ts                  # DI container: holds db, config, jobs, SSE bus; lazily resolves adapters
│   ├── config.ts                     # loadConfig: reads env + ~/.devdigest/secrets.json
│   ├── errors.ts                     # AppError, NotFoundError, ValidationError, etc.
│   ├── jobs.ts                       # JobRunner: async background task queue
│   ├── sse.ts                        # RunBus: in-memory SSE event channel for streaming traces
│   ├── resilience.ts                 # Retry logic for adapter calls
│   ├── price-book.ts                 # Token cost estimation
│   └── types.ts                      # Shared TypeScript interfaces (Container, Config, etc.)
│
├── adapters/                         # External integrations — injected via DI, never imported directly
│   ├── llm/                          # LLM providers: OpenAI, Anthropic, OpenRouter
│   ├── github/                       # GitHub API via Octokit
│   ├── git/                          # Local git operations via simple-git
│   ├── embedder/                     # Vector embeddings via OpenAI
│   ├── codeindex/                    # Code search via ripgrep + extraction
│   ├── depgraph/                     # Dependency graph via depcruise
│   ├── astgrep/                      # AST pattern matching via ast-grep CLI
│   ├── tokenizer/                    # Token counting via Tiktoken
│   ├── secrets/                      # Secrets manager (reads ~/.devdigest/secrets.json)
│   ├── auth/                         # Authentication providers
│   ├── index.ts                      # Adapter exports
│   └── mocks.ts                      # Mock implementations for unit tests
│
├── db/                               # Database layer — schema, client, migrations
│   ├── schema/                       # Drizzle table definitions (one file per domain)
│   │   ├── _shared.ts                # Common columns: timestamps, identity helpers
│   │   ├── agents.ts                 # agents, agent_versions
│   │   ├── reviews.ts                # reviews, review_comments
│   │   ├── runs.ts                   # agent_runs, multi_agent_runs, run_traces
│   │   ├── repos.ts                  # repositories, clones
│   │   ├── pulls.ts                  # prs, pr_metadata
│   │   └── [domain].ts               # one file per domain
│   ├── migrations/                   # Auto-generated SQL — NEVER hand-edit
│   ├── client.ts                     # Drizzle client factory
│   ├── migrate.ts                    # Migration runner (used by pnpm db:migrate)
│   ├── rows.ts                       # TypeScript row type aliases
│   └── seed.ts                       # Idempotent seed data
│
├── modules/                          # Feature modules — one per domain
│   ├── _shared/                      # Cross-module utilities
│   │   ├── context.ts                # getContext(): extract workspaceId + user from request
│   │   └── schemas.ts                # Shared Zod validators (IdParams, PaginationParams, etc.)
│   ├── agents/                       # Example: standard 5-file module
│   ├── repos/                        # Example: standard 5-file module
│   ├── reviews/                      # Example: large module with repository/ subfolder
│   ├── pulls/
│   ├── repo-intel/
│   ├── settings/
│   ├── workspace/
│   ├── polling/
│   └── index.ts                      # Module registry — static list of all module plugins
│
├── vendor/shared/                    # Zod contracts shared with client — update in lockstep
│   ├── contracts/                    # API request/response schemas
│   └── index.ts
│
├── prompts/                          # Raw system prompt files for built-in agents
├── app.ts                            # Fastify app factory: registers global plugins + all modules
└── server.ts                         # Entry point: creates app, starts listening on :3001
```

---

## The Onion Layers

Dependencies flow **inward only** — outer layers depend on inner layers, never the reverse.

```
┌─────────────────────────────────────────────┐
│  Presentation   modules/*/routes.ts          │  HTTP boundary: parse, validate, delegate
│  ─────────────────────────────────────────  │
│  Application    modules/*/service.ts         │  Business logic: orchestrate, compute, map
│  ─────────────────────────────────────────  │
│  Infrastructure modules/*/repository.ts      │  DB queries; adapters/ for external APIs
│                 adapters/                    │
│  ─────────────────────────────────────────  │
│  Core           platform/   db/schema/       │  Types, errors, container, schema — no deps
└─────────────────────────────────────────────┘
```

| Layer | Files | Role |
|---|---|---|
| **Core** | `platform/`, `db/schema/` | Types, errors, DI container interface, table definitions. No business logic, no external package calls. |
| **Infrastructure** | `db/client.ts`, `adapters/` | Implements external concerns: DB client, LLM calls, GitHub API, git, secrets. Depends on Core only. |
| **Application** | `modules/*/service.ts` | Business logic and orchestration. Depends on repositories and adapters via DI — never directly. |
| **Presentation** | `modules/*/routes.ts`, `app.ts` | HTTP interface. Validates input, extracts context, delegates to service, returns DTO. No logic. |

---

## Decision Tree

When you need to add something:

| What you're adding | Where it goes |
|---|---|
| A new domain feature (CRUD, workflow) | New module: `modules/<domain>/` with `routes.ts` + `service.ts` + `repository.ts` |
| A new route / endpoint | `modules/<domain>/routes.ts` |
| Business logic or orchestration | `modules/<domain>/service.ts` |
| A DB query | `modules/<domain>/repository.ts` (or `repository/<entity>.repo.ts` for large modules) |
| A new external integration (API, CLI tool) | `adapters/<name>/index.ts` + register lazy resolver in `platform/container.ts` |
| A shared error class | `platform/errors.ts` |
| A shared Zod contract (request/response shape) | `vendor/shared/contracts/` — must sync with `client/src/vendor/shared/` |
| A background / async job | `platform/jobs.ts` (JobRunner); trigger from service constructor |
| An SSE event channel | `platform/sse.ts` (RunBus); consume in `routes.ts` for streaming |
| A DTO converter or pure mapping function | `modules/<domain>/helpers.ts` |
| Static config values or rate-limit settings | `modules/<domain>/constants.ts` |
| A Zod validator used by multiple modules | `modules/_shared/schemas.ts` |
| Context extraction (workspace, user) | `modules/_shared/context.ts` — use `getContext()`, don't duplicate |
| A DB table definition | `db/schema/<domain>.ts` (add to existing file or create new) |
| A DB migration | `pnpm db:generate` — **never hand-edit** SQL in `db/migrations/` |
| A global Fastify plugin (middleware) | `app.ts` via `app.register()` |

---

## Module Anatomy

Every feature module follows this file layout:

```
modules/<domain>/
├── routes.ts          # Fastify plugin — HTTP routes, Zod validation, context, calls service
├── service.ts         # Business logic — orchestrates repository + adapters, returns DTOs
├── repository.ts      # DB layer — Drizzle queries only, returns typed row objects
├── helpers.ts         # Pure DTO converters and mapping functions (omit if trivial)
├── constants.ts       # Static config: rate limits, timeouts, enums (omit if empty)
└── types.ts           # Module-local TypeScript interfaces (omit if none)
```

**For large modules** where one `repository.ts` becomes unwieldy, split by entity:

```
modules/<domain>/
├── routes.ts
├── service.ts
├── repository.ts      # Re-exports all sub-repos as a union type
└── repository/
    ├── <entity-a>.repo.ts   # e.g. run.repo.ts, review.repo.ts
    ├── <entity-b>.repo.ts
    └── index.ts
```

**Pages are thin; services are fat.** A `routes.ts` handler must not contain conditional business logic. Parse the request, extract context via `getContext()`, call one service method, return the result.

---

## Layer Responsibilities

What each layer is allowed — and not allowed — to do:

| File | Allowed | Forbidden |
|---|---|---|
| `routes.ts` | Parse `req.params`/`req.body`, call `getContext()`, delegate to service, return DTO | Query DB, instantiate adapters, contain `if/else` business logic |
| `service.ts` | Orchestrate repos + adapters via `container`, compute derived data, return DTOs | Access `req`/`res` objects, call `fetch()` or adapters directly (bypass DI), return raw DB rows |
| `repository.ts` | Execute Drizzle queries, return typed row objects | Contain business logic, call adapters, format DTOs, know about HTTP concepts |
| `adapters/<name>/` | Call external APIs or CLI tools, map raw responses to typed results | Contain business logic, query the DB, know about module domain |
| `platform/` | Define Container interface, error classes, shared types | Know about any specific module, adapter implementation, or DB schema |

---

## DI Container Pattern

Services **never import adapters directly.** All external integrations are accessed through the DI container.

```typescript
// service.ts — correct pattern
export class AgentsService {
  constructor(private container: Container) {}

  async runWithLLM(input: string) {
    const llm = this.container.llm();          // lazy-resolved adapter
    const db = this.container.db;              // always-available db instance
    const repo = new AgentRepository(db);
    // ...
  }
}

// routes.ts — passes container to service
const service = new AgentsService(container);
```

**Test injection:** Tests pass mock adapters via the container `overrides` parameter — no module code changes needed.

```typescript
// test file
const container = buildContainer(config, { llm: mockLlm, github: mockGithub });
const service = new AgentsService(container);
```

---

## Module Registration

Three steps to wire a new module into the app:

**Step 1 — Create `routes.ts` as a Fastify plugin:**
```typescript
// modules/<domain>/routes.ts
import type { FastifyPluginAsync } from 'fastify';

export const domainRoutes: FastifyPluginAsync = async (app, opts) => {
  const service = new DomainService(opts.container);

  app.get('/domain', { schema: { ... } }, async (req) => {
    const { workspaceId } = await getContext(opts.container, req);
    return service.list(workspaceId);
  });
};
```

**Step 2 — Register in `modules/index.ts`:**
```typescript
export { domainRoutes } from './domain/routes';
```

**Step 3 — Register in `app.ts`:**
```typescript
import { domainRoutes } from './modules';
app.register(domainRoutes, { prefix: '/domain', container });
```

---

## Import Boundary Rules

Enforce these import directions. A violation is a layer boundary breach.

| From | May import | Must NOT import |
|---|---|---|
| `routes.ts` | `service.ts`, `platform/errors.ts`, `modules/_shared/`, `vendor/shared/` | `repository.ts` directly, `adapters/`, `db/` |
| `service.ts` | `repository.ts`, `platform/container.ts`, `platform/errors.ts`, `platform/types.ts` | `routes.ts`, `adapters/` directly (use container), `req`/`res` |
| `repository.ts` | `db/client.ts`, `db/schema/*`, `platform/types.ts` | `service.ts`, `adapters/`, `routes.ts`, any module |
| `adapters/*` | `platform/types.ts`, external npm packages | `modules/`, `db/schema/`, other adapters |
| `platform/*` | External npm packages only | `modules/`, `adapters/`, `db/schema/` |

---

## File Naming Conventions

| File / directory type | Convention | Examples |
|---|---|---|
| Module directories | `kebab-case` | `repo-intel/`, `pull-comments/`, `agents/` |
| Module files | `lowercase` fixed names | `routes.ts`, `service.ts`, `repository.ts` |
| Split repository files | `<entity>.repo.ts` | `run.repo.ts`, `review.repo.ts`, `pull.repo.ts` |
| Adapter directories | `kebab-case` | `github/`, `codeindex/`, `depgraph/` |
| DB schema files | `<domain>.ts` | `agents.ts`, `reviews.ts`, `runs.ts` |
| Helper files | `helpers.ts` | DTO converters and pure mappings |
| Constants files | `constants.ts` | Rate limits, enums, static config |

---

## Anti-Patterns

### CRITICAL

- **Route handler queries the DB directly** — all DB access goes through `repository.ts`. A route handler that imports from `db/` or calls Drizzle directly collapses the architecture.
- **Service imports an adapter directly** — adapters must be resolved via `container.adapterName()`. Direct imports break test injection and the inward-dependency rule.
- **Hand-editing migration SQL** — migrations in `db/migrations/` are generated by `pnpm db:generate`. Manual edits will desync Drizzle's snapshot and corrupt future migrations. Use `pnpm db:generate` → review → `pnpm db:migrate`.

### HIGH

- **Repository returns a DTO** — repositories return raw typed rows (`typeof schema.tableName.$inferSelect`). DTO conversion belongs in `helpers.ts`, called from `service.ts`. Mixing this breaks the layer contract.
- **Repository contains business logic** — conditional branching, cost computation, and data enrichment are the service's job. Repositories are stateless query builders.
- **Service accesses `req` or `res`** — services must not know about HTTP. If a service needs something from the request (user ID, IP, headers), the route must extract it and pass it explicitly.
- **New module not registered** — creating `routes.ts` without adding it to `modules/index.ts` and registering in `app.ts` produces a silent no-op. The routes simply don't exist at runtime.
- **Business logic in `platform/`** — platform files define infrastructure contracts. Domain-specific logic placed there becomes a tangled core with no clear owner.

### MEDIUM

- **Domain-specific helpers in `modules/_shared/`** — `_shared/` is for utilities consumed by two or more modules. Single-module helpers belong in `modules/<domain>/helpers.ts`.
- **Secrets or config accessed outside `platform/config.ts`** — all configuration reads go through `loadConfig()`. Direct `process.env` access in adapters or services bypasses the single-chokepoint pattern.
- **Missing `getContext()` call in a route** — every route that operates within a workspace scope must call `getContext(container, req)` to extract `workspaceId` and `user`. Hardcoding or skipping this breaks multi-tenant scoping.
