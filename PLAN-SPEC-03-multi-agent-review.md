# Plan: Multi-Agent Review

## Spec reference

`specs/SPEC-03-multi-agent-review.md`

## Execution mode: multi-agent

Five phases; two execute in the first wave (Phase 1 + Phase 2 in parallel), two in the second wave (Phase 3 + Phase 4 in parallel after Phase 1), and one in the third wave (Phase 5 after Phase 3). Five implementer agents at most; natural minimum for the dependency graph.

```
Wave 1 (parallel):  [Phase 1: Server foundation]  [Phase 2: Executor concurrency]
                                   ↓ (Phase 1 done)
Wave 2 (parallel):  [Phase 3: Client infra + PR picker]  [Phase 4: Results page]
                           ↓ (Phase 3 done)
Wave 3:             [Phase 5: Configure Run page]
```

## Goal

Users currently run one review agent at a time per PR. This feature adds parallel multi-agent runs: a PR-page checkbox picker (with per-agent time/cost estimates), a Configure Run page, a multi-run grouping service that records N agent_runs under a single `multi_agent_runs` row, and a Multi-Agent Review results page showing per-agent findings side-by-side plus a "Where agents disagree" cross-agent conflict view grouped by file and overlapping line range.

## Modules affected

- `server/` — new `multi-runs` feature module (routes, service, repository, helpers); `db/schema/runs.ts` migration to add `multi_agent_run_id` nullable FK on `agent_runs`; executor concurrency change in `reviews/run-executor.ts`; backward-compatible extension of `ReviewService.runReview`; new Zod contracts added to `vendor/shared/contracts/observability.ts`
- `client/` — new `app/multi-runs/configure/` and `app/multi-runs/[multiRunId]/` page routes; modified `RunReviewDropdown` on the PR detail page; new `lib/hooks/multi-runs.ts`; new `lib/api.ts` functions; new `messages/en/multiRuns.json` i18n file

## Engineering Insights applied

- `cost_usd` is already stored on `agent_runs` rows at completion by the executor via `completeAgentRun`. The multi-run aggregate `total_cost_usd` sums those columns directly in the repository — no service-layer price-book call needed for reads (INSIGHTS: cost-at-read-time pattern).
- `reviews.run_id` links to `agent_runs.id`, not to `multi_agent_runs.id`. To aggregate findings for a multi-run batch: collect all `agent_runs.id` where `multi_agent_run_id = ?`, then join `reviews` on `run_id` (INSIGHTS: FK chain context note).
- Per-agent estimates: one IN-query over `agent_runs` for all agent IDs in the workspace (status='done', last N rows), then group by `agent_id` in JS to compute averages — same IN-query + JS-Map pattern as `costByPr` (INSIGHTS: aggregation pattern).
- `cost_usd` on `AgentRunSummary` must use `.nullish()` (not `.nullable()`) because `agent_runs` rows written before cost tracking existed lack this column; `.nullable()` is correct only for `total_cost_usd` on `MultiRunRecord` which the service always computes. (INSIGHTS: nullish vs nullable decision.)
- Both `server/src/vendor/shared/` and `client/src/vendor/shared/` must be updated together; only `tsc` catches the drift — no tooling enforces it. (INSIGHTS + client INSIGHTS: manual mirror of vendor.)
- Test fixtures for any contract that gains a required (non-.nullish) field must be updated in every hardcoded factory object in `*.test.tsx` files; otherwise TS2741 errors appear at test time. (INSIGHTS: recurring error pattern.)
- New components used by exactly two routes belong in `client/src/components/<Name>/` (shared), not colocated under one route. Components used by exactly one route stay colocated. (INSIGHTS: shared component placement, ui-architecture skill.)

## Recommendations

- `RunTraceDrawer` props (`runId, agentName?, prNumber?, findings?, running?, onClose`) are already fully generic — confirmed by reading the component source. Zero modifications to the drawer itself are needed. However, it is currently colocated under the PR detail page's `_components/` folder. Since the Multi-Agent Review results page (a different route) also needs it, Phase 4 should move it to `client/src/components/RunTraceDrawer/` (shared components zone) and update the PR-detail page's import — one clean move, no duplication.
- The cross-agent grouping algorithm (file + overlapping line range) is a pure function with no I/O — implement it in `server/src/modules/multi-runs/helpers.ts` as a unit-testable standalone. The client receives pre-grouped data and applies the "show only conflicts" toggle filter client-side (cheap array filter, no extra API call).
- `RunRequest` (in `vendor/shared/contracts/review-api.ts`) must NOT be modified. The spec permits "a new parallel request contract" — use a new `MultiReviewRequest` Zod schema for `POST /pulls/:id/multi-review`. This eliminates any risk of breaking existing single-agent callers.
- Per the postgresql-table-design skill: PostgreSQL does NOT auto-index FK columns. The new `agent_runs.multi_agent_run_id` column is the primary filter for every multi-run read. Declare a Drizzle index on it in `schema/runs.ts` so `pnpm db:generate` includes a `CREATE INDEX` in the migration.

## Architecture decisions

- **New `modules/multi-runs/` module, not extending `modules/reviews/`** — multi-run grouping is a distinct domain concern. Extending `reviews/` with 4 new endpoints and a grouping service would violate the one-domain-per-module convention (onion-architecture skill: module anatomy).
- **`multi-runs/service.ts` imports `ReviewService` from `modules/reviews/service.ts`** — a service-layer-to-service-layer cross-module call. Valid: no circular dependency (`reviews` never imports from `multi-runs`). The alternative — duplicating agent_run creation logic — would create divergent behavior and maintenance risk.
- **`ReviewService.runReview` extended with `opts?: { multiRunId?: string }`** — additive, backward-compatible. Existing callers (the `POST /pulls/:id/review` route) pass no opts; `multiAgentRunId` defaults to null in the INSERT. Multi-run callers pass `{ multiRunId }` and the FK is set. The extension is two lines in `service.ts` and one field addition in `run.repo.ts`.
- **Sequential for-loop → `Promise.allSettled` in `run-executor.ts`** — confirmed required. AC-4 says "total estimated duration assuming parallel execution"; AC-16 says the summary line shows execution model as "parallel"; the architecture diagram labels the background work "parallel fan-out". A sequential loop makes the "parallel" UI label false. `Promise.allSettled` preserves per-agent isolated failure domain (AC-6): a single-agent rejection settles as `{ status: 'rejected' }` without cancelling the others. `runOneAgent` already owns its own catch/persist logic — the loop's `try/catch` wrapper is replaced by the settled-result check.
- **Client route at `app/multi-runs/`** — top-level, not under `repos/[repoId]/`, because results are addressed by `multiRunId` (not by repoId + prNumber), and the Configure Run page is a standalone flow that selects its own PR. Workspace scoping is server-enforced via `getContext` on every endpoint.
- **New `lib/hooks/multi-runs.ts`** — separates multi-run hooks from `lib/hooks/reviews.ts` to avoid Phase 3 and Phase 4 implementers editing the same file concurrently. Phase 3 creates this file; Phase 4 imports from it. (ui-architecture skill: hooks in `lib/hooks/<domain>.ts`.)
- **"Show only conflicts" filtering is client-side** — the server returns all finding groups (each with every agent's verdict or null). The toggle filter (`agent_verdicts` has ≥ 2 distinct verdict strings, counting null as "did not flag") is a cheap array filter in the component — no extra API call, no server state.

---

## Tasks

---

### Phase 1: DB schema + Zod contracts + multi-run backend module

**This phase runs first. Phases 3 and 4 cannot start until Phase 1 is complete** (they call the new server endpoints).

#### 1.1 Schema — add `multi_agent_run_id` FK column and index

- [ ] `server/src/db/schema/runs.ts` — in the `agentRuns` table definition, add:
  ```typescript
  multiAgentRunId: uuid('multi_agent_run_id')
    .references(() => multiAgentRuns.id, { onDelete: 'set null' }),
  ```
  (nullable — no `.notNull()`; no default. The reference must be declared after `multiAgentRuns` in the file; confirm import/declaration order does not create a circular schema reference. In Drizzle, use an arrow function `() => multiAgentRuns.id` to avoid this.)

  Also declare a Drizzle index in the same file (per postgresql-table-design: FK columns are not auto-indexed):
  ```typescript
  export const agentRunsMultiRunIdx = index('agent_runs_multi_agent_run_id_idx')
    .on(agentRuns.multiAgentRunId);
  ```

> **Migrations never auto-run — do not skip these steps:**
- [ ] Run `cd server && pnpm db:generate` — review the generated SQL in `server/src/db/migrations/` for correctness (expect: `ALTER TABLE "agent_runs" ADD COLUMN "multi_agent_run_id" uuid REFERENCES "multi_agent_runs"("id") ON DELETE SET NULL;` and a `CREATE INDEX` statement). Commit the generated migration file to git.
- [ ] Run `cd server && pnpm db:migrate` — apply the migration to the running Postgres instance.

#### 1.2 Extend `createAgentRun` to accept the optional FK

- [ ] `server/src/modules/reviews/repository/run.repo.ts` — add `multiAgentRunId?: string | null` to the `values` parameter of `createAgentRun`. Include `multiAgentRunId: values.multiAgentRunId ?? null` in the Drizzle `.values({...})` call. Existing callers omit this field; they receive `null` implicitly.
- [ ] `server/src/modules/reviews/repository.ts` — update the `createAgentRun` wrapper method's parameter type to match the new optional field.

#### 1.3 Extend `ReviewService.runReview` with optional `multiRunId`

- [ ] `server/src/modules/reviews/service.ts` — add optional parameter `opts?: { multiRunId?: string }` to `runReview`. In the loop that calls `repo.createAgentRun(...)`, pass `multiAgentRunId: opts?.multiRunId ?? null`.

#### 1.4 New Zod contracts — server vendor

- [ ] `server/src/vendor/shared/contracts/observability.ts` — append the following new exports (additive only; do NOT touch existing `MultiAgentRun`, `AgentColumn`, `Conflict`, `ConflictTake`, `AgentStats`, `StatPoint`, `CuratorResult`, or `CuratorMerge` exports):

  - `MultiReviewRequest` — body for `POST /pulls/:id/multi-review`:
    ```typescript
    export const MultiReviewRequest = z.object({
      agentIds: z.array(z.string().uuid()).min(1),
    });
    export type MultiReviewRequest = z.infer<typeof MultiReviewRequest>;
    ```

  - `AgentRunSummary` — per-agent status entry within a multi-run result:
    ```typescript
    export const AgentRunSummary = z.object({
      run_id: z.string(),
      agent_id: z.string().nullable(),
      agent_name: z.string().nullable(),
      status: z.enum(['running', 'done', 'failed', 'cancelled']),
      score: z.number().int().nullable(),
      finding_count: z.number().int().nullable(),
      cost_usd: z.number().nullish(),     // .nullish() — rows written before cost tracking lack this
      duration_ms: z.number().int().nullish(),
      error: z.string().nullable(),
    });
    export type AgentRunSummary = z.infer<typeof AgentRunSummary>;
    ```

  - `MultiRunRecord` — aggregate response for `GET /multi-runs/:id`:
    ```typescript
    export const MultiRunRecord = z.object({
      id: z.string(),
      pr_id: z.string(),
      pr_number: z.number().int().nullish(), // joined from pulls table; nullish for forward compat
      ran_at: z.string(),
      agents: z.array(AgentRunSummary),
      total_cost_usd: z.number().nullable(),   // .nullable() — service always computes this
      total_duration_ms: z.number().int().nullable(),
    });
    export type MultiRunRecord = z.infer<typeof MultiRunRecord>;
    ```

  - `AgentEstimate` — per-agent estimate for the Configure Run page:
    ```typescript
    export const AgentEstimate = z.object({
      agent_id: z.string(),
      agent_name: z.string(),
      estimated_duration_ms: z.number().int().nullable(),
      estimated_cost_usd: z.number().nullable(),
      last_finding_summary: z.string().nullable(),
      has_historical_data: z.boolean(),
    });
    export type AgentEstimate = z.infer<typeof AgentEstimate>;
    ```

  - `FindingGroup` — one cross-agent finding group (file + overlapping line range):
    ```typescript
    // Import FindingRecord from './findings.js' at the top of the file
    export const FindingGroup = z.object({
      file: z.string(),
      start_line: z.number().int(),
      end_line: z.number().int(),
      agent_verdicts: z.array(z.object({
        agent_id: z.string().nullable(),
        agent_name: z.string().nullable(),
        finding: FindingRecord.nullable(),  // null = "did not flag"
      })),
    });
    export type FindingGroup = z.infer<typeof FindingGroup>;
    ```

  - `MultiRunFindings` — response for `GET /multi-runs/:id/findings`:
    ```typescript
    export const MultiRunFindings = z.object({
      agents: z.array(z.object({
        agent_id: z.string().nullable(),
        agent_name: z.string().nullable(),
        findings: z.array(FindingRecord),
      })),
      groups: z.array(FindingGroup),
    });
    export type MultiRunFindings = z.infer<typeof MultiRunFindings>;
    ```

- [ ] `server/src/vendor/shared/index.ts` — add exports for `MultiReviewRequest`, `AgentRunSummary`, `MultiRunRecord`, `AgentEstimate`, `FindingGroup`, `MultiRunFindings` from `./contracts/observability.js`.

#### 1.5 Mirror contracts to client vendor (update in lockstep)

- [ ] `client/src/vendor/shared/contracts/observability.ts` — append the same six new export blocks from step 1.4 verbatim. Import `FindingRecord` from `./findings.js`.
- [ ] `client/src/vendor/shared/index.ts` — add the same six exports.

#### 1.6 Multi-runs repository

- [ ] Create `server/src/modules/multi-runs/repository.ts` — plain functions over `Db`; no business logic:

  - `insertMultiRun(db: Db, values: { workspaceId: string; prId: string }): Promise<string>` — inserts a row into `multi_agent_runs`, returns the new `id`.

  - `findMultiRunById(db: Db, workspaceId: string, multiRunId: string): Promise<{ id: string; prId: string; prNumber: number | null; ranAt: Date } | undefined>` — SELECT from `multi_agent_runs` LEFT JOIN `pullRequests` (for the PR number) where `id = multiRunId AND workspace_id = workspaceId`.

  - `getAgentRunsByMultiRunId(db: Db, multiRunId: string): Promise<{ id: string; agentId: string | null; agentName: string | null; status: string | null; score: number | null; findingsCount: number | null; costUsd: string | null; durationMs: number | null; error: string | null }[]>` — SELECT from `agent_runs` LEFT JOIN `agents` where `multi_agent_run_id = multiRunId`; include `agents.name` as `agentName`.

  - `getLastNRunsPerAgent(db: Db, workspaceId: string, agentIds: string[]): Promise<{ agentId: string; costUsd: string | null; durationMs: number | null }[]>` — SELECT from `agent_runs` where `workspace_id = workspaceId AND agent_id IN (agentIds) AND status = 'done' AND cost_usd IS NOT NULL AND duration_ms IS NOT NULL` ORDER BY `ran_at DESC`. Caller groups by `agentId` in JS and slices to the last 10. (Returns all qualifying rows; service layer slices and averages per agent.)

  - `getLastFindingSummaryPerAgent(db: Db, workspaceId: string, agentIds: string[]): Promise<{ agentId: string | null; summary: string | null }[]>` — for each agent, find the most recent `reviews` row (joined via `reviews.run_id → agent_runs.id WHERE agent_runs.workspace_id = workspaceId AND agent_runs.agent_id IN (agentIds)`) and return its `summary` field. Use a subquery or `ROW_NUMBER` window function to get the latest per agent; alternatively use `sql` tagged template. Returns one row per agent (null when no review exists for that agent).

  - `getReviewsAndFindingsByAgentRunIds(db: Db, agentRunIds: string[]): Promise<{ agentRunId: string; agentId: string | null; agentName: string | null; findings: FindingRow[] }[]>` — SELECT from `reviews` LEFT JOIN `findings` LEFT JOIN `agent_runs` LEFT JOIN `agents` where `reviews.run_id IN (agentRunIds)`; group by agentRunId in JS after fetching all rows. Returns one entry per agentRunId even if it has zero findings.

#### 1.7 Multi-runs grouping helpers

- [ ] Create `server/src/modules/multi-runs/helpers.ts`:

  ```typescript
  /**
   * Pure function: group findings across agents by file + overlapping line range.
   * AC-12: two ranges overlap iff start_A <= end_B AND start_B <= end_A.
   * No LLM call, no DB access, no substance or category check.
   */
  export function groupFindingsByFileAndOverlap(
    agentFindings: { agentId: string | null; agentName: string | null; finding: FindingRecord }[],
    allAgents: { agentId: string | null; agentName: string | null }[],
  ): FindingGroup[]
  ```

  Algorithm:
  1. Group `agentFindings` by `finding.file` (exact path match).
  2. Within each file group, use a greedy clustering pass: for each finding not yet assigned, start a new cluster. Merge the next finding into the current cluster if its `[start_line, end_line]` overlaps the cluster's accumulated range (`start_line <= cluster.end_line && finding.start_line <= cluster.end_line` using `a.start_line <= b.end_line && b.start_line <= a.end_line`). After each merge, expand the cluster's `[start_line, end_line]` to the union of all merged ranges.
  3. For each cluster: `start_line = min(all start_lines in cluster)`, `end_line = max(all end_lines in cluster)`.
  4. For each cluster, iterate `allAgents`: include the agent's `FindingRecord` if it appears in the cluster, `null` if it does not.
  5. Return `FindingGroup[]` matching the schema from step 1.4.

  This is a pure, deterministic function — no I/O. Testable in isolation.

#### 1.8 Multi-runs service

- [ ] Create `server/src/modules/multi-runs/service.ts` — `MultiRunsService` class:

  ```typescript
  export class MultiRunsService {
    private repo: MultiRunsRepository;
    private reviewService: ReviewService;

    constructor(private container: Container) {
      this.repo = new MultiRunsRepository(container.db);
      this.reviewService = new ReviewService(container);
    }
    // ...
  }
  ```

  Methods:

  - `createMultiRun(workspaceId: string, prId: string, agentIds: string[], logger?: Logger)`:
    1. Validate PR: call `this.repo.findPull(workspaceId, prId)` (or reuse a lightweight pull lookup via container — use the existing `ReviewRepository.getPull` pattern). Throw `NotFoundError('Pull request not found')` if absent.
    2. Resolve agents: `Promise.all(agentIds.map(id => container.agentsRepo.getById(workspaceId, id)))`. If any result is `undefined`, throw `AppError('agent_not_found', 'One or more agent IDs not found in this workspace', 422)`.
    3. Insert multi-run row: `const multiRunId = await this.repo.insertMultiRun(db, { workspaceId, prId })`.
    4. Kick off reviews: `const { runs } = await this.reviewService.runReview(workspaceId, prId, agents, logger, { multiRunId })`.
    5. Return `{ multi_run_id: multiRunId, runs }`.

  - `getMultiRun(workspaceId: string, multiRunId: string)`:
    1. `const row = await this.repo.findMultiRunById(db, workspaceId, multiRunId)` — throw `NotFoundError` if absent.
    2. `const agentRuns = await this.repo.getAgentRunsByMultiRunId(db, multiRunId)`.
    3. Compute `total_cost_usd`: sum `parseFloat(ar.costUsd)` for rows where `costUsd` is not null; return `null` if no rows have non-null cost.
    4. Compute `total_duration_ms`: sum `ar.durationMs` for rows where non-null; return `null` if none.
    5. Return `MultiRunRecord`-shaped DTO.

  - `getEstimates(workspaceId: string, prId: string)`:
    1. Fetch all agents: `const agents = await container.agentsRepo.listEnabled(workspaceId)` (all enabled agents in the workspace — per spec, the picker shows all available agents).
    2. Fetch historical runs: `const rows = await this.repo.getLastNRunsPerAgent(db, workspaceId, agents.map(a => a.id))`.
    3. Group rows by `agentId` in JS using a `Map`; for each agent, slice to the first 10 rows (already ordered DESC), then compute `avg(costUsd)` and `avg(durationMs)`.
    4. Fetch last summaries: `const summaries = await this.repo.getLastFindingSummaryPerAgent(db, workspaceId, agents.map(a => a.id))`.
    5. For each agent: `has_historical_data = rows.length > 0`; if `has_historical_data`, compute averages; else `estimated_duration_ms = null, estimated_cost_usd = null`.
    6. Return `AgentEstimate[]`.

  - `getFindings(workspaceId: string, multiRunId: string)`:
    1. Verify multi-run exists (workspace-scoped): `await this.repo.findMultiRunById(db, workspaceId, multiRunId)` — throw `NotFoundError` if absent.
    2. Get agent runs: `const agentRuns = await this.repo.getAgentRunsByMultiRunId(db, multiRunId)`.
    3. Get findings: `const rows = await this.repo.getReviewsAndFindingsByAgentRunIds(db, agentRuns.map(r => r.id))`.
    4. Build `allAgentFindings` flat list: `{ agentId, agentName, finding: FindingRecord }[]` from the rows.
    5. Build `allAgents`: unique `{ agentId, agentName }` entries from `agentRuns`.
    6. Call `groupFindingsByFileAndOverlap(allAgentFindings, allAgents)`.
    7. Return `MultiRunFindings`-shaped DTO: `{ agents: [per-agent findings], groups: [...] }`.

#### 1.9 Multi-runs routes

- [ ] Create `server/src/modules/multi-runs/routes.ts` — Fastify plugin with `ZodTypeProvider`:

  ```typescript
  export default async function multiRunsRoutes(appBase: FastifyInstance) {
    const app = appBase.withTypeProvider<ZodTypeProvider>();
    const { container } = app;
    const service = new MultiRunsService(container);

    // POST /pulls/:id/multi-review
    app.post('/pulls/:id/multi-review',
      { schema: { params: IdParams, body: MultiReviewRequest },
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
      async (req) => {
        const { workspaceId } = await getContext(container, req);
        return service.createMultiRun(workspaceId, req.params.id, req.body.agentIds, req.log);
      });

    // GET /multi-runs/:id
    app.get('/multi-runs/:id', { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getMultiRun(workspaceId, req.params.id);
    });

    // GET /pulls/:id/agents/estimates
    app.get('/pulls/:id/agents/estimates', { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getEstimates(workspaceId, req.params.id);
    });

    // GET /multi-runs/:id/findings
    app.get('/multi-runs/:id/findings', { schema: { params: IdParams } }, async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getFindings(workspaceId, req.params.id);
    });
  }
  ```

  All handlers: call `getContext` before any DB access (workspace-scope enforcement). `POST` validates body via Zod schema — invalid UUIDs or empty `agentIds` reject 422 before the handler runs.

#### 1.10 Module registration

- [ ] `server/src/modules/index.ts` — add `import multiRuns from './multi-runs/routes.js';` and add `multiRuns` to the `modules` object. (No `app.ts` change needed — `app.ts` iterates `Object.values(modules)` and registers each; routes declare their own paths.)

#### 1.11 Server unit tests

- [ ] `server/src/modules/multi-runs/helpers.test.ts` — unit tests for `groupFindingsByFileAndOverlap`:
  - Two findings, same file, overlapping ranges (A: lines 10–20, B: lines 15–25) → 1 group, start=10, end=25.
  - Two findings, same file, non-overlapping ranges (A: lines 10–20, B: lines 30–40) → 2 groups.
  - Two findings, different files, same range → 2 groups.
  - Agent A flags `foo.ts` lines 10–20; agent B has no findings → 1 group with B's `finding = null` (AC-12 "did not flag").
  - Same file + same range but different substance (e.g., security vs style) → 1 group with both findings (AC-12 edge case 5: no substance filter).

---

### Phase 2: Run executor concurrency change

**This phase runs in parallel with Phase 1. No dependency on Phase 1.** Touches only `server/src/modules/reviews/run-executor.ts`.

#### 2.1 Replace sequential loop with `Promise.allSettled`

- [ ] `server/src/modules/reviews/run-executor.ts` — in `executeRuns`, replace the sequential `for (const { agent, runId } of jobs)` loop body with:

  ```typescript
  await Promise.allSettled(
    jobs.map(async ({ agent, runId }) => {
      const agentStart = Date.now();
      logger?.info(
        { runId, agent: agent.name, provider: agent.provider, model: agent.model, prId: pull.id },
        `review: agent "${agent.name}" started (${agent.provider}/${agent.model})`,
      );
      const outcome = await this.runOneAgent(
        workspaceId, pull, repo, diff, planContent, agent, runId, runLog,
      );
      logger?.info(
        { runId, agent: agent.name, findings: outcome.findings.length, grounding: outcome.grounding, durationMs: Date.now() - agentStart },
        `review: agent "${agent.name}" done — ${outcome.findings.length} finding(s)`,
      );
    }),
  );
  ```

  Remove the `try/catch` block that was inside the for-loop — `runOneAgent`'s own catch already handles agent failures (persists `status='failed'`, saves trace, completes the bus, and rethrows). With `Promise.allSettled`, the rejection is captured in the settled result and the other agents continue unaffected (AC-6 isolated failure domain preserved).

  Note on safety: `runLog` fans out to all `runIds` during shared pre-work. Each agent's `parentLog.forRun(runId)` call inside `runOneAgent` narrows writes to that agent's channel. Concurrent writes to separate channels on `RunBus` are safe (in-memory Map keyed by runId).

#### 2.2 Regression verification

- [ ] Run `cd server && pnpm test` — confirm all existing review-related tests pass. The change is behavioral (parallel vs sequential) not structural; the test suite's mocked `runOneAgent` path should be unaffected.

---

### Phase 3: Client API infrastructure + PR-page agent picker

**Requires Phase 1 complete** (new server endpoints must be reachable). Runs in parallel with Phase 4. Phase 5 depends on this phase's `lib/hooks/multi-runs.ts` and `lib/api.ts` additions — **Phase 3 must commit those files before Phase 5 begins**.

#### 3.1 New API functions

- [ ] `client/src/lib/api.ts` — add the following exported async functions (import types from `@devdigest/shared` — the new contracts from Phase 1):

  ```typescript
  export async function fetchAgentEstimates(prId: string): Promise<AgentEstimate[]> {
    return apiFetch<AgentEstimate[]>(`/pulls/${prId}/agents/estimates`);
  }

  export async function triggerMultiReview(
    prId: string,
    agentIds: string[],
  ): Promise<{ multi_run_id: string; runs: { run_id: string; agent_id: string; agent_name: string }[] }> {
    return apiFetch(`/pulls/${prId}/multi-review`, {
      method: 'POST',
      body: JSON.stringify({ agentIds }),
    });
  }

  export async function fetchMultiRun(multiRunId: string): Promise<MultiRunRecord> {
    return apiFetch<MultiRunRecord>(`/multi-runs/${multiRunId}`);
  }

  export async function fetchMultiRunFindings(multiRunId: string): Promise<MultiRunFindings> {
    return apiFetch<MultiRunFindings>(`/multi-runs/${multiRunId}/findings`);
  }
  ```

#### 3.2 New TanStack Query hooks

- [ ] Create `client/src/lib/hooks/multi-runs.ts` — new file (do not add to `reviews.ts`; separate domain file per ui-architecture hook convention):

  ```typescript
  export function useAgentEstimates(prId: string | null) {
    return useQuery({
      queryKey: ['agent-estimates', prId],
      queryFn: () => fetchAgentEstimates(prId!),
      enabled: !!prId,
    });
  }

  export function useRunMultiReview() {
    return useMutation({
      mutationFn: ({ prId, agentIds }: { prId: string; agentIds: string[] }) =>
        triggerMultiReview(prId, agentIds),
    });
  }

  export function useMultiRun(multiRunId: string | null) {
    return useQuery({
      queryKey: ['multi-run', multiRunId],
      queryFn: () => fetchMultiRun(multiRunId!),
      enabled: !!multiRunId,
    });
  }

  export function useMultiRunFindings(multiRunId: string | null) {
    return useQuery({
      queryKey: ['multi-run-findings', multiRunId],
      queryFn: () => fetchMultiRunFindings(multiRunId!),
      enabled: !!multiRunId,
    });
  }
  ```

#### 3.3 Extended RunReviewDropdown

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.tsx` — extend to multi-select picker mode. Key changes (preserve existing single-agent items):

  - Add local state: `selectedAgentIds: Set<string>` (empty by default; reset on dropdown close).
  - Add local state: `open: boolean` (track dropdown open state for lazy estimate fetch).
  - Call `useAgentEstimates(open ? prId : null)` — lazy-fetch-on-open per INSIGHTS pattern; returns `AgentEstimate[]` or `undefined` while loading.
  - Call `useRunMultiReview()` for the multi-agent action mutation.
  - In the items list, before the existing "Run all" item and agent items, insert a **multi-select section**:
    - One checkbox row per agent: agent name + estimate label. Label format: `"≈ Xs · $X.XX"` when `has_historical_data` is true; `"no history yet"` when false. Clicking a row toggles the agent in `selectedAgentIds`.
    - A divider.
    - A `"Run multi-agent review ({N} selected)"` primary action button; disabled when `selectedAgentIds.size === 0`; `aria-disabled` when disabled.
  - On primary action click:
    1. Call `runMultiReview.mutateAsync({ prId, agentIds: [...selectedAgentIds] })`.
    2. On success: `onRunsStarted?.(res.runs.map(r => r.run_id))` then `router.push(`/multi-runs/${res.multi_run_id}`)`.
    3. `onRunSettled?.()` in the finally block.
  - Keep existing `"Run all enabled agents"` and per-agent single-run items unchanged (they still call `POST /pulls/:id/review`).
  - Change `"Configure agents..."` link target from `/agents` to `/multi-runs/configure?prId=${prId}`.
  - Merged-PR warning: rendered as before — muted, non-blocking.
  - Accessibility: checkbox rows use `role="checkbox"` + `aria-checked`; the primary action uses `aria-disabled` when disabled.

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/constants.ts` — add `ESTIMATE_COLUMN_WIDTH` or any needed layout constant for the new estimate label column.

- [ ] `client/messages/en/prReview.json` — add keys under `"runReview"`:
  - `"runMultiAgentReview"`: `"Run multi-agent review ({count} selected)"`
  - `"noHistoryYet"`: `"no history yet"`
  - `"estimateLabel"`: `"≈ {duration}s · ${cost}"`

#### 3.4 PR picker tests

- [ ] `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/RunReviewDropdown.test.tsx` — add/update tests:
  - Mock `useAgentEstimates` returning 2 agents with `has_historical_data: true`; open dropdown; verify estimate labels render.
  - One agent with `has_historical_data: false`; verify `"no history yet"` text.
  - Primary action is disabled at 0 checkboxes selected; enabled after checking 1 agent.
  - Check 1 agent → click primary action → verify `triggerMultiReview` called with correct `prId` and `agentIds`.
  - `"Configure agents..."` link href includes `/multi-runs/configure?prId=`.

---

### Phase 4: Multi-Agent Review results page

**Requires Phase 1 complete.** Runs in parallel with Phase 3. Imports from `lib/hooks/multi-runs.ts` and `lib/api.ts` — if running simultaneously with Phase 3, coordinate so Phase 3 commits those files first (or Phase 4 implementer stubs them locally and rebases). The `RunTraceDrawer` is moved to shared `components/` in this phase; the Phase 3 implementer should NOT modify `RunTraceDrawer`.

#### 4.0 Promote RunTraceDrawer to shared components

- [ ] Move `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/` → `client/src/components/RunTraceDrawer/` (entire folder including sub-components `TraceBody/`, `PromptBlock/`, `constants.ts`, `helpers.ts`, `styles.ts`).
- [ ] Update the import in the PR detail page (`client/src/app/repos/[repoId]/pulls/[number]/page.tsx` or wherever `RunTraceDrawer` is currently imported) to point to the new shared path.
- [ ] Verify the existing PR detail page tests still pass after the move.

#### 4.1 Results page route

- [ ] Create `client/src/app/multi-runs/[multiRunId]/page.tsx` — thin page component. Awaits async `params` (Next.js 15 convention: `const { multiRunId } = await params`). Renders `<MultiRunResultsView multiRunId={multiRunId} />`.

#### 4.2 MultiRunResultsView component

- [ ] Create `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/MultiRunResultsView.tsx`:
  - Calls `useMultiRun(multiRunId)` and `useMultiRunFindings(multiRunId)`.
  - Calls `useRunEvents(activeRunIds)` from `lib/hooks/reviews.ts` where `activeRunIds = multiRun?.agents.filter(a => a.status === 'running').map(a => a.run_id) ?? []`. When all SSE streams close (all agents done or failed), invalidate the `useMultiRun` query so the summary line updates.
  - Local state: `viewMode: 'columns' | 'tabs'` (default `'columns'`), `showOnlyConflicts: boolean` (default `false`), `openTraceRunId: string | null` (default `null`), `openTraceAgentName: string | null` (default `null`).
  - Renders: `<MultiRunHeader>`, mode toggle, conditional `<ColumnsView>` or `<TabsView>`, `<ConflictsSection>`, and (when `openTraceRunId != null`) `<RunTraceDrawer>` from `client/src/components/RunTraceDrawer/`.
  - Loading state: show a skeleton or spinner while `isLoading` on `useMultiRun`.
  - Error state (network failure): render an error message with a retry action; do NOT use an error boundary that hides the header.
  - All user-visible strings via `useTranslations('multiRuns')`.

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/index.ts` — barrel re-export.
- [ ] `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/styles.ts` — Tailwind class strings via `cn()`.

#### 4.3 MultiRunHeader sub-component

- [ ] Create `client/src/app/multi-runs/[multiRunId]/_components/MultiRunHeader/MultiRunHeader.tsx`:
  - Props: `{ prId: string; prNumber: number | null; agentCount: number; allComplete: boolean; totalDurationMs: number | null; totalCostUsd: number | null; viewMode: 'columns' | 'tabs'; onViewModeChange: (mode: 'columns' | 'tabs') => void }`
  - Breadcrumb: `"Multi-Agent Review > #<prNumber>"` (or `"Multi-Agent Review"` if `prNumber` is null).
  - `"Configure run"` link: `<Link href={`/multi-runs/configure?prId=${prId}`}>Configure run</Link>`.
  - Columns/Tabs toggle: two-button segmented control. Each button's `aria-pressed` reflects whether it is the active mode.
  - Summary line (AC-16): when `allComplete`, `"N agents · parallel · Xs total · $X.XX"`; when in progress, `"N agents · parallel · running..."`.

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/MultiRunHeader/index.ts` — barrel.

#### 4.4 ColumnsView sub-component

- [ ] Create `client/src/app/multi-runs/[multiRunId]/_components/ColumnsView/ColumnsView.tsx`:
  - Props: `{ agents: AgentRunSummary[]; agentFindings: MultiRunFindings['agents']; sseStatuses: Record<string, string>; onViewTrace: (runId: string, agentName: string | null) => void }`
  - One column per agent in a horizontal-scrollable layout.
  - Column header: agent name + status text. Status = live from `sseStatuses[run_id]` if running, else `agent.status`. Must be visible text (not icon-only) per AC accessibility requirement.
  - While running: spinner element with accessible text label `"Running"`.
  - When complete: agent score (numeric), verdict string, finding count.
  - Findings list: compact titles (not full FindingCard — just file + title, ellipsized if long).
  - Footer: `"View trace"` link/button; calls `onViewTrace(run_id, agent_name)`.

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/ColumnsView/index.ts` — barrel.

#### 4.5 TabsView sub-component

- [ ] Create `client/src/app/multi-runs/[multiRunId]/_components/TabsView/TabsView.tsx`:
  - Props: `{ agents: AgentRunSummary[]; agentFindings: MultiRunFindings['agents']; sseStatuses: Record<string, string>; onViewTrace: (runId: string, agentName: string | null) => void }`
  - Tab bar: one tab per agent; tab label = agent name + accessible status text.
  - Active tab content:
    - Summary card: score, one-line `summary`, verdict, `"View trace"` link with run time (`durationMs`) and cost (`costUsd`).
    - `FindingCard` list: import `FindingCard` from `client/src/components/RunTraceDrawer/../FindingCard/` — check that `FindingCard` can be used outside the PR detail page context. If `FindingCard` reads from a page-specific React context (e.g., a `prId` or `workspaceId` context), extract or wrap it before use. The implementer must verify `FindingCard`'s internal imports before assuming composability.

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/TabsView/index.ts` — barrel.

#### 4.6 ConflictsSection sub-component

- [ ] Create `client/src/app/multi-runs/[multiRunId]/_components/ConflictsSection/ConflictsSection.tsx`:
  - Props: `{ groups: FindingGroup[]; showOnlyConflicts: boolean; onToggle: () => void; allAgentCount: number }`
  - Toggle: a standard accessible toggle (`<button role="switch" aria-checked={showOnlyConflicts}>`); visible label; description of current state.
  - Filtered groups: when `showOnlyConflicts = true`, show only groups where `agent_verdicts` contains ≥ 2 distinct verdict values (counting `finding === null` as the string `"did_not_flag"`, any non-null finding as its `severity` string). This is a client-side filter — no extra API call.
  - Per group row: file path + `"lines N–M"` header. For each agent in `agent_verdicts`: show finding severity + title if finding is non-null; show `"did not flag"` (i18n key: `results.conflicts.didNotFlag`) if null.
  - When `groups.length === 0` and `allAgentCount < 2`: render a note `"Where agents disagree requires at least two agents with results"`.

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/ConflictsSection/index.ts` — barrel.

#### 4.7 i18n strings for results page

- [ ] Create `client/messages/en/multiRuns.json` with keys (Phase 5 will extend this file):

  ```json
  {
    "results": {
      "title": "Multi-Agent Review",
      "breadcrumb": "Multi-Agent Review > #{number}",
      "configureRun": "Configure run",
      "columnsMode": "Columns",
      "tabsMode": "Tabs",
      "summaryRunning": "{count} agents · parallel · running...",
      "summaryComplete": "{count} agents · parallel · {duration}s · ${cost}",
      "viewTrace": "View trace",
      "agent": {
        "running": "Running",
        "done": "Done",
        "failed": "Failed"
      },
      "conflicts": {
        "title": "Where agents disagree",
        "showOnlyConflicts": "Show only conflicts",
        "didNotFlag": "did not flag",
        "requiresMultipleAgents": "Where agents disagree requires at least two agents with results"
      }
    }
  }
  ```

#### 4.8 Results page tests

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/MultiRunResultsView.test.tsx`:
  - Mock `useMultiRun` (2 complete agents), `useMultiRunFindings` (1 shared finding group). Verify Columns mode renders 2 columns.
  - Toggle to Tabs mode; verify tab count = 2.
  - Click `"View trace"` for agent A; verify `RunTraceDrawer` receives the correct `runId`.
  - Click `"View trace"` for agent B; verify drawer `runId` changes.
  - Render with `groups` where all agents agree; activate `showOnlyConflicts`; verify the group is hidden.
  - Render with one agent `status = 'running'`; verify accessible label includes `"Running"` text.
  - All-agents-failed state: 2 failed columns, no error boundary, no findings.

---

### Phase 5: Configure Run page

**Requires Phase 1 complete** (server estimates endpoint). **Requires Phase 3 complete** (provides `useAgentEstimates`, `useRunMultiReview` hooks and API functions). Phase 5 CANNOT start until Phase 3 has committed `lib/hooks/multi-runs.ts` and the `lib/api.ts` additions.

#### 5.1 Configure Run page route

- [ ] Create `client/src/app/multi-runs/configure/page.tsx` — thin page. Reads optional `searchParams.prId` (pre-selected PR from the picker's "Configure agents..." link). Awaits `searchParams` (Next.js 15 async API). Renders `<ConfigureRunView initialPrId={prId} />`.

#### 5.2 ConfigureRunView component

- [ ] Create `client/src/app/multi-runs/configure/_components/ConfigureRunView/ConfigureRunView.tsx`:
  - Props: `{ initialPrId?: string }`
  - State: `selectedPrId: string | null` (initialized from `initialPrId`), `selectedAgentIds: Set<string>`.
  - **Step 1 — PR selection**: Use an existing TanStack Query hook (e.g., `usePulls` if it exists, or equivalent) to list PRs for the current workspace. Render a dropdown or searchable list. Pre-select `initialPrId` if provided. On selection, update `selectedPrId` and reset `selectedAgentIds`.
  - **Step 2 — Agent cards** (rendered once `selectedPrId` is set): Call `useAgentEstimates(selectedPrId)` (lazy per INSIGHTS: `open ? prId : null` pattern — here: `selectedPrId ?? null`).
    - Per agent card: agent name (heading); `last_finding_summary` as escaped plain text (do NOT use `dangerouslySetInnerHTML`); time estimate `"≈ Xs"` or `"no history yet"` per AC-3; cost estimate `"$X.XX"` or `"no history yet"` per AC-3; a checkbox for selection.
    - "Select all" control: a single checkbox or button that checks/unchecks all agents. When all are checked and one is unchecked, "Select all" should reflect the intermediate state.
  - **Footer aggregate estimate** (AC-4): derived from `selectedAgentIds` and `useAgentEstimates` data using `computeAggregateDuration` and `computeAggregateCost` helpers (pure functions in `helpers.ts`):
    - Duration: `max` of selected agents' `estimated_duration_ms` (parallel execution assumption).
    - Cost: `sum` of selected agents' `estimated_cost_usd`.
    - Render: `"≈ Xs · $X.XX · parallel fan-out"`. When any selected agent has `null` estimates, show `"≈ varies · $X.XX · parallel fan-out"` (use available data; omit null components).
    - Updates live as checkboxes change (no debounce needed — all data is already in React state).
  - **Submit button**: label `"Run multi-agent review (N)"` where N = `selectedAgentIds.size`. Disabled when `selectedPrId === null` or `selectedAgentIds.size === 0`. On click:
    1. Call `useRunMultiReview().mutateAsync({ prId: selectedPrId, agentIds: [...selectedAgentIds] })`.
    2. On success: `router.push(`/multi-runs/${res.multi_run_id}`)`.
  - **Merged-PR note**: if the selected PR's `state` is `"closed"` or `"merged"`, show the same muted warning used in `RunReviewDropdown` — do not block submission.
  - All user-visible strings via `useTranslations('multiRuns')` using the `"configure"` key namespace.

- [ ] `client/src/app/multi-runs/configure/_components/ConfigureRunView/index.ts` — barrel.
- [ ] `client/src/app/multi-runs/configure/_components/ConfigureRunView/helpers.ts` — pure functions:
  ```typescript
  export function computeAggregateDuration(
    estimates: AgentEstimate[],
    selectedIds: string[],
  ): number | null
  // Returns max(estimated_duration_ms) for selected agents that have non-null duration.
  // Returns null when all selected agents have null duration or selectedIds is empty.

  export function computeAggregateCost(
    estimates: AgentEstimate[],
    selectedIds: string[],
  ): number | null
  // Returns sum(estimated_cost_usd) for selected agents that have non-null cost.
  // Returns null when all selected agents have null cost or selectedIds is empty.
  ```

#### 5.3 Configure Run i18n strings

- [ ] `client/messages/en/multiRuns.json` — extend (add to the file created in Phase 4):
  ```json
  {
    "configure": {
      "title": "Configure run",
      "selectPr": "Select PR",
      "selectAgents": "Select agents",
      "selectAll": "Select all",
      "estimateParallel": "≈ {duration}s · ${cost} · parallel fan-out",
      "estimateVaries": "≈ varies · parallel fan-out",
      "noHistory": "no history yet",
      "run": "Run multi-agent review ({count})",
      "disabledNoAgents": "Select at least one agent",
      "disabledNoPr": "Select a PR first"
    }
  }
  ```

#### 5.4 Configure Run tests

- [ ] `client/src/app/multi-runs/configure/_components/ConfigureRunView/ConfigureRunView.test.tsx`:
  - Render with `initialPrId` pre-set; verify Step 2 agent cards appear (mock `useAgentEstimates` returns 2 agents with `has_historical_data: true`).
  - One agent with `has_historical_data: false`; verify `"no history yet"` for both duration and cost.
  - Check 2 agents with `estimated_duration_ms: [3000, 5000]`; verify footer shows `"≈ 5s"` (max = 5000 ms = 5s).
  - Check 2 agents with `estimated_cost_usd: [0.01, 0.02]`; verify footer shows `"$0.03"` (sum).
  - "Select all" selects all agents; verify `selectedAgentIds` length equals agents count.
  - Submit disabled when no PR selected; disabled when no agents selected; enabled when both set.
  - On submit: mock `triggerMultiReview`; verify called with correct `prId` and `agentIds`; verify `router.push` called with `/multi-runs/<multiRunId>`.
  - `last_finding_summary` is rendered as plain text (textContent); no `dangerouslySetInnerHTML`.

- [ ] `client/src/app/multi-runs/configure/_components/ConfigureRunView/helpers.test.ts`:
  - `computeAggregateDuration`: max of selected durations; null when all null; correct subset when only some selected.
  - `computeAggregateCost`: sum of selected costs; null when all null.

---

## Gotchas

- **Migrations never auto-run.** After editing `server/src/db/schema/runs.ts`, run `cd server && pnpm db:generate` and commit the generated file. Then run `cd server && pnpm db:migrate`. Skipping either step produces silent "column does not exist" errors at runtime.
- **`server/src/db/schema/` is not the SQL file.** Edit the TypeScript schema file; let `pnpm db:generate` produce the SQL. Never hand-edit `server/src/db/migrations/`.
- **Backward-compatible contracts only.** The new Zod entries in `observability.ts` are purely additive. Do NOT rename, remove, or change the type of any field in the existing `MultiAgentRun`, `AgentColumn`, `Conflict`, `ConflictTake`, `AgentStats`, `StatPoint`, `CuratorResult`, or `CuratorMerge` exports.
- **Both vendor copies must change in lockstep.** `server/src/vendor/shared/contracts/observability.ts` and `client/src/vendor/shared/contracts/observability.ts` must be updated in the same commit (or at least before `pnpm tsc --noEmit` is run on either package). No tooling enforces this.
- **Test fixture updates.** Any test that constructs an object of a contract type that gains a required (non-.nullish) field will emit TS2741. Update every hardcoded factory object in `*.test.tsx` files that uses `AgentRunSummary`, `MultiRunRecord`, etc.
- **`RunTraceDrawer` is moved in Phase 4.** Phase 3 implementer must NOT touch `RunTraceDrawer`. Phase 4 moves it from the PR-detail `_components/` to `client/src/components/RunTraceDrawer/` and updates the PR-detail page's import. Once moved, Phase 5 (Configure Run page) should not import it — that page doesn't need a trace drawer.
- **`FindingCard` coupling.** Before Phase 4 reuses `FindingCard` in the Tabs view, verify its source imports. If it reads from a page-level React context (e.g., a `prId` context), it cannot be composed directly from the results page; it must be extracted to `client/src/components/FindingCard/` with explicit props. This is an implementer verification step, not assumed.
- **Agent deleted mid-run** (edge case 4). `agent_runs.agent_id` has `onDelete: 'set null'`. If an agent is deleted while a run is in progress, `agent_id` becomes null. The results page falls back to `agent_name` from `AgentRunSummary` (the server populates it from the join at read time). For runs in progress when the join returns null, fall back to `"Unknown agent"` (or use the trace's `config.agent` once the trace is available via `RunTraceDrawer`).
- **`ci/` and `agent-runner/` are off-limits.** No tasks in this plan touch those directories. GitHub Actions deployment of agents is a separate initiative.
- **Security — LLM-generated content.** `FindingCard` fields (`title`, `rationale`, `suggestion`) and `last_finding_summary` are LLM-generated text. Render as escaped markdown (existing FindingCard behavior) or escaped plain text. Never inject into prompts. Never use `dangerouslySetInnerHTML`. The `agentIds[]` from the multi-review request body are UUID-validated by the Zod `.uuid()` refinement at the route boundary; the workspace membership check happens in the service before any DB write — both layers are required (defense-in-depth per security skill A01).
- **All user-visible strings via i18n.** No hardcoded string literals in JSX. Every label, button text, and status string must be in `messages/en/*.json` and consumed via `useTranslations`.
- **`Promise.allSettled` and the RunBus.** The parallel executor change (Phase 2) makes concurrent writes to the RunBus. Each agent writes to its own channel (keyed by `runId`). The shared pre-work log (emitted before `Promise.allSettled`) is buffered for all `runIds` and appears in every agent's trace — this is the intended behavior.

---

## Definition of done

- [ ] `cd server && pnpm test` passes (all existing + new unit/integration tests green)
- [ ] `cd server && pnpm tsc --noEmit` reports zero errors
- [ ] `cd client && pnpm test` passes (all existing + new component tests green)
- [ ] `cd client && pnpm tsc --noEmit` reports zero errors
- [ ] AC-1: PR page Run Review dropdown shows per-agent checkboxes with time-estimate labels; primary action button shows "Run multi-agent review (N selected)" and is disabled when N = 0; "Configure agents..." navigates to `/multi-runs/configure`.
- [ ] AC-2, AC-3: Configure Run page shows PR selection step then agent cards with name, last-finding summary, and time/cost estimate; an agent with zero completed runs shows `"no history yet"` (not a number).
- [ ] AC-4: Configure Run footer shows aggregate estimate assuming parallel execution (max duration, sum cost, "parallel fan-out" label) and updates live as checkboxes change.
- [ ] AC-5: DB query after triggering a multi-agent review confirms one `multi_agent_runs` row and N `agent_runs` rows with `multi_agent_run_id` set to that row's `id`; a single-agent run via the existing path has `multi_agent_run_id = null`.
- [ ] AC-6: One agent configured to fail; the other completes successfully; `GET /multi-runs/:id` returns both statuses; the results page shows one failed indicator and one completed indicator without an error boundary.
- [ ] AC-7: Live per-agent status indicators update independently (running → done/failed) on the results page via SSE without a page reload.
- [ ] AC-8, AC-9: Columns and Tabs modes each display the correct findings per agent; toggling modes switches view without a refetch.
- [ ] AC-10: "View trace" opens the shared `RunTraceDrawer` for the correct `runId`; clicking "View trace" for a different agent changes the drawer to that agent's `runId`.
- [ ] AC-11: FindingCards in Tabs mode show Accept, Dismiss, and "Turn into eval case" buttons with SPEC-02 semantics.
- [ ] AC-12: Same file + overlapping line range → 1 group; different files + same range → 2 groups; one agent flags a location the other does not → the non-flagging agent shows "did not flag" in the group row.
- [ ] AC-13: "Show only conflicts" toggle hides groups where all agents have the same verdict; deactivating the toggle restores all groups.
- [ ] AC-14: After a multi-agent review, each participating `agent_runs` row has a non-null `agent_id` matching the selected agent.
- [ ] AC-15: `GET /multi-runs/:id` returns `id, pr_id, ran_at, agents[](run_id, agent_id, agent_name, status, score, finding_count, cost_usd, duration_ms, error), total_cost_usd, total_duration_ms`.
- [ ] AC-16: Results page header shows the PR breadcrumb, "Configure run" link, Columns/Tabs toggle, and a summary line with agent count, "parallel" label, total duration (when complete), and total cost.
