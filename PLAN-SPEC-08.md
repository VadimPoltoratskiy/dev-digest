# Plan: Memory Feature

## Spec reference
`specs/SPEC-08-memory.md` — 30 EARS acceptance criteria, all clarifications RESOLVED.

> **Delivery note (2026-07-16):** **Phase 5 (CI file path) is DEFERRED to a future PR** —
> it requires `agent-runner` changes, which are out of scope here. Both sub-parts were
> reverted: 5b (agent-runner loader/inject) and 5a (server CI export). **AC-21–24 and AC-29
> are not delivered in this PR.** Phases 1–4 and 6 shipped and are fully verified.

## Execution mode: multi-agent
Chosen by the user. Phase 1 (server module + contract) is the shared foundation;
all other implementers must wait for Phase 1's REST surface and `MemoryRecord` contract
to land before they can proceed. Phases 2–5 are independent of each other and can run
in parallel once Phase 1 merges. Phase 6 (skill update + nightly curate) depends only
on Phase 1's service write path and can also run in parallel with Phases 2–5.

```
Phase 1 (foundation)
  ├── Phase 2 (client UI)          ─┐
  ├── Phase 3 (run-executor)        │ parallel
  ├── Phase 4 (MCP tool)            │ after Phase 1
  ├── Phase 5 (CI path)             │
  └── Phase 6 (skill + nightly)  ──┘
```

## Goal
DevDigest already captures session learnings as free-form `INSIGHTS.md` files.
The Memory feature turns those learnings into a **structured, queryable,
agent-consumable** pool: typed records (decision / convention / preference / fact /
learning) scoped to repo / global / team, with a confidence score, source contexts
(PR references), and an optional pgvector embedding — surfaced in a `/memory` tab and
pulled into review context so shared knowledge actually informs reviews. A write-time
curate gate and an untrusted CI-path channel preserve the trusted-vs-untrusted boundary
that is the defining security constraint of this feature.

## Modules affected
- `server/` — new `modules/memory/` onion slice (routes → service → repository),
  `MemoryRecord` contract addition to `vendor/shared/`, seed rows, `run-executor.ts`
  memory retrieval + `memory_pulled` population, CI `buildCiBundle` JSONL wiring.
- `client/` — new `app/memory/` route + `_components/MemoryView/` feature folder,
  TanStack Query hook `lib/hooks/memory.ts`, `lib/api.ts` additions, i18n strings.
- `mcp-server/` — new `tools/get-memory.ts` tool + registration in `src/index.ts`.
- `agent-runner/` — new `src/memory.ts` loader, `src/run.ts` untrusted-channel wiring.
- `.claude/skills/engineering-insights/` — extend to emit structured memory records.

## Engineering Insights applied
- **Schema already has ALL columns** (server/insights): `memory` table exists with
  `id`, `workspace_id`, `repo_id`, `scope`, `kind`, `content`, `embedding vector(1536)`,
  `confidence`, `sources`, `created_at`, `updated_at`, `last_used_at` — no migration needed.
- **`container.embedder()` throws `ConfigError` when disabled** (server/insights
  `container.ts:201-203`): every embed path in the service wraps the call in
  `try/catch (ConfigError)` and degrades to text / skips embedding — never errors.
- **`vendor/shared` is a manual mirror** (client/insights): update
  `server/src/vendor/shared/contracts/knowledge.ts` and
  `client/src/vendor/shared/contracts/knowledge.ts` in lockstep; TypeScript enforces
  the sync but tooling does not automate it.
- **`useActiveRepo()` for repo-scoped pages without a repoId column** (client/insights):
  `MemoryView` follows the same pattern as `ConventionsView` — no prop-drill, no
  second `QueryClientProvider`.
- **Drizzle `.eq()` on column is not a method** (server/insights): use standalone
  `eq(column, value)` from `drizzle-orm`, never chain `.eq()` off a column object.
- **Test fixtures must include all required Zod contract fields** (client/insights):
  when `MemoryRecord` gains `id`/`updated_at`/`last_used_at`, update every fixture
  typed as `MemoryRecord` in both server and client tests.
- **prompt slot already inert-wired** (server/insights 2026-07-06): `memory?: string[]`
  slot and `memory_pulled: []` in run-executor already exist — injection = populate,
  not build. `reviewer-core` is not modified.
- **MockLLMProvider validates fixtures against real enums** (server/insights 2026-07-06):
  any integration test fixture for memory content must have valid `scope`/`kind`
  values or the test fails inside `reviewPullRequest` with a confusing "run failed"
  status.

## Recommendations
- **Single `MemoryService.retrieve()` method for run-executor** rather than letting
  run-executor call the repository directly — keeps business logic (token budget,
  semantic-vs-text degradation, confidence floor) in the service layer per
  onion-architecture; run-executor stays thin (resolve → call → wire result).
- **Pass CI memory through `specs` not `memory`** — avoids adding a new `PromptParts`
  field to reviewer-core (which must stay invariant) while fully satisfying AC-29:
  `specs` items are already wrapped by `wrapUntrusted()` with the injection guard,
  rendering CI memory as `<untrusted source="spec-0">` data, never instructions.
- **Simple char/4 token estimation for the retrieval budget** — mirrors the
  `MAX_SPEC_CHARS_PER_FILE` / `MAX_SPEC_TOTAL_CHARS` cap pattern already in
  `run-executor.ts:17-19`; avoids adding a Tiktoken call to every review hot path.
- **No new DB migration** — the table is complete; only the Zod contract layer gains
  `MemoryRecord`; if any column is found missing at implementation time, generate
  with `pnpm db:generate`, commit the migration, then run `pnpm db:migrate`.

## Architecture decisions

### Onion-layer placement (per onion-architecture SKILL)
- **Routes** (`modules/memory/routes.ts`): parse Zod `querystring`/`body`/`params`
  schemas, call `getContext()`, delegate to `MemoryService`, return DTO. No DB
  access, no curate logic.
- **Service** (`modules/memory/service.ts`): CRUD orchestration, write-time curate
  gate, embedding-on-write (gated), semantic/text search selection, retrieval policy
  (top-K, confidence floor, token budget), export serialization, nightly curate.
  All embedder calls go through `this.container.embedder()` (DI — never direct import).
- **Repository** (`modules/memory/repository.ts`): Drizzle queries only. Returns
  `typeof memory.$inferSelect` rows — no DTO conversion here. All business-logic
  conditions (freshness threshold, confidence floor) are passed in as query parameters
  by the service, not computed by the repository.
- **Helpers** (`modules/memory/helpers.ts`): pure functions — `toMemoryRecord(row)`,
  `curateContent(text): string` (write-time sanitize gate), `formatForInjection(record)`.

### Write-time curate gate (AC-7)
Lives in `service.ts` (business logic layer), not in routes. The gate is a pure
function in `helpers.ts` called by the service before every `insert` and `update`.
It neutralizes: `</untrusted>` / `<untrusted` delimiters (prevent tag-escape),
and lines matching common injection openers (`^ignore (all )?previous`, `^you are now`,
`^disregard`, `^act as`, `^forget`). Content is returned sanitized — the record is
persisted, not rejected.

### Trusted vs. untrusted memory injection (AC-23, AC-29, security skill)
- **Local DB path (trusted)**: `run-executor.ts` retrieves from the Postgres `memory`
  table (write-time curated) and passes strings as `memory: string[]` to
  `reviewPullRequest`. This renders in the TRUSTED `## Relevant memory` slot — no
  delimiter wrapping. Trust established at write time by the curate gate.
- **CI on-disk path (untrusted)**: `agent-runner` reads `.devdigest/memory.jsonl`
  (a PR-author-modifiable file), Zod-validates the full file as `MemoryItem[]`, then
  passes the filtered content as `specs: [ciMemoryContent]` to `reviewPullRequest`.
  This renders inside `<untrusted source="spec-0">` tags, governed by the existing
  `INJECTION_GUARD`. The trusted `memory:` parameter is NOT used by the CI runner.

### Freshness semantics (AC-30, per SPEC §Service contracts)
Repository `list()` accepts a `freshness?: 'stale'` parameter:
- When absent (default): exclude stale rows via SQL `WHERE
  (last_used_at > now() - INTERVAL '60 days') OR (last_used_at IS NULL AND updated_at > now() - INTERVAL '60 days')`.
- When `freshness=stale`: no freshness predicate (return all records, caller shows stale).

### Embedding degradation (AC-3, AC-11, AC-28)
Pattern from `container.ts:196-203`: `container.embedder()` throws `ConfigError`
when `EMBEDDINGS_ENABLED=false`. Every service path that embeds wraps the call in
`try { const e = await this.container.embedder(); ... } catch { /* degrade */ }`.
No other check needed — the container is the single gate.

### `search_mode` response field
Not part of `MemoryRecord` (which is the per-record contract). Returned as a wrapper
on the `GET /memory` response: `{ records: MemoryRecord[], search_mode?: 'semantic' | 'text' }`.
Only present when `?q` is supplied. Client reads this field to render the badge (AC-12).

### No reviewer-core modification
The `memory?: string[]` slot in `PromptParts` and `memory_pulled` in `RunTrace`
already exist. The `retrieve()` call in `run-executor.ts` populates them.
reviewer-core is not touched.

---

## Tasks

### Phase 1: Server `memory` module + contract (foundation — all other phases depend on this)

#### 1a. Contract additions (backward-compatible)
- [ ] `server/src/vendor/shared/contracts/knowledge.ts` — AFTER the existing `MemoryItem`
  block (line 199), add:
  ```typescript
  export const MemoryRecord = MemoryItem.extend({
    id: z.string().uuid(),
    updated_at: z.string().datetime(),
    last_used_at: z.string().datetime().nullable(),
  });
  export type MemoryRecord = z.infer<typeof MemoryRecord>;
  ```
  `MemoryItem` itself is unchanged — existing consumers stay valid.
- [ ] `client/src/vendor/shared/contracts/knowledge.ts` — mirror the identical
  `MemoryRecord` addition (manual mirror; see client INSIGHTS).

#### 1b. Module skeleton
- [ ] `server/src/modules/memory/constants.ts` — define:
  ```typescript
  export const RETRIEVAL_K = 8;
  export const CONFIDENCE_FLOOR = 0.5;
  export const MEMORY_TOKEN_BUDGET_CHARS = 6000; // ≈1500 tokens × 4 chars/token
  export const STALE_DAYS = 60;
  ```
- [ ] `server/src/modules/memory/helpers.ts` — pure functions:
  - `toMemoryRecord(row: MemoryRow): MemoryRecord` — map DB row to contract DTO
    (camelCase → snake_case for `updated_at`, `last_used_at`; `sources` jsonb cast
    to `MemorySource[]`).
  - `curateContent(text: string): string` — write-time sanitize gate (AC-7): strip
    `</untrusted>` / `<untrusted` tag attempts; strip lines matching regex
    `/^(ignore( all)? previous|you are now|disregard|act as|forget)/i`. Returns
    sanitized string.
  - `formatForInjection(record: MemoryRow): string` — renders a single memory record
    as an injection string: `[${record.kind}/${record.scope} conf:${record.confidence}] ${record.content}`.
  - `isStale(row: MemoryRow): boolean` — `(row.lastUsedAt ?? row.updatedAt) < Date.now() - STALE_DAYS*86400*1000`.
  - `buildMemoryJsonlLine(row: MemoryRow): string` — serialize to `MemoryItem` JSON
    (pick `content, scope, kind, confidence, sources`), no id/timestamps.
- [ ] `server/src/modules/memory/repository.ts` — `MemoryRepository` class:
  - Constructor `(private db: Db)`.
  - `export type MemoryRow = typeof memory.$inferSelect;`
  - `list(workspaceId, opts: { scope?, kind?, repoId?, freshness?: 'stale', textQuery?, limit?: number }): Promise<MemoryRow[]>` — Drizzle `select().from(memory).where(and(...conditions))`. Apply freshness filter via the 60-day SQL predicate described in Architecture decisions. Confidence floor NOT applied here (retrieval-only concern, applied by service when retrieving for injection). Apply `ilike` on `content` when `textQuery` present.
  - `getById(workspaceId, id): Promise<MemoryRow | null>`
  - `insert(workspaceId, data: { repoId?: string; scope; kind; content; confidence; sources; embedding?: number[] }): Promise<MemoryRow>`
  - `update(workspaceId, id, patch: Partial<Pick<MemoryRow, 'content'|'scope'|'kind'|'confidence'|'sources'>>): Promise<MemoryRow | null>` — `set({ ...patch, updatedAt: new Date() })` + `where(and(eq(memory.id, id), eq(memory.workspaceId, workspaceId)))`.
  - `deleteOne(workspaceId, id): Promise<boolean>` — mirrors conventions delete pattern.
  - `bumpLastUsed(ids: string[]): Promise<void>` — `UPDATE memory SET last_used_at = now() WHERE id = ANY(ids)` using `inArray(memory.id, ids)`.
  - `upsertEmbedding(id: string, embedding: number[]): Promise<void>` — `UPDATE memory SET embedding = $embedding WHERE id = $id`.
  - `searchSemantic(workspaceId, query: { embedding: number[]; scope?: string; repoId?: string; confidenceFloor: number; limit: number }): Promise<MemoryRow[]>` — order by `sql\`${memory.embedding} <-> ${embeddingLiteral}\`` ascending (cosine distance); filter `embedding IS NOT NULL`, confidence >= floor, scope matches.
  - `exportRows(workspaceId, repoId?: string): Promise<MemoryRow[]>` — select all rows for workspace, optionally filtered by repoId (for repo-scoped export).
  - `findUnembedded(workspaceId?: string): Promise<MemoryRow[]>` — rows where `embedding IS NULL`.

- [ ] `server/src/modules/memory/service.ts` — `MemoryService` class:
  - Constructor `(private container: Container)`, creates `this.repo = new MemoryRepository(container.db)`.
  - `create(workspaceId, data: MemoryItem & { repoId?: string }): Promise<MemoryRecord>` — run `curateContent()` on `data.content`, insert, then attempt embedding (try/catch ConfigError → skip).
  - `update(workspaceId, id, patch: Partial<MemoryItem>): Promise<MemoryRecord>` — if `patch.content` present, curate it; call `repo.update()`, re-embed content if changed.
  - `delete(workspaceId, id): Promise<boolean>` — `repo.deleteOne()`.
  - `list(workspaceId, filters): Promise<{ records: MemoryRecord[]; search_mode?: 'semantic' | 'text' }>` — when no `?q`, return filtered list; when `?q` present, attempt semantic search (try/catch ConfigError → fall back to text search on `filters.textQuery`); map rows to DTOs; return with `search_mode`.
  - `retrieve(workspaceId, repoId, diffText: string): Promise<{ strings: string[]; pulledIds: string[] }>` — retrieval for run-executor injection. Attempt semantic: embed `diffText`, call `repo.searchSemantic(...)` with `confidenceFloor=CONFIDENCE_FLOOR`, `limit=RETRIEVAL_K`, scope filter `['repo','global','team']`. On ConfigError, fall back to text: call `repo.list()` with `textQuery` derived from first 200 chars of diffText. Apply token budget: accumulate `formatForInjection(row)` until `totalChars >= MEMORY_TOKEN_BUDGET_CHARS`, then stop. Return `{ strings, pulledIds }`.
  - `exportJsonl(workspaceId, repoId?: string): Promise<string>` — `repo.exportRows()` → map `buildMemoryJsonlLine()` → join with `\n`. Returns empty string when no rows.
  - `curate(workspaceId?: string): Promise<void>` — find `repo.findUnembedded(workspaceId)`, embed each row (try/catch ConfigError → skip embedding, still continues), `repo.upsertEmbedding(id, embedding)`. Nightly job calls this.

- [ ] `server/src/modules/memory/routes.ts` — Fastify plugin (mirror conventions/routes.ts):
  - `GET /memory` — querystring: `MemoryQuerySchema` (scope?, kind?, repo?, freshness?, q?). Call `service.list()`. Return `{ records, search_mode? }`.
  - `POST /memory` — body: `CreateMemoryBody` (MemoryItem fields + optional `repo?` string for repo-scoped). Call `service.create()`. Return `MemoryRecord`, status 201.
  - `PATCH /memory/:id` — params: `IdParams`. Body: `UpdateMemoryBody` (all MemoryItem fields optional). Call `service.update()`; throw `NotFoundError` if null.
  - `DELETE /memory/:id` — params: `IdParams`. Call `service.delete()`; throw `NotFoundError` if false. Reply 204.
  - `GET /memory/export` — querystring: `{ repo?: string }`. Call `service.exportJsonl()`. Return raw JSONL string with content-type `application/x-ndjson`.
  - All routes call `getContext(app.container, req)` to extract `workspaceId`.
  - **Important**: declare `GET /memory/export` BEFORE `GET /memory/:id` in registration order so Fastify doesn't match "export" as an id param.

- [ ] `server/src/modules/index.ts` — add:
  ```typescript
  import memory from './memory/routes.js';
  // in the modules object:
  memory,
  ```

- [ ] `server/src/db/seed.ts` — add 5 idempotent memory rows for `acme/payments-api` (repoId from existing seeded repo). Use `onConflictDoNothing()` keyed on `(workspaceId, kind, scope, content)` or check-before-insert. Rows (from the plan brief):
  1. `{ kind:'fact', scope:'repo', content:'bucketKey() version fact', confidence:0.9, sources:[{context:'PR #482'}] }`
  2. `{ kind:'fact', scope:'repo', content:'Stripe webhook idempotency key pattern', confidence:0.85, sources:[{pr:482, context:'payments-api'}] }`
  3. `{ kind:'decision', scope:'team', content:'Team decided not to adopt tRPC — REST is the standard', confidence:0.95, sources:[{context:'team retro 2025-Q3'}] }`
  4. `{ kind:'convention', scope:'repo', content:'Migrations never auto-run — always cd server && pnpm db:migrate', confidence:1.0, sources:[{context:'CLAUDE.md'}] }`
  5. `{ kind:'preference', scope:'global', content:'Group related DB columns near their FK, not alphabetically', confidence:0.8, sources:[{context:'PR #482 review'}] }`

- [ ] `server/src/modules/memory/service.it.test.ts` — integration test (mirror conventions/service.it.test.ts pattern: `startPg`, `buildApp`, `seed`, Docker-skip guard):
  - CRUD round-trip: POST (201), GET by id, PATCH (field + `updated_at` advances), DELETE (204), foreign-workspace isolation (404).
  - `list()` with scope/kind/freshness filters returns matching only.
  - `list()` with `?q` returns `search_mode='text'` when embeddings disabled (default in test env).
  - `exportJsonl()` returns JSONL lines parseable by `MemoryItem.array()`.
  - Write-time curate gate: inserting content with `</untrusted>` tag — persisted content has tag stripped.
  - `retrieve()` returns empty strings + pulledIds=[] when no matching records; `bumpLastUsed` advances `last_used_at`.

#### Phase 1 verification
After implementation: `cd server && pnpm test` (unit + integration pass), `pnpm typecheck`, `pnpm db:migrate` (no-op since no migration was generated), `pnpm db:seed` (memory rows appear in `GET /memory`).

---

### Phase 2: Client `/memory` route (parallel after Phase 1)

Depends on: Phase 1's `MemoryRecord` contract + `GET /memory` REST surface.

#### 2a. API + hooks
- [ ] `client/src/lib/api.ts` — add functions:
  - `fetchMemory(params: { scope?; kind?; repo?; freshness?; q? }): Promise<{ records: MemoryRecord[]; search_mode?: string }>` — `GET /memory` with URLSearchParams.
  - `createMemory(body: Partial<MemoryItem> & { repo?: string }): Promise<MemoryRecord>` — `POST /memory`.
  - `patchMemory(id: string, body: Partial<MemoryItem>): Promise<MemoryRecord>` — `PATCH /memory/${id}`.
  - `deleteMemory(id: string): Promise<void>` — `DELETE /memory/${id}`.
  - `exportMemory(repo?: string): Promise<string>` — `GET /memory/export`.
- [ ] `client/src/lib/hooks/memory.ts` — TanStack Query hooks:
  - `useMemory(filters)` — `useQuery({ queryKey: ['memory', filters], queryFn: () => fetchMemory(filters) })`.
  - `useCreateMemory()` — `useMutation({ mutationFn: createMemory, onSuccess: () => queryClient.invalidateQueries(['memory']) })`.
  - `usePatchMemory()` — `useMutation({ mutationFn: ({ id, body }) => patchMemory(id, body), onSuccess: ... })`.
  - `useDeleteMemory()` — `useMutation({ mutationFn: deleteMemory, onSuccess: ... })`.
- [ ] `client/src/lib/hooks/index.ts` — re-export from `memory.ts` (if index exists; otherwise skip).

#### 2b. i18n
- [ ] `client/messages/en.json` (or the relevant locale file) — add a `memory` key namespace:
  ```json
  "memory": {
    "title": "Memory",
    "searchPlaceholder": "Search memory…",
    "filterScope": "Scope",
    "filterKind": "Kind",
    "filterFreshness": "Show Stale (>60d)",
    "searchModeSemantic": "semantic",
    "searchModeText": "text",
    "confidence": "Confidence",
    "sources": "Sources",
    "updatedAt": "Updated",
    "lastUsedAt": "Last used",
    "never": "Never",
    "emptyState": "No memory records match the current filters.",
    "editTitle": "Edit memory record",
    "deleteConfirm": "Delete this memory record?"
  }
  ```

#### 2c. Page + components
- [ ] `client/src/app/memory/page.tsx` — thin page (mirror `conventions/page.tsx`):
  ```tsx
  import { Suspense } from "react";
  import { MemoryView } from "./_components/MemoryView";
  export default function MemoryPage() {
    return <Suspense><MemoryView /></Suspense>;
  }
  ```
- [ ] `client/src/app/memory/_components/MemoryView/MemoryView.tsx` — the feature shell:
  - Use `useActiveRepo()` from `lib/repo-context.tsx` to get the current repoId (mirrors `ConventionsView`).
  - Local state: `scope`, `kind`, `showStale` (toggle → `freshness='stale'`), `q` (search string), `selectedId`.
  - Call `useMemory({ scope, kind, freshness: showStale ? 'stale' : undefined, repo: repoId, q })`.
  - Render: filter bar (SCOPE/KIND chips + FRESHNESS toggle), search box with `search_mode` badge, record list (`MemoryCard` per record), detail pane when `selectedId` is set.
  - Empty state message when `records.length === 0`.
- [ ] `client/src/app/memory/_components/MemoryView/MemoryCard.tsx` — per-record row:
  - Render: scope tag, kind tag, confidence % (e.g., `87%`), content text (truncated to 120 chars), sources (PR ref links), `updated_at`, `last_used_at` (`Never` when null).
  - Click → `onSelect(record.id)`.
- [ ] `client/src/app/memory/_components/MemoryView/MemoryDetailPane.tsx` — right-panel detail:
  - Show full record: all fields from `MemoryCard` + full content.
  - Edit form: textarea for `content`, selects for `scope`/`kind`, number input for `confidence` (0–1 slider or text). On submit: call `usePatchMemory()`.
  - Delete button: call `useDeleteMemory()`, confirm before deleting.
  - Search mode badge: show `semantic` or `text` chip in the search box area (from `search_mode` in `useMemory` response).
- [ ] `client/src/app/memory/_components/MemoryView/index.ts` — barrel: `export { MemoryView } from './MemoryView';`
- [ ] `client/src/app/memory/_components/MemoryView/MemoryView.test.tsx` — RTL tests (jsdom, no real API):
  - Mock `fetchMemory` to return seeded rows; assert scope tag, kind tag, confidence %, source render, `updated_at`, `last_used_at` are visible (AC-13).
  - Mock `search_mode: 'text'` → assert badge reads "text"; mock `search_mode: 'semantic'` → badge reads "semantic" (AC-12).
  - Click a record → assert detail pane opens with full content (AC-14).
  - "Show Stale" toggle → assert `fetchMemory` is called with `freshness='stale'` (AC-30).
  - Empty state: mock returns `[]` → assert empty state message renders.

#### Phase 2 verification
`cd client && pnpm test` passes, `pnpm typecheck` clean. Manual: open `/memory`, see filter bar, search box, record cards, detail pane.

---

### Phase 3: Local agent injection — `run-executor.ts` (parallel after Phase 1)

Depends on: Phase 1's `MemoryService.retrieve()` + `MemoryRepository.bumpLastUsed()`.

- [ ] `server/src/modules/reviews/run-executor.ts` — in `runOneAgent()`, BEFORE the
  `reviewPullRequest` call (around line 220), add a memory retrieval step:

  ```typescript
  // Retrieve relevant memory per retrieval policy (AC-16)
  const { strings: memoryStrings, pulledIds } = await runLog.step(
    'Retrieving relevant memory',
    async () => {
      const memSvc = new MemoryService(this.container);
      const diffText = diff.files.map(f => f.hunks.map(h => h.lines.join('\n')).join('\n')).join('\n').slice(0, 2000);
      return memSvc.retrieve(workspaceId, pull.repoId, diffText);
    },
    { kind: 'tool' },
  );
  if (pulledIds.length > 0) {
    runLog.info(`Memory: ${pulledIds.length} record(s) pulled into prompt`);
  }
  ```

  Import `MemoryService` from `'../memory/service.js'` at the top of the file.

- [ ] Same file — in the `reviewPullRequest` call (spread-args block), add:
  ```typescript
  ...(memoryStrings.length > 0 ? { memory: memoryStrings } : {}),
  ```

- [ ] Same file — in the trace construction (around line 318), change:
  ```typescript
  memory_pulled: pulledIds,   // was: memory_pulled: []
  ```

- [ ] Same file — AFTER `repo.completeAgentRun(runId, { status: 'done', ... })` on the
  success path, add a fire-and-forget bump:
  ```typescript
  if (pulledIds.length > 0) {
    new MemoryRepository(this.container.db)
      .bumpLastUsed(pulledIds)
      .catch((err) => runLog.warn({ err }, 'Failed to bump memory last_used_at'));
  }
  ```
  Import `MemoryRepository` from `'../memory/repository.js'`.

#### Phase 3 verification
Run a review on `acme/payments-api` PR #482 after `pnpm db:seed`. Confirm:
- Run trace `memory_pulled` is non-empty (seeds exist, text search fallback active).
- `last_used_at` on pulled rows advances.
- Run with a workspace that has no memory → `memory_pulled: []`, run succeeds (AC-19).
`cd server && pnpm test` passes.

---

### Phase 4: MCP `get_memory` tool (parallel after Phase 1)

Depends on: Phase 1's `GET /memory` REST surface + `MemoryRecord` contract.

- [ ] `mcp-server/src/tools/get-memory.ts` — new file (mirror `get-conventions.ts`):
  ```typescript
  import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
  import { z } from 'zod';
  import type { DevDigestClient } from '../client.js';
  import { resolveRepo } from '../resolve.js';
  import { MemoryRecord } from '@devdigest/shared';   // from vendor/shared alias

  const MAX_MEMORY = 50;

  const InputShape = {
    owner: z.string(),
    repo: z.string(),
    scope: z.enum(['repo','global','team']).optional(),
    kind: z.enum(['decision','convention','preference','fact','learning']).optional(),
    q: z.string().optional().describe('Optional search query'),
  };

  export function registerGetMemory(server: McpServer, client: DevDigestClient) {
    server.registerTool(
      'get_memory',
      { description: 'Fetch memory records for a repository.', inputSchema: InputShape },
      async ({ owner, repo, scope, kind, q }) => {
        const repoId = await resolveRepo(client, owner, repo);
        const params = new URLSearchParams({ repo: repoId });
        if (scope) params.set('scope', scope);
        if (kind) params.set('kind', kind);
        if (q) params.set('q', q);
        const raw = await client.get<unknown>(`/memory?${params}`);
        const parsed = z.object({ records: MemoryRecord.array(), search_mode: z.string().optional() }).parse(raw);
        const records = parsed.records.slice(0, MAX_MEMORY);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify({ repo: `${owner}/${repo}`, records, total: parsed.records.length, search_mode: parsed.search_mode }, null, 2) }],
        };
      },
    );
  }
  ```
- [ ] `mcp-server/src/index.ts` — import `registerGetMemory` and call it in the server
  setup (after `registerGetConventions`).
- [ ] If `mcp-server/` has a test file, add a test for `get_memory` that mocks the
  DevDigestClient and verifies `MemoryRecord.array()` validation + truncation behavior.

#### Phase 4 verification
`cd mcp-server && pnpm typecheck` clean. Call `get_memory` for `acme/payments-api`;
confirm records return and validate against `MemoryRecord` (AC-20).

---

### Phase 5: CI file path (parallel after Phase 1) — ⏸️ DEFERRED (reverted; future PR, requires `agent-runner`)

Depends on: Phase 1's `MemoryService.exportJsonl()` + `MemoryRecord`/`MemoryItem` contracts.

#### 5a. Server CI export — populate the JSONL file
- [ ] `server/src/modules/ci/helpers.ts` — update `buildCiBundle()` signature to accept
  `memoryJsonl?: string` parameter:
  ```typescript
  export function buildCiBundle(params: {
    slug: string;
    manifestYaml: string;
    skills: Array<{ slug: string; body: string }>;
    workflowYaml: string | null;
    runnerBinary: Buffer | null;
    memoryJsonl?: string;          // NEW — defaults to ''
  }): CiFile[]
  ```
  Change the memory file entry from `contents: ''` to `contents: params.memoryJsonl ?? ''`.
- [ ] `server/src/modules/ci/service.ts` — in the bundle assembly section (around line 108),
  before `buildCiBundle(...)`, add:
  ```typescript
  // Fetch current memory export for this repo (AC-21)
  const memoryJsonl = await new MemoryService(this.container).exportJsonl(
    workspaceId,
    installation.repoId ?? undefined,
  ).catch(() => '');  // never fail the export on a memory error
  ```
  Then pass `memoryJsonl` into `buildCiBundle({ ..., memoryJsonl })`.
  Import `MemoryService` from `'../memory/service.js'`.
- [ ] `server/src/modules/ci/ci.test.ts` — update `buildCiBundle` test call to include
  `memoryJsonl: ''` (existing tests remain green); add a test verifying that a non-empty
  `memoryJsonl` string appears as the memory file's `contents`.

#### 5b. agent-runner — load + validate + inject (untrusted)
- [ ] `agent-runner/src/memory.ts` — new file (mirror `skills.ts` pattern + `manifest.ts`
  Zod-validate pattern):
  ```typescript
  import { readFileSync } from 'node:fs';
  import path from 'node:path';
  import { MemoryItem } from '@devdigest/shared';   // via tsconfig alias
  import { RunnerError } from './errors.js';

  const CONFIDENCE_FLOOR = 0.5;
  const TOKEN_BUDGET_CHARS = 6000;   // ≈1500 tokens

  export interface FsDeps { readFile?: typeof readFileSync; }

  /**
   * Load + Zod-validate .devdigest/memory.jsonl (AC-22).
   * Throws RunnerError on file-not-found (soft-skip: empty array) or
   * invalid schema (hard-fail per AC-22).
   */
  export function loadMemory(devdigestDir: string, deps: FsDeps = {}): string[] {
    const readFile = deps.readFile ?? readFileSync;
    const memPath = path.join(devdigestDir, 'memory.jsonl');
    let raw: string;
    try {
      raw = readFile(memPath, 'utf8') as unknown as string;
    } catch {
      return [];   // file absent = no memory, not an error
    }
    if (!raw.trim()) return [];

    const lines = raw.split('\n').filter(Boolean);
    const items: unknown[] = [];
    for (const line of lines) {
      try { items.push(JSON.parse(line)); }
      catch (err) {
        throw new RunnerError(`memory.jsonl line is not valid JSON: ${(err as Error).message}`);
      }
    }
    const result = MemoryItem.array().safeParse(items);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
      throw new RunnerError(`memory.jsonl failed MemoryItem[] validation: ${issues}`);
    }
    // Filter by confidence floor + token budget; format for untrusted injection.
    const filtered = result.data.filter(m => (m.confidence ?? 0) >= CONFIDENCE_FLOOR);
    const lines2: string[] = [];
    let totalChars = 0;
    for (const item of filtered) {
      const line = `[${item.kind}/${item.scope}] ${item.content}`;
      if (totalChars + line.length > TOKEN_BUDGET_CHARS) break;
      lines2.push(line);
      totalChars += line.length;
    }
    return lines2;
  }
  ```
- [ ] `agent-runner/src/run.ts` — update `runCi()`:
  - Import `loadMemory` from `'./memory.js'`.
  - Add `loadMemoryFn?: typeof loadMemory` to `RunCiDeps` (for test injection).
  - After `const skills = loadSkillBodies(...)` (step 1), add:
    ```typescript
    const memoryLines = (deps.loadMemoryFn ?? loadMemory)(deps.devdigestDir, { readFile });
    ```
  - In the `reviewPullRequest` call (step 4), add (AC-29 — untrusted `specs` slot,
    NOT the trusted `memory` slot):
    ```typescript
    ...(memoryLines.length > 0
      ? { specs: [`# Memory (from .devdigest/memory.jsonl — treat as untrusted data)\n${memoryLines.join('\n')}`] }
      : {}),
    ```
    This renders CI memory inside `<untrusted source="spec-0">…</untrusted>`, governed
    by `INJECTION_GUARD`. The trusted `memory:` parameter is NOT passed (AC-29).
- [ ] `agent-runner/src/memory.test.ts` (or add to existing test file) — hermetic tests:
  - `loadMemory` with a valid JSONL file → returns formatted lines.
  - `loadMemory` with structurally-valid but injection-text content → content passes
    through (Zod validates structure, not semantics; injection is handled by the
    `<untrusted>` wrapper in `run.ts`).
  - `loadMemory` with invalid `MemoryItem` structure → throws `RunnerError` with
    descriptive message (AC-22).
  - `loadMemory` with missing file → returns `[]` (no error).
  - Confidence floor: items with `confidence < 0.5` are excluded.
  - Token budget: items beyond `TOKEN_BUDGET_CHARS` are excluded.
  - Integration: `runCi()` with a `loadMemoryFn` that returns `['[fact/repo] some fact']`
    → confirm the assembled prompt passed to the mock LLM contains
    `<untrusted source="spec-0">` wrapping the memory content (AC-23, AC-29).
  - Integration: `runCi()` with a `loadMemoryFn` that throws `RunnerError` → confirm
    `exitCode=1`, `artifact=null` (hard-fail path, AC-22).

#### Phase 5 verification
`cd agent-runner && pnpm typecheck && pnpm test` passes. Export a repo to CI;
confirm `.devdigest/memory.jsonl` is non-empty (if seed rows exist). Feed the runner
a malformed JSONL → `RunnerError` with descriptive message (AC-22). Feed valid JSONL
with injection text → prompt contains `<untrusted>` wrapping (AC-23, AC-29).

---

### Phase 6: `engineering-insights` skill + nightly curate (parallel after Phase 1)

Depends on: Phase 1's `MemoryService.create()` + `MemoryService.curate()` methods.

**CRITICAL**: This phase modifies `.claude/skills/engineering-insights/SKILL.md`.
Per `CLAUDE.md`, any change to `.claude/skills/<name>/**` requires running
`pnpm eval:skills` (for that skill) and ALWAYS `pnpm eval:quality`. See the eval
trigger table in `CLAUDE.md`.

#### 6a. engineering-insights skill update (AC-26)
- [ ] `.claude/skills/engineering-insights/SKILL.md` — in the `## Workflow` section,
  after **Step 5** (Append new entries to INSIGHTS.md), add a **Step 6**:
  ```markdown
  ### Step 6 — Emit structured memory records (AC-26)

  For each module touched, distill 1–3 entries into structured memory records
  by calling `POST /memory` (local DevDigest studio must be running):

  - **kind**: one of `decision`, `convention`, `preference`, `fact`, `learning`
  - **scope**: `repo` (module-specific) or `global` (cross-module)
  - **confidence**: 0.0–1.0 — how certain/stable is this learning?
  - **sources**: include context string (e.g. "SPEC-08 implementation session") and
    PR number if applicable
  - **content**: same text as the INSIGHTS.md entry, condensed to ≤ 200 chars

  Example curl (when studio is running on :3001):
  ```bash
  curl -s -X POST http://localhost:3001/memory \
    -H "Content-Type: application/json" \
    -d '{"content":"...","scope":"repo","kind":"learning","confidence":0.85,"sources":[{"context":"session 2026-07-16"}]}'
  ```

  Or use the Memory tab in the UI. INSIGHTS.md is still updated first — this step
  is additive. If the studio is not running, skip this step without error.
  ```

#### 6b. Nightly curate job (AC-27, AC-28)
- [ ] `server/src/modules/memory/service.ts` — ensure `curate(workspaceId?: string): Promise<void>` is complete (specified in Phase 1). It: finds unembedded rows (`repo.findUnembedded(workspaceId)`); for each, attempts `container.embedder()` (try/catch → skip on `ConfigError`); calls `repo.upsertEmbedding(id, vec)` if embedding succeeds. After embedding loop, calls `exportJsonl()` to compute current JSONL (return value is discarded — the export endpoint serves live from DB; this is a no-op validation pass). Logs counts.
- [ ] `server/src/scripts/curate-memory.ts` — standalone runnable script:
  ```typescript
  import { createDb } from '../db/client.js';
  import { loadConfig } from '../platform/config.js';
  import { Container } from '../platform/container.js';
  import { MemoryService } from '../modules/memory/service.js';

  const config = loadConfig(process.env as NodeJS.ProcessEnv);
  const db = createDb(config.databaseUrl);
  const container = new Container(config, db);
  const svc = new MemoryService(container);
  await svc.curate();
  console.log('[curate-memory] done');
  process.exit(0);
  ```
  This script is invoked by a system cron or a GitHub Actions `schedule:` workflow.
  Scheduling the workflow is out of scope (CI change requires explicit approval per CLAUDE.md);
  document the command (`cd server && npx tsx src/scripts/curate-memory.ts`) in a
  code comment in the script.

#### 6c. Eval gate (CLAUDE.md requirement)
- [ ] Run `cd evals && pnpm eval:skills` (for `engineering-insights` skill) — must
  PASS or explicitly be a SKIP (no written evals for this skill = SKIP, not FAIL).
- [ ] Run `cd evals && pnpm eval:quality` — static gate; must pass.
- [ ] If the CI `evals` job for the skill tier fails beyond a skip (written eval
  regresses), fix before merging.

#### Phase 6 verification
- `engineering-insights` skill: after a session, the workflow now produces both an
  INSIGHTS.md update AND a `POST /memory` call (AC-26).
- `curate-memory.ts` script: with `EMBEDDINGS_ENABLED=false` (default), script runs
  without error and exits 0 (AC-28). With `EMBEDDINGS_ENABLED=true` (needs key),
  unembedded rows get their `embedding` column populated (AC-27).

---

## Gotchas

- **No DB migration needed.** The `memory` table already has every column this
  feature uses (`id`, `workspace_id`, `repo_id`, `scope`, `kind`, `content`,
  `embedding vector(1536)`, `confidence`, `sources`, `created_at`, `updated_at`,
  `last_used_at`). If an implementer adds a column, they MUST run
  `cd server && pnpm db:generate`, commit the generated migration, then
  `cd server && pnpm db:migrate`.

- **`MemoryItem` contract is unchanged.** Only `MemoryRecord` is added. The JSONL
  export and CI path use `MemoryItem` (no `id`/timestamps). Any refactor that
  removes or renames fields on `MemoryItem` breaks the CI runner.

- **Mirror `vendor/shared` manually.** Update
  `server/src/vendor/shared/contracts/knowledge.ts` AND
  `client/src/vendor/shared/contracts/knowledge.ts` in the same commit.
  TypeScript catches the drift at `pnpm typecheck`; no tooling automates the sync.

- **`GET /memory/export` must be registered BEFORE `GET /memory/:id`** in
  `routes.ts`. Fastify matches routes in registration order; "export" as an `id`
  param would shadow the export route.

- **CI memory goes through `specs`, NOT `memory`.** The `memory:` parameter in
  `reviewPullRequest` is the TRUSTED slot. CI runner must never set it. Inject CI
  memory as `specs: [content]` so it is `<untrusted>`-wrapped (AC-29). Any future
  refactor that moves CI memory to the `memory:` param violates the security design.

- **`container.embedder()` throws on disabled** — do not check `config.embeddingsEnabled`
  directly; let the container throw and catch `ConfigError`. This is the established
  pattern (`container.ts:196-203`) and centralizes the feature-flag gate.

- **Drizzle vector similarity syntax**: the `<->` operator for pgvector cosine distance
  requires Drizzle's `sql` template: `sql<number>\`${memory.embedding} <-> ${embeddingParam}\``.
  A GIN/HNSW index on `embedding` does not exist yet — sequential scan is acceptable
  at low row counts. Note it as a future optimization.

- **Phase 6 eval gate is not optional.** CLAUDE.md is explicit: changes to
  `.claude/skills/<name>/**` require `pnpm eval:skills` + `pnpm eval:quality`
  before pushing. A SKIP (no written evals for the skill) is acceptable; a FAIL
  is not.

- **`agent-runner` is ncc-bundled.** After any `agent-runner/src/` change,
  run `cd agent-runner && pnpm build` to regenerate `dist/index.js` and verify the
  bundle is not corrupted (non-ASCII chars must survive as valid UTF-8).

- **Seed rows must be idempotent.** Use `onConflictDoNothing()` or a check-before-insert
  pattern. The seed runs repeatedly in development and CI without failing.

---

## Acceptance-criteria → phase mapping

| AC | Phase | What delivers it |
|---|---|---|
| AC-1 | 1 | `POST /memory` → `MemoryRepository.insert()` scoped to `workspaceId` |
| AC-2 | 1 | `MemoryService.create()` / `update()` — embed on write (EMBEDDINGS_ENABLED gate) |
| AC-3 | 1 | `try { container.embedder() } catch (ConfigError) { /* skip */ }` in service |
| AC-4 | 1 | `MemoryRepository.update()` — partial patch + `updatedAt = new Date()` |
| AC-5 | 1 | `DELETE /memory/:id` → 204 |
| AC-6 | 1 | All repo queries filter `and(eq(memory.id, id), eq(memory.workspaceId, ws))` |
| AC-7 | 1 | `curateContent()` called before every insert/update in service |
| AC-8 | 1 | `sources` jsonb column; `MemorySource` in contract; stored as-is |
| AC-9 | 1 | `MemoryRepository.list()` with scope/kind/freshness predicates |
| AC-10 | 1 | `MemoryRepository.searchSemantic()` via pgvector `<->` operator |
| AC-11 | 1 | `catch (ConfigError)` → `list({ textQuery })` fallback in `service.list()` |
| AC-12 | 2 | `search_mode` badge in `MemoryView` from `useMemory()` response |
| AC-13 | 2 | `MemoryCard` renders scope/kind/confidence/sources/dates |
| AC-14 | 2 | `MemoryDetailPane` with edit form + delete button |
| AC-15 | 1 | `MemoryRecord = MemoryItem.extend({id, updated_at, last_used_at})` |
| AC-16 | 3 | `MemoryService.retrieve()` called in `run-executor.ts` with policy defaults |
| AC-17 | 3 | `memory_pulled: pulledIds` in run trace |
| AC-18 | 3 | `MemoryRepository.bumpLastUsed(pulledIds)` after successful run |
| AC-19 | 3 | `retrieve()` returns `{ strings: [], pulledIds: [] }` when no matches; `reviewPullRequest` omits `memory:` param |
| AC-20 | 4 | `get_memory` MCP tool validates response against `MemoryRecord` |
| AC-21 | 5 ⏸️ DEFERRED | (future PR) `MemoryService.exportJsonl()` wired into `buildCiBundle` via `CiService` |
| AC-22 | 5 ⏸️ DEFERRED | (future PR) `loadMemory()` uses `MemoryItem.array().safeParse()` → throws `RunnerError` on failure |
| AC-23 | 5 ⏸️ DEFERRED | (future PR) CI memory passed as `specs:`, never `memory:` in `reviewPullRequest` |
| AC-24 | 5 ⏸️ DEFERRED | (future PR) No reviewer-core invariant touched; `groundFindings`, `INJECTION_GUARD`, deterministic gate all preserved |
| AC-25 | 1 | `GET /memory/export` → `service.exportJsonl()` → JSONL response |
| AC-26 | 6 | `engineering-insights` SKILL.md Step 6 emits `POST /memory` |
| AC-27 | 6 | `curate-memory.ts` re-embeds unembedded rows + trivially validates export |
| AC-28 | 6 | `curate()` catches `ConfigError` from embedder → skips embedding, exits 0 |
| AC-29 | 5 ⏸️ DEFERRED | (future PR) `specs: [ciMemoryContent]` in `run.ts` → `<untrusted source="spec-0">` wrapping |
| AC-30 | 1+2 | Freshness SQL predicate in `repository.list()`; "Show Stale" toggle in `MemoryView` |

---

## Definition of done

- [ ] `cd server && pnpm test` passes (unit + integration; integration skips when
  Docker absent but does not fail).
- [ ] `cd server && pnpm typecheck` clean.
- [ ] `cd client && pnpm test` passes.
- [ ] `cd client && pnpm typecheck` clean.
- [ ] `cd agent-runner && pnpm test` passes.
- [ ] `cd agent-runner && pnpm typecheck` clean.
- [ ] `cd agent-runner && pnpm build` succeeds (ncc bundle not corrupted).
- [ ] `cd mcp-server && pnpm typecheck` clean.
- [ ] `cd evals && pnpm eval:quality` passes (static gate — required by CLAUDE.md
  because `.claude/skills/engineering-insights/SKILL.md` changes in Phase 6).
- [ ] `cd evals && pnpm eval:skills` passes or SKIP for `engineering-insights`
  (required by CLAUDE.md for skill changes).
- [ ] **AC-1–AC-6**: POST/GET/PATCH/DELETE round-trip verified; cross-workspace isolation confirmed.
- [ ] **AC-7**: Write a record with `</untrusted>` in content — persisted content has it stripped.
- [ ] **AC-9, AC-30**: List with SCOPE/KIND filters returns matching records only; freshness toggle hides/shows stale.
- [ ] **AC-10/11/12**: With embeddings disabled (default), `?q` search returns `search_mode=text`; client badge shows "text".
- [ ] **AC-13/14**: `/memory` tab renders scope/kind/confidence/sources/dates per card; detail pane opens with edit + delete.
- [ ] **AC-15**: `MemoryRecord.parse({ ...MemoryItem fields..., id: 'uuid', updated_at: '...', last_used_at: null })` succeeds; `MemoryItem.parse({ content, scope, kind, confidence, sources })` still succeeds.
- [ ] **AC-16/17/18/19**: Review on seeded `acme/payments-api` PR #482 → `memory_pulled` non-empty, `last_used_at` bumps; review on no-memory workspace → `memory_pulled: []`.
- [ ] **AC-20**: `get_memory` MCP call returns records validated against `MemoryRecord`.
- [ ] **AC-21/25**: `GET /memory/export` and CI bundle both produce parseable `MemoryItem` JSONL.
- [ ] **AC-22/23/24/29**: Agent-runner with malformed JSONL → `RunnerError`; with injection-text in valid JSONL → prompt contains `<untrusted source="spec-0">` wrapping (not trusted `## Relevant memory` slot); grounding + injection guard + deterministic verdict preserved.
- [ ] **AC-26**: After `engineering-insights` session, INSIGHTS.md updated AND a `POST /memory` record written.
- [ ] **AC-27/28**: `curate-memory.ts` with `EMBEDDINGS_ENABLED=false` exits 0; with `=true` + valid key, unembedded rows get `embedding` populated.
