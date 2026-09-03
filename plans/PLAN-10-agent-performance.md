# Plan: Agent Performance — Per-agent Stats Tab + Global Dashboard

## Spec reference
`specs/SPEC-10-agent-performance.md` — Status: approved, 23 EARS ACs, all clarifications resolved.

## Execution mode: multi-agent
Three phases: **Phase 1** (contracts + server + client hooks/API) is the sequential prerequisite. **Phase 2** (Stats Tab) and **Phase 3** (Global Dashboard) are fully independent client phases that can run in parallel once Phase 1 outputs are merged. File boundaries are non-overlapping: Phase 2 writes only into `agents/[id]/_components/AgentEditor/` and Phase 3 writes only into `app/agent-performance/`.

## Goal
Add two read-only performance surfaces over already-persisted `agent_runs` + `reviews`/`findings` data — zero LLM calls: (A) a Stats tab in the agent editor backed by `GET /agents/:id/stats`, and (B) a global `/agent-performance` dashboard backed by `GET /agent-performance`. Both endpoints share one repository aggregation so values agree by construction (AC-13). Period: 30d default / 7d / 1d presets + custom UTC from–to via query params (AC-3, AC-4, AC-22).

## Modules affected
- `server/` — new `agent-performance` module (routes → service → repository); `agents/routes.ts` gains one handler for `GET /agents/:id/stats`; `vendor/shared/contracts/observability.ts` gains `AgentPerformance` contract; `_shared/schemas.ts` gains `PeriodParams` shared schema.
- `client/` — new `StatsTab` in the `AgentEditor`; new `/agent-performance` page; `lib/api.ts` and `lib/hooks/performance.ts`; mirrored `vendor/shared` contract update.

No DB migrations — all required columns already exist (`agent_runs.costUsd`, `agent_runs.durationMs`, `agent_runs.findingsCount`, `agent_runs.model`, `reviews.agentId`, `reviews.createdAt`, `findings.severity`, `findings.acceptedAt`, `findings.dismissedAt`).

---

## Engineering Insights applied

- **Accept-rate semantics differ from skills/repository.ts precedent** — that precedent computes `accepted / all_findings` (including pending). SPEC-10 and the `AgentStats` contract comment both require `accepted / (accepted + dismissed)` with pending excluded; null when nothing acted. The shared aggregation MUST follow the contract, not the skills precedent. (`server/insights/INSIGHTS.md` 2026-07-17 entry; `observability.ts:102`).
- **`AgentStats`/`StatPoint` contracts are orphaned — no live route** — the contract exists in both vendor copies but no endpoint was ever wired. Do not assume a contract implies a live route (`server/insights/INSIGHTS.md` 2026-07-17).
- **`client/src/vendor/shared/` is a manual mirror** — always update both `server/src/vendor/shared/contracts/observability.ts` and `client/src/vendor/shared/contracts/observability.ts` in lockstep; no tooling enforces this (`client/insights/INSIGHTS.md` 2026-06-25).
- **Nav entry already pre-provisioned** — `client/src/vendor/ui/nav.ts:44` already has the `/agent-performance` entry; no nav change needed; `vendor/ui/` must not be modified (`client/insights/INSIGHTS.md` 2026-07-17).
- **`vendor/ui/` is truly frozen; `vendor/shared/` updates are legitimate** — the client INSIGHTS.md 2026-07-16 entry reconciles the apparent conflict: `vendor/shared/` mirrors are required updates, not violations.
- **Drizzle does not auto-index FK columns** — `agent_runs.workspaceId` (FK, non-indexed) and `agent_runs.ranAt` (no index) will be the hot filter columns. Use `FILTER (WHERE ...)` clauses inside aggregate functions for null-exclusion (avoids HAVING, which filters groups rather than inputs to aggregates).
- **`costUsd` numeric column returns as string from Drizzle** — `numeric(12,8)` in PostgreSQL → JavaScript string in node-postgres. The service layer must `parseFloat()` all cost values before arithmetic or Zod response validation.
- **Drizzle uses standalone `eq()` not column chaining** — use `eq(table.column, value)` from `drizzle-orm`, never `table.column.eq(value)` (TS2339). Directly from `server/insights/INSIGHTS.md` 2026-07-14.
- **Prototype-cast pattern for unit test mocks** — `ClassName.prototype as unknown as Record<string, Mock>` to avoid TS2352; all mocked call sites need `!` assertion under `noUncheckedIndexedAccess` (`server/insights/INSIGHTS.md` 2026-07-14).
- **Test fixtures must include all required fields** — extending `AgentStats` or adding `AgentPerformance` will break existing test fixtures with TS2741 if any required field is missing. Update every hardcoded fixture object that uses those types (`client/insights/INSIGHTS.md` 2026-07-06, `server/insights/INSIGHTS.md` 2026-06-25).
- **Colocated test files import i18n JSON by deep relative path** — not via `@/` alias; recount `../` hops when placing StatsTab test. ERR_MODULE_NOT_FOUND at Vitest runtime, not at tsc (`client/insights/INSIGHTS.md` 2026-07-16).
- **`onion-architecture` INSIGHT** — an agent module's service must NOT instantiate another module's repository. The `agents/routes.ts` handler for `GET /agents/:id/stats` may instantiate `AgentPerformanceService` directly (routes may call any service); only service→repo cross-module coupling is forbidden.

---

## Recommendations

- **Performance indexes (follow-up migration):** The aggregation filters on `agent_runs(workspaceId, ranAt)` and `reviews(workspaceId, createdAt)`. No composite index exists on either column pair today. At workspace scale ("dozens of agents, thousands of runs" per spec) PostgreSQL will use a seq scan on `agent_runs`. The spec's 1s/500ms targets are achievable in CI seeded data but may degrade under load. Recommended follow-up: add `index('agent_runs_workspace_ran_at_idx').on(t.workspaceId, t.ranAt)` and `index('reviews_workspace_created_at_idx').on(t.workspaceId, t.createdAt)` in a separate migration after the feature lands. Do not block this feature on those indexes — the spec explicitly forbids migrations in this iteration.
- **Numeric cost precision:** `costUsd` is `numeric(12,8)`; summing many small values server-side with JavaScript float arithmetic will introduce rounding. Consider accumulating sums as PostgreSQL `NUMERIC` (done inside the DB aggregate `SUM()`) and only `parseFloat()`-ing the final value. The Drizzle `SUM(...)` aggregate on a `numeric` column returns a string in pg-driver — parse at the repo→service boundary, never mid-query.

---

## Architecture decisions

- **Shared aggregation in a new `agent-performance` module, not in `agents/`** — the per-agent stats endpoint (`GET /agents/:id/stats`) uses the same aggregation filtered to one agent; the dashboard (`GET /agent-performance`) uses the full workspace aggregation. Placing both in `agents/` would bloat that module with dashboard logic. The `agent-performance` module owns `repository.ts` (the shared aggregation) and `service.ts`; `agents/routes.ts` instantiates `AgentPerformanceService` for the stats handler. Per onion-architecture: routes may call any service; only service→repository cross-module imports are forbidden. (Skill: `onion-architecture/SKILL.md` decision tree, import boundary rules.)
- **Period params schema in `modules/_shared/schemas.ts`** — the `PeriodParams` schema is consumed by two modules (`agents` and `agent-performance`). Per onion-architecture decision tree: "A Zod validator used by multiple modules → `modules/_shared/schemas.ts`." (Skill: `onion-architecture/SKILL.md`.)
- **`AgentPerformance` contract in `vendor/shared/contracts/observability.ts`** — this file already owns `AgentStats`, `StatPoint`, and the multi-agent contracts. Adding `AgentPerformance` here keeps all observability/analytics contracts together. Both server and client vendor copies updated in lockstep. Changes are strictly additive (new export); existing exports untouched. (CLAUDE.md do-not-touch rule + `client/insights/INSIGHTS.md` 2026-06-25.)
- **Trend sparkline value = `agent_runs.findingsCount`** — the stat point `value` is the `findingsCount` integer stored on the `agent_runs` row (AC-1, AC-10, stakeholder decision 2026-07-16). The repository queries individual run rows ordered by `ranAt` for the sparkline; no secondary findings query is needed for the trend.
- **"(Deleted agent)" bucket key = `null` in both the `agents[]` array and `cost_by_agent[]`** — runs with `agent_runs.agentId IS NULL` and findings with `reviews.agentId` not matching any active workspace agent are merged under `agent_id: null`, `agent_name: "(deleted agent)"`. The service identifies deleted-agent findings by LEFT JOINing `reviews.agentId → agents.id` and grouping rows where `agents.id IS NULL`. (AC-23; edge case 3.)
- **Period resolution is server-side, not client-side** — the service `resolvePeriod()` converts preset strings into concrete `{ from: Date, to: Date }` windows (including UTC day boundaries for custom, per AC-22). The response echoes the resolved `period: { preset, from, to }` so the client can display the exact window.
- **Previous period for deltas = equal-length window immediately preceding the current period** — `prev_from = from - periodLength`, `prev_to = from - 1ms`. For preset periods, `periodLength = now - resolvedFrom`. The repository accepts two date pairs; the service calls it twice (parallel) and diffs the results. (AC-7, AC-8.)
- **Client `performance.ts` hooks file owned by Phase 1** — both `useAgentStats` and `useAgentPerformance` live in `client/src/lib/hooks/performance.ts`. This file is created in Phase 1 so Phases 2 and 3 can import from it independently without a write collision.

---

## Tasks

---

### Phase 1: Contracts + Server + Client Shared (sequential prerequisite)

**Inputs:** nothing — this phase has no upstream dependencies.
**Outputs consumed by Phase 2:** `AgentStats` type, `PeriodParams` type, `useAgentStats()` hook, `fetchAgentStats()` in api.ts, `GET /agents/:id/stats` endpoint live.
**Outputs consumed by Phase 3:** `AgentPerformance` type, `useAgentPerformance()` hook, `fetchAgentPerformance()` in api.ts, `GET /agent-performance` endpoint live.

#### 1.1 Shared Zod Contracts — server vendor copy

- [ ] `server/src/vendor/shared/contracts/observability.ts` — add the following **after** the existing `AgentStats` block (line 120), keeping all existing exports untouched:

  ```typescript
  // ---------------------------------------------------------------------------
  // Agent Performance dashboard (GET /agent-performance)
  // ---------------------------------------------------------------------------

  export const AgentPerformancePeriod = z.object({
    preset: z.enum(['30d', '7d', '1d', 'custom']).nullable(),
    from: z.string(),   // ISO date string e.g. "2026-06-17T00:00:00.000Z"
    to: z.string(),     // ISO date string
  });
  export type AgentPerformancePeriod = z.infer<typeof AgentPerformancePeriod>;

  export const AgentPerformanceSummary = z.object({
    total_runs: z.number().int(),
    runs_trend: z.array(StatPoint),        // daily run counts over the period
    total_cost_usd: z.number().nullable(),
    previous_total_cost_usd: z.number().nullable(),  // null → show no delta (AC-8)
    avg_accept_rate: z.number().nullable(), // pooled: all accepted ÷ all acted; null if nothing acted (AC-6)
    most_active: z.object({
      agent_id: z.string(),
      agent_name: z.string(),
      runs: z.number().int(),
      accept_rate: z.number().nullable(),
    }).nullable(),
  });
  export type AgentPerformanceSummary = z.infer<typeof AgentPerformanceSummary>;

  export const AgentPerformanceRow = z.object({
    agent_id: z.string().nullable(),       // null for "(deleted agent)" bucket (AC-23)
    agent_name: z.string(),                // "(deleted agent)" for synthetic bucket
    runs: z.number().int(),
    avg_cost_usd: z.number().nullable(),
    avg_duration_ms: z.number().nullable(),
    accept_rate: z.number().nullable(),
    previous_accept_rate: z.number().nullable(),   // null → no trend arrow (AC-8)
    last_run_at: z.string().nullable(),    // ISO timestamp; UI renders relative time
    trend: z.array(StatPoint),             // findings per run, oldest→newest (AC-10)
  });
  export type AgentPerformanceRow = z.infer<typeof AgentPerformanceRow>;

  export const AgentCostBreakdown = z.object({
    agent_id: z.string().nullable(),       // null for "(deleted agent)" (AC-23)
    agent_name: z.string(),
    cost_usd: z.number(),
  });
  export type AgentCostBreakdown = z.infer<typeof AgentCostBreakdown>;

  export const ModelCostBreakdown = z.object({
    model: z.string(),                     // 'unknown' for null model rows (edge case 11)
    cost_usd: z.number(),
  });
  export type ModelCostBreakdown = z.infer<typeof ModelCostBreakdown>;

  export const AgentPerformance = z.object({
    period: AgentPerformancePeriod,
    summary: AgentPerformanceSummary,
    agents: z.array(AgentPerformanceRow),
    cost_by_agent: z.array(AgentCostBreakdown),
    cost_by_model: z.array(ModelCostBreakdown),
  });
  export type AgentPerformance = z.infer<typeof AgentPerformance>;
  ```

  The barrel `server/src/vendor/shared/index.ts` already exports `./contracts/observability.js` — no barrel change needed.

#### 1.2 Shared Zod Contracts — client vendor copy (mirror)

- [ ] `client/src/vendor/shared/contracts/observability.ts` — apply the **identical** additions as 1.1 (same lines, same types). This file is a manual mirror; tsc is the only enforcement. The client barrel `client/src/vendor/shared/index.ts` already exports the observability contracts — no barrel change needed. Verify the file is byte-for-byte identical to the server vendor copy for the new section.

#### 1.3 Period params schema — server shared

- [ ] `server/src/modules/_shared/schemas.ts` — add `PeriodParams` Zod schema after `IdParams`:

  ```typescript
  import { z } from 'zod';

  export const PeriodParams = z.object({
    period: z.enum(['30d', '7d', '1d', 'custom']).optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).refine(
    (p) => p.period !== 'custom' || (p.from !== undefined && p.to !== undefined),
    { message: 'from and to are required when period=custom' },
  ).refine(
    (p) => {
      if (p.period !== 'custom' || !p.from || !p.to) return true;
      return p.from <= p.to;  // lexicographic compare works for YYYY-MM-DD
    },
    { message: 'from must be <= to' },
  ).refine(
    (p) => {
      if (p.period !== 'custom' || !p.from || !p.to) return true;
      const from = new Date(p.from + 'T00:00:00.000Z');
      const to   = new Date(p.to   + 'T23:59:59.999Z');
      const maxMs = 366 * 24 * 60 * 60 * 1000;   // bounded max span: ~1 year
      return (to.getTime() - from.getTime()) <= maxMs;
    },
    { message: 'custom range must not exceed one year' },
  );
  export type PeriodParams = z.infer<typeof PeriodParams>;
  ```

  Validation error on invalid input (422 before any query, AC-5).

#### 1.4 Repository — agent-performance module

- [ ] `server/src/modules/agent-performance/repository.ts` — create `AgentPerformanceRepository` class receiving `db: Db`. Implement the following methods (all workspace-scoped, all Drizzle queries):

  **`aggregateRunsByAgent(workspaceId, from, to)`** — returns one row per `agentId` (including `null`). Use:
  - `.from(agentRuns).leftJoin(agents, and(eq(agentRuns.agentId, agents.id), eq(agents.workspaceId, workspaceId)))`
  - `.where(and(eq(agentRuns.workspaceId, workspaceId), gte(agentRuns.ranAt, from), lte(agentRuns.ranAt, to)))`
  - `.groupBy(agentRuns.agentId, agents.name)` (group by agentId + agent name to carry the name)
  - Select: `count()` as `runs`, `sql<string>\`SUM(${agentRuns.costUsd}) FILTER (WHERE ${agentRuns.costUsd} IS NOT NULL)\`` as `totalCostStr`, `sql<number>\`COUNT(*) FILTER (WHERE ${agentRuns.costUsd} IS NOT NULL)\`` as `countCost`, `sql<number>\`SUM(${agentRuns.durationMs}) FILTER (WHERE ${agentRuns.durationMs} IS NOT NULL)\`` as `sumDuration`, `sql<number>\`COUNT(*) FILTER (WHERE ${agentRuns.durationMs} IS NOT NULL)\`` as `countDuration`, `sql<string>\`MAX(${agentRuns.ranAt})\`` as `lastRunAt`, `agents.name` as `agentName`
  - Note: `agents.name` will be `null` when `agentId IS NULL` (no agent) or when agent was deleted (LEFT JOIN returns null). Both map to "(deleted agent)".

  **`aggregateFindingsByAgent(workspaceId, from, to)`** — returns one row per `(agentId, severity)`:
  - `.from(reviews).innerJoin(findings, eq(findings.reviewId, reviews.id))`
  - `.leftJoin(agents, and(eq(reviews.agentId, agents.id), eq(agents.workspaceId, workspaceId)))`
  - `.where(and(eq(reviews.workspaceId, workspaceId), gte(reviews.createdAt, from), lte(reviews.createdAt, to), eq(reviews.kind, 'review')))`
  - `.groupBy(reviews.agentId, agents.id, agents.name, findings.severity)`
  - Select: `reviews.agentId`, `agents.id as agentExists` (null when deleted), `agents.name as agentName`, `findings.severity`, `count()` as `total`, `sql<number>\`COUNT(*) FILTER (WHERE ${findings.acceptedAt} IS NOT NULL)\`` as `accepted`, `sql<number>\`COUNT(*) FILTER (WHERE ${findings.dismissedAt} IS NOT NULL)\`` as `dismissed`
  - Both `reviews.agentId IS NULL` and `reviews.agentId IS NOT NULL AND agentExists IS NULL` → deleted-agent bucket.

  **`getRunTrend(workspaceId, agentId, from, to)`** — returns individual runs ordered by `ranAt` for the sparkline (one agent or all agents):
  - If `agentId` is provided: `where(and(eq(agentRuns.workspaceId, workspaceId), eq(agentRuns.agentId, agentId), gte(agentRuns.ranAt, from), lte(agentRuns.ranAt, to)))`
  - Select: `agentRuns.agentId`, `agentRuns.ranAt`, `agentRuns.findingsCount`
  - Order: `asc(agentRuns.ranAt)`
  - This is used for per-agent trend sparklines. The dashboard calls this for all agents in the period.

  **`getDailyRunsTrend(workspaceId, from, to)`** — groups all runs by day (for the summary card mini-trend):
  - `sql\`DATE_TRUNC('day', ${agentRuns.ranAt} AT TIME ZONE 'UTC')\`` as the grouping key, aliased as `day`
  - Select `day` (ISO date string) + `count()` as `runs`
  - Order: `asc(day)`
  - Maps to `runs_trend: StatPoint[]` where label = ISO date, value = run count.

  **`getModelCostBreakdown(workspaceId, from, to)`**:
  - `sql\`COALESCE(${agentRuns.model}, 'unknown')\`` as the group key
  - `SUM(costUsd) FILTER (WHERE costUsd IS NOT NULL)` as `totalCostStr`
  - Only include groups where `totalCostStr IS NOT NULL AND totalCostStr > 0`.

  **Important:** All date comparisons use `gte`/`lte` from `drizzle-orm` — never `sql.raw()` with user-provided date strings. Date values are bound as parameterized queries.

#### 1.5 Service — agent-performance module

- [ ] `server/src/modules/agent-performance/service.ts` — create `AgentPerformanceService` class receiving `container: Container`. Implement:

  **`resolvePeriod(params: PeriodParams): { from: Date; to: Date; preset: string | null }`**:
  - Default (no `period` or `period='30d'`): `from = now - 30d`, `to = now`, preset `'30d'`
  - `'7d'`: `from = now - 7d`, `to = now`
  - `'1d'`: `from = now - 24h`, `to = now`
  - `'custom'`: `from = new Date(params.from! + 'T00:00:00.000Z')`, `to = new Date(params.to! + 'T23:59:59.999Z')` (UTC day boundaries, AC-22)

  **`previousPeriod(current: { from: Date; to: Date })`**:
  - `length = current.to.getTime() - current.from.getTime()`
  - `prev_from = new Date(current.from.getTime() - length)`
  - `prev_to = new Date(current.from.getTime() - 1)`

  **`mergeAgentData(runsRows, findingsRows, trendsRows, agentNames)`** — pure function that:
  1. Groups findings rows by effective `agentId` (treating `null agentId` OR `null agentExists` as the `null` key)
  2. Merges with runs rows on `agentId`
  3. Computes per-agent:
     - `avg_cost_usd = parseFloat(totalCostStr) / countCost` (null if `countCost === 0`)
     - `avg_duration_ms = sumDuration / countDuration` (null if `countDuration === 0`)
     - `accept_rate = accepted / (accepted + dismissed)` (null if `accepted + dismissed === 0`, AC-14)
     - `dismiss_rate` analogously
     - `avg_findings_per_run = findingsTotal / runs` (null if `runs === 0`)
  4. Agent name: `agents.name` from the LEFT JOIN, fallback `"(deleted agent)"` when null
  5. For `findings_by_severity`: pivot severity rows into `{ CRITICAL, WARNING, SUGGESTION }` object

  **`getAgentStats(workspaceId: string, agentId: string, params: PeriodParams): Promise<AgentStats>`**:
  - `resolvePeriod(params)` → `{ from, to }`
  - Run in parallel: `repo.aggregateRunsByAgent` + `repo.aggregateFindingsByAgent` + `repo.getRunTrend(workspaceId, agentId, from, to)` (single-agent trend)
  - Filter results to `agentId`; verify the agent belongs to this workspace (return 404 if not found in `agents` table)
  - Map to `AgentStats` shape; `trend: StatPoint[]` maps individual runs to `{ label: run.ranAt.toISOString(), value: run.findingsCount ?? 0 }`

  **`getDashboard(workspaceId: string, params: PeriodParams): Promise<AgentPerformance>`**:
  - `resolvePeriod(params)` → `{ from, to }`; `previousPeriod` → `{ prev_from, prev_to }`
  - Run in parallel (3 Promise.all batches):
    - Batch A: `aggregateRunsByAgent(workspaceId, from, to)` + `aggregateFindingsByAgent(workspaceId, from, to)` + `getDailyRunsTrend(workspaceId, from, to)` + `getModelCostBreakdown(workspaceId, from, to)` + `getRunTrend(workspaceId, null, from, to)` (all agents' trends for expanded rows)
    - Batch B (for previous period): `aggregateRunsByAgent(workspaceId, prev_from, prev_to)` + `aggregateFindingsByAgent(workspaceId, prev_from, prev_to)` (only cost + accept_rate needed for deltas)
  - Compute `summary`:
    - `total_runs = sum of all runs`
    - `total_cost_usd = sum of all non-null costUsd values` (null if none have cost data)
    - `previous_total_cost_usd` = same from previous period rows (null if no cost data in prev period, AC-8)
    - `avg_accept_rate = total_accepted / (total_accepted + total_dismissed)` across all agents' acted findings; null if nothing acted (AC-6, pooled rate, NOT mean of per-agent rates)
    - `most_active`: agent with largest run count; tie-break by `last_run_at DESC` then `agent_name ASC` (AC-7)
  - For `agents[]` array:
    - Include per-agent merged stats
    - `previous_accept_rate` from previous-period findings (null if no acted findings in prev period, AC-8)
    - Sort: accept_rate DESC, null last; ties by runs DESC then agent_name ASC (AC-9)
    - The "(deleted agent)" bucket appears here with `agent_id: null` and no `View` navigation
  - `cost_by_agent`: `[{ agent_id, agent_name, cost_usd }]` — includes "(deleted agent)" bucket with `agent_id: null` (AC-23). Total of `cost_by_agent` equals `summary.total_cost_usd` (AC-12).
  - `cost_by_model`: from `getModelCostBreakdown`; includes `'unknown'` bucket (edge case 11). Total equals `summary.total_cost_usd` (AC-12).
  - **Cost reconciliation invariant:** both `cost_by_agent` and `cost_by_model` sums must match `summary.total_cost_usd` — if they diverge due to float rounding, the repository SUM result (string) should be used as the canonical total, not re-computed from JavaScript floats.

#### 1.6 Routes — agent-performance module

- [ ] `server/src/modules/agent-performance/routes.ts` — new Fastify plugin:

  ```typescript
  import type { FastifyInstance } from 'fastify';
  import type { ZodTypeProvider } from 'fastify-type-provider-zod';
  import { getContext } from '../_shared/context.js';
  import { PeriodParams } from '../_shared/schemas.js';
  import { AgentPerformanceService } from './service.js';

  export default async function agentPerformanceRoutes(appBase: FastifyInstance) {
    const app = appBase.withTypeProvider<ZodTypeProvider>();
    const service = new AgentPerformanceService(app.container);

    app.get(
      '/agent-performance',
      { schema: { querystring: PeriodParams } },
      async (req) => {
        const { workspaceId } = await getContext(app.container, req);
        return service.getDashboard(workspaceId, req.query);
      },
    );
  }
  ```

  422 is returned automatically by the Zod type provider when `PeriodParams` validation fails (AC-5) — no manual try-catch needed.

#### 1.7 New stats endpoint in agents/routes.ts

- [ ] `server/src/modules/agents/routes.ts` — add the `GET /agents/:id/stats` handler. Registration must occur **before** `GET /agents/:id` (Fastify's trie router handles this correctly for longer paths, but explicit ordering near the top of the file is clearer):

  ```typescript
  import { AgentPerformanceService } from '../agent-performance/service.js';
  // (add at top alongside existing imports)

  // Inside agentsRoutes():
  const perfService = new AgentPerformanceService(app.container);

  // IMPORTANT: register BEFORE /agents/:id so path "/agents/:id/stats" is
  // unambiguously a sub-resource, not a uuid param conflict.
  app.get(
    '/agents/:id/stats',
    { schema: { params: IdParams, querystring: PeriodParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const stats = await perfService.getAgentStats(workspaceId, req.params.id, req.query);
      // NotFoundError thrown by service when agentId not in workspace
      return stats;
    },
  );
  ```

  The `AgentPerformanceService` throws `NotFoundError` when the agent doesn't belong to this workspace (returns 404, AC per spec `GET /agents/:id/stats` contract).

#### 1.8 Module registry

- [ ] `server/src/modules/index.ts` — add import and registration entry:

  ```typescript
  import agentPerformance from './agent-performance/routes.js';

  export const modules: Record<string, FastifyPluginAsync> = {
    // ... existing entries ...
    agentPerformance,
  };
  ```

#### 1.9 Integration tests — agent-performance

- [ ] `server/src/modules/agent-performance/agent-performance.it.test.ts` — integration test using testcontainers Postgres (`.it.test.ts` suffix). The test file must:

  1. **Setup:** insert workspace, two agents (A1, A2), agent_runs for each with varying `status`, `costUsd`, `durationMs`, `findingsCount`, `model`, `ranAt`. Insert reviews and findings with varying `severity`, `acceptedAt`, `dismissedAt` for the runs.
  2. **AC-14 — accept-rate math:** seed A1 with 2 accepted + 1 dismissed + 3 pending findings. Assert `accept_rate = 2/3` ≈ 0.667, not `2/6`. Assert `pending = 3`. Assert agent with only pending findings has `accept_rate = null`.
  3. **AC-19 — null exclusion:** seed one `status='failed'` run with `costUsd = null`. Assert the failed run IS counted in `runs`. Assert `avg_cost_usd` equals average of only the non-null runs (hand-computed). Assert `total_cost_usd` excludes the null run.
  4. **AC-12 — cost reconciliation:** assert `summary.total_cost_usd === sum(cost_by_agent[].cost_usd) === sum(cost_by_model[].cost_usd)`.
  5. **AC-23 — deleted-agent bucket:** delete agent A1 after seeding its runs. Call `GET /agent-performance`. Assert a row with `agent_id: null`, `agent_name: "(deleted agent)"` appears in `agents[]` and `cost_by_agent[]`. Assert `summary.total_runs` includes the deleted agent's runs. Assert `View` navigation is absent from the deleted-agent row (client concern, but endpoint returns `agent_id: null` which the client maps to no-navigation).
  6. **AC-22 — UTC boundaries:** seed a run at `2026-01-15T23:30:00.000Z`. Query `period=custom&from=2026-01-15&to=2026-01-15`. Assert the run is included. Query `from=2026-01-14&to=2026-01-14`. Assert it is excluded.
  7. **AC-3 — default 30d:** call endpoint without `period` param. Assert response is valid `AgentStats` covering approximately 30 days (no 422).
  8. **AC-5 — validation:** call with `period=banana` → 422; `from=2026-99-99` → 422; `from=2026-07-10&to=2026-07-01` → 422 (from > to). Assert no DB query runs (use a mock or verify by checking response only).
  9. **AC-7 — most-active tie-break:** seed A1 and A2 with equal run counts. Assert `most_active` is the one with the later `last_run_at`, then by name.
  10. **AC-8 — no delta when prev period empty:** pick a date range whose preceding equal-length window has no runs. Assert `previous_total_cost_usd: null` and `previous_accept_rate: null` for all agents.
  11. **AC-13 — cross-surface equality:** call `GET /agents/:id/stats` for each agent with the same period. Assert `runs`, `avg_cost_usd`, `avg_duration_ms`, `accept_rate` match the corresponding row in `GET /agent-performance`.
  12. Parse all responses through the `AgentPerformance` and `AgentStats` Zod schemas to catch shape mismatches.

#### 1.10 Client API functions

- [ ] `client/src/lib/api.ts` — add two exported async functions:

  ```typescript
  export async function fetchAgentStats(
    agentId: string,
    params: { period?: string; from?: string; to?: string },
  ): Promise<AgentStats> {
    const sp = new URLSearchParams();
    if (params.period) sp.set('period', params.period);
    if (params.from)   sp.set('from', params.from);
    if (params.to)     sp.set('to', params.to);
    return apiFetch<AgentStats>(`/agents/${agentId}/stats?${sp}`);
  }

  export async function fetchAgentPerformance(
    params: { period?: string; from?: string; to?: string },
  ): Promise<AgentPerformance> {
    const sp = new URLSearchParams();
    if (params.period) sp.set('period', params.period);
    if (params.from)   sp.set('from', params.from);
    if (params.to)     sp.set('to', params.to);
    return apiFetch<AgentPerformance>(`/agent-performance?${sp}`);
  }
  ```

  (`apiFetch` is the project's existing fetch wrapper that applies `NEXT_PUBLIC_API_BASE` and throws `ApiError` on non-2xx.)

#### 1.11 Client hooks

- [ ] `client/src/lib/hooks/performance.ts` — new file with two TanStack Query hooks:

  ```typescript
  import { useQuery } from '@tanstack/react-query';
  import { fetchAgentStats, fetchAgentPerformance } from '../api';
  import type { AgentStats, AgentPerformance } from '@devdigest/shared';

  type PeriodParams = { period?: string; from?: string; to?: string };

  export function useAgentStats(agentId: string | null, params: PeriodParams = {}) {
    return useQuery<AgentStats>({
      queryKey: ['agent-stats', agentId, params],
      queryFn: () => fetchAgentStats(agentId!, params),
      enabled: !!agentId,
    });
  }

  export function useAgentPerformance(params: PeriodParams = {}) {
    return useQuery<AgentPerformance>({
      queryKey: ['agent-performance', params],
      queryFn: () => fetchAgentPerformance(params),
    });
  }
  ```

  **AC-4 note:** the `params` object is included in the query key so that changing the period auto-invalidates and re-fetches.

---

### Phase 2: Agent Stats Tab (parallel after Phase 1, independent of Phase 3)

**File boundary:** writes only into:
- `client/src/app/agents/[id]/_components/AgentEditor/`
- `client/src/app/agents/[id]/page.tsx`
- `client/messages/en/agents.json` (stats tab content strings only — additive)

**Must not touch:** Phase 3 file zone (`client/src/app/agent-performance/`), `vendor/shared/`, `vendor/ui/`, `lib/api.ts`, `lib/hooks/performance.ts`.

**AC coverage:** AC-1, AC-2 (contract already wired in Phase 1), AC-3, AC-4, AC-5 (UI guard), AC-14 (accept rate placeholder), AC-16, AC-18.

#### 2.1 Add stats tab to TABS array

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/constants.ts` — add the stats tab descriptor. Insert between `context` and `evals` to match the spec's listed order (AC-1 lists "alongside Config/Skills/Context/Evals/CI"):

  ```typescript
  export const TABS: readonly EditorTab[] = [
    { key: "config",   labelKey: "editor.tabs.config",   icon: "Settings" },
    { key: "skills",   labelKey: "editor.tabs.skills",   icon: "Sparkles" },
    { key: "context",  labelKey: "editor.tabs.context",  icon: "FileText" },
    { key: "evals",    labelKey: "editor.tabs.evals",    icon: "FlaskConical" },
    { key: "ci",       labelKey: "editor.tabs.ci",       icon: "GitBranch" },
    { key: "stats",    labelKey: "editor.tabs.stats",    icon: "BarChart2" },
  ];
  ```

  The `"editor.tabs.stats"` key already exists in `client/messages/en/agents.json` (value `"Stats"`). Verify the `BarChart2` icon name exists in `vendor/ui/icons.tsx`; if not, use `"TrendingUp"` or another available icon from that union.

#### 2.2 Update VALID_TABS in page.tsx

- [ ] `client/src/app/agents/[id]/page.tsx` — update `VALID_TABS` to include `"stats"`:

  ```typescript
  const VALID_TABS = ["config", "skills", "context", "evals", "ci", "stats"];
  ```

  Also update the `setTab` logic to preserve `period`, `from`, `to` params when switching tabs so navigating away from stats and back preserves the selected period:

  ```typescript
  const setTab = (t: string) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("tab", t);
    router.replace(`/agents/${id}?${sp.toString()}`);
  };
  ```

  (The existing implementation already does this — just confirm `sp.toString()` preserves all search params when `setTab` is called.)

#### 2.3 Register StatsTab in AgentEditor.tsx

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` — add import and conditional render:

  ```typescript
  import { StatsTab } from "./_components/StatsTab";

  // Inside the JSX body:
  {tab === "stats" && <StatsTab agentId={agent.id} />}
  ```

  The `StatsTab` reads period params from `useSearchParams()` internally, so no props beyond `agentId` are needed.

#### 2.4 StatsTab component

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.tsx` — new component. Structure:

  ```
  "use client";

  import { useSearchParams, useRouter } from "next/navigation";
  import { useAgentStats } from "../../../../../../lib/hooks/performance";
  import { Skeleton, ErrorState } from "@devdigest/ui";
  import { MetricCard, Sparkline } from "@devdigest/ui";
  ```

  Internal structure:
  1. **Period selector** — `<select>` or `<Tabs>`-based preset switcher (30d / 7d / 1d / custom date picker). Reads `period`, `from`, `to` from `useSearchParams()`. On change: `router.replace(`/agents/${agentId}?tab=stats&period=...`)`. UI must prevent submitting `from > to` (AC-5). For custom range, show two date inputs; disable submit when `from > to`.
  2. **Loading state** — `if (isLoading)` → render `<Skeleton />` tiles; never show `0%` or `$0` (AC-18).
  3. **Error state** — `if (isError)` → render `<ErrorState />` with no metric values (AC-18).
  4. **Zero-run state** — `stats.runs === 0` → render zero counts + placeholder markers (`"—"`) for `accept_rate`, `dismiss_rate`, `avg_cost_usd`, `avg_latency_ms` (AC-16). No crash.
  5. **Data state** — render:
     - Metric card grid (2×N): Runs, Findings Total, Accepted, Dismissed, Pending, Accept Rate, Dismiss Rate, Avg Findings/Run, Total Cost, Avg Cost/Run, Avg Latency
     - Severity breakdown: CRITICAL / WARNING / SUGGESTION counts (can be `BarRow` from `@devdigest/ui/charts`)
     - Recent-runs trend chart: `<Sparkline>` with `data={stats.trend}` (label = run date, value = findings per run, AC-1)
  6. **Accessibility:** trend chart must have an `aria-label` or `<title>` with text equivalent of the trend data (AC per Non-functional accessibility requirements).
  7. **Placeholder rendering:** when `accept_rate === null` → render `"—"` string, not `"0%"` (AC-16 data honesty).

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/index.ts` — barrel:
  ```typescript
  export { StatsTab } from './StatsTab';
  ```

#### 2.5 StatsTab test

- [ ] `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.test.tsx` — RTL component test:

  - Mock `@/lib/hooks/performance` with `vi.mock` returning controlled `useAgentStats` responses (loading / error / zero-run / data).
  - Mock `next/navigation` (`useSearchParams`, `useRouter`).
  - **Test: loading state** — assert no metric values render while `isLoading: true`.
  - **Test: error state** — assert `ErrorState` renders; no metric values.
  - **Test: zero-run agent** — `data.runs === 0`; assert `"—"` renders for `accept_rate` (not "0%").
  - **Test: data state** — verify key metrics render from fixture; verify `accept_rate` is displayed as a percentage string.
  - **Test: period selector** — simulate selecting "7d"; assert `router.replace` is called with `period=7d` in the URL.
  - **i18n:** import from `../../../../../../../../../../messages/en/agents.json` — recount `../` hops; the StatsTab test is nested 6 levels deep from `client/src/app/`, so path is `../../../../../../messages/en/agents.json` relative to `StatsTab.test.tsx`. Verify count before writing.

#### 2.6 i18n strings (Stats tab content)

- [ ] `client/messages/en/agents.json` — verify the `editor.tabs.stats` key exists (confirmed: it does). Add stats-tab content strings under an `"stats"` namespace if the component uses them:

  ```json
  "stats": {
    "period30d": "Last 30 days",
    "period7d": "Last 7 days",
    "period1d": "Last 24 hours",
    "periodCustom": "Custom range",
    "from": "From",
    "to": "To",
    "runsLabel": "Runs",
    "findingsTotal": "Findings",
    "accepted": "Accepted",
    "dismissed": "Dismissed",
    "pending": "Pending",
    "acceptRate": "Accept rate",
    "dismissRate": "Dismiss rate",
    "avgFindingsPerRun": "Avg findings / run",
    "totalCost": "Total cost",
    "avgCost": "Avg cost / run",
    "avgLatency": "Avg latency",
    "severityBreakdown": "By severity",
    "trend": "Recent runs (findings per run)",
    "noData": "—",
    "empty": "No runs in this period."
  }
  ```

  Only add keys actually referenced by `StatsTab.tsx` — avoid dead i18n strings.

---

### Phase 3: Global Dashboard (parallel with Phase 2, after Phase 1)

**File boundary:** writes only into:
- `client/src/app/agent-performance/`
- `client/messages/en/agentPerformance.json`

**Must not touch:** Phase 2 file zone (`client/src/app/agents/`), `vendor/shared/`, `vendor/ui/`, `lib/api.ts`, `lib/hooks/performance.ts`.

**AC coverage:** AC-4, AC-5 (UI guard), AC-6, AC-7, AC-8, AC-9, AC-10, AC-11, AC-12, AC-17, AC-18, AC-21, AC-23 (UI rendering of deleted-agent row).

#### 3.1 Dashboard page (thin)

- [ ] `client/src/app/agent-performance/page.tsx` — new thin page:

  ```typescript
  "use client";

  import { AgentPerformanceDashboard } from "./_components/AgentPerformanceDashboard";

  export default function AgentPerformancePage() {
    return <AgentPerformanceDashboard />;
  }
  ```

  The page does not contain any logic, hooks, or data fetching (client/CLAUDE.md: "Pages are thin").

#### 3.2 Dashboard main component

- [ ] `client/src/app/agent-performance/_components/AgentPerformanceDashboard/AgentPerformanceDashboard.tsx` — new component. Reads `period`, `from`, `to` from `useSearchParams()`. Calls `useAgentPerformance(params)`. Renders:

  **State machine (AC per Architecture & workflows):**
  - `isLoading` → show `<Skeleton />` placeholders, no metric values (AC-18)
  - `isError` → show `<ErrorState />` with a retry button, no metric values (AC-18)
  - `data.summary.total_runs === 0` (or `!data`) → dedicated empty state (AC-17): `<EmptyState>` with title "No agent runs yet" and body explaining how to start
  - `data.summary.total_runs > 0` → full dashboard

  **Full dashboard layout (AC-21):**
  1. Header: title "Agent Performance", subtitle "Which agents earn their keep — accept rate is the quality signal", plus period selector (same preset buttons as Stats tab)
  2. Summary cards row (4 cards, AC-6):
     - **Total runs** — value: `summary.total_runs`; sparkline: `summary.runs_trend` via `<Sparkline>`
     - **Total cost** — value: `summary.total_cost_usd` (formatted as `$N.NN`); delta vs previous: compute `((total - prev) / prev * 100)%` if `prev !== null && prev > 0`; no delta indicator when `previous_total_cost_usd === null` (AC-8)
     - **Avg accept rate** — value: `summary.avg_accept_rate` as `%`; radial/ring indicator; show placeholder when `null` (pooled rate, not per-agent mean, AC-6)
     - **Most active** — name, runs, accept rate; `null` when no runs
  3. Agent table (AC-9): columns — Agent (icon + name), Runs, Avg cost, Avg duration, Accept rate (with trend arrow), Last run (relative time), View action. Default sort: accept rate DESC, null accept-rates last; ties: runs DESC, name ASC. Click row or View button → navigate to `/agents/${row.agent_id}?tab=stats&period=${period}&from=${from}&to=${to}` (AC-10 deep-link). Deleted-agent row (`agent_id: null`) has no View navigation. Expand row → show per-agent trend sparkline from `row.trend` (AC-10).
  4. Cost breakdown section (AC-11): `<Donut>` for `cost_by_agent` + `<Donut>` for `cost_by_model`, each with legend listing names + amounts. Empty donut when `total_cost_usd === null`.

  **Accessibility (spec Non-functional):**
  - Trend arrows have `aria-label="up N%"` / `aria-label="down N%"`.
  - Donut segments have accessible text in legend (not color alone).
  - Radial indicator has `aria-valuenow` + `aria-valuetext`.
  - Period selector and table sort/expand are keyboard-operable.

- [ ] `client/src/app/agent-performance/_components/AgentPerformanceDashboard/index.ts` — barrel

- [ ] `client/src/app/agent-performance/_components/AgentPerformanceDashboard/constants.ts` — period preset config, table column definitions, color palette for donuts

- [ ] `client/src/app/agent-performance/_components/AgentPerformanceDashboard/helpers.ts` — pure formatting helpers: `formatCost(n: number | null): string`, `formatDuration(ms: number | null): string`, `formatAcceptRate(r: number | null): string`, `computeDelta(current: number | null, prev: number | null): { pct: number; dir: 'up' | 'down' } | null`

- [ ] Sub-components (nested colocation, max 2 levels per ui-architecture SKILL.md): create `_components/AgentPerformanceDashboard/_components/<Sub>/` for each section if the component file exceeds ~200 lines or has distinct state:
  - `SummaryCards/SummaryCards.tsx` — renders the 4 metric card tiles
  - `AgentTable/AgentTable.tsx` — the sortable, expandable table with period-preserving deep-links
  - `CostBreakdown/CostBreakdown.tsx` — the two donut charts

  Each sub-component needs its own `index.ts` barrel.

#### 3.3 Dashboard test

- [ ] `client/src/app/agent-performance/_components/AgentPerformanceDashboard/AgentPerformanceDashboard.test.tsx`:

  - Mock `@/lib/hooks/performance` (`useAgentPerformance`).
  - Mock `next/navigation` (`useSearchParams`, `useRouter`).
  - **Test: loading** — skeleton renders; no metric text like "0%", "$0".
  - **Test: error** — `ErrorState` renders; no metric values.
  - **Test: empty** — `summary.total_runs === 0` → empty state title matches i18n key.
  - **Test: full data** — verify all 4 card titles render; agent table rows render; cost donut legends render.
  - **Test: deleted-agent row** — agent row with `agent_id: null` renders `"(deleted agent)"` name; no View button present.
  - **Test: View deep-link** — click View on a data row with `period=7d`; assert `router.push` called with `/agents/${id}?tab=stats&period=7d`.
  - **Test: null accept_rate** — agent row with `accept_rate: null` renders `"—"` not `"0%"`.
  - **Test: no cost delta** — `previous_total_cost_usd: null` → total-cost card shows no delta `%` text.

#### 3.4 i18n strings (dashboard)

- [ ] `client/messages/en/agentPerformance.json` — the file already exists with partial strings. Review all strings referenced by the new components and add missing ones. Ensure the following keys exist:

  ```json
  {
    "title": "Agent Performance",
    "subtitle": "Which agents earn their keep — accept rate is the quality signal",
    "loadError": "Could not load agent performance.",
    "period30d": "Last 30 days",
    "period7d": "Last 7 days",
    "period1d": "Last 24 hours",
    "periodCustom": "Custom range",
    "from": "From",
    "to": "To",
    "summary": {
      "totalRuns": "Total runs",
      "avgAcceptRate": "Avg accept-rate",
      "totalCost": "Total cost",
      "mostActive": "Most active",
      "noRate": "—",
      "vsLastPeriod": "{pct}% vs last period"
    },
    "table": {
      "agent": "Agent",
      "runs": "Runs",
      "avgCost": "Avg cost",
      "avgDuration": "Avg duration",
      "acceptRate": "Accept rate",
      "lastRun": "Last run",
      "view": "View",
      "deletedAgent": "(deleted agent)",
      "expandTrend": "Recent runs"
    },
    "costByAgent": "Cost by agent",
    "costByModel": "Cost by model",
    "noCost": "No cost recorded yet.",
    "empty": {
      "title": "No agent runs yet",
      "body": "Run a review to populate per-agent performance data."
    }
  }
  ```

  Update or extend keys in the existing file; do not remove any existing keys (backward-compatible).

---

## Gotchas

- **No migrations.** The spec's non-goal: "No new tables, columns, or migrations." Do not create any files under `server/src/db/migrations/`. Do not run `pnpm db:generate` or `pnpm db:migrate`.
- **Both vendor copies must stay in sync.** After editing `server/src/vendor/shared/contracts/observability.ts`, the implementer MUST copy the same changes to `client/src/vendor/shared/contracts/observability.ts` before committing. `pnpm typecheck` in the client will fail on mismatches.
- **`vendor/ui/` is frozen.** Do not modify `client/src/vendor/ui/` — including `nav.ts`. The `/agent-performance` nav entry (line 44) is already there.
- **`costUsd` is a string from Drizzle** — `numeric(12,8)` PostgreSQL columns return as JS `string` in node-postgres. The repository aggregation `SUM(...)` also returns a string. Always `parseFloat()` before arithmetic or returning as a `z.number()` field.
- **Deleted-agent findings attribution** — `reviews.agentId` is NOT a foreign key (no `onDelete: 'set null'`). When an agent is deleted, `agent_runs.agentId` goes null but `reviews.agentId` retains the old UUID. The repository LEFT JOINs `reviews.agentId → agents.id` to identify deleted agents; the service groups non-matching review agent IDs under the `null` bucket.
- **Accept rate semantics** — MUST use `accepted / (accepted + dismissed)` with pending excluded (per `AgentStats` contract comment, AC-14). The skills/repository.ts precedent uses a different formula — do NOT follow it.
- **`VALID_TABS` in agents/[id]/page.tsx** — this hardcoded array must include `"stats"` or the tab query param is overridden to `"config"`. It's separate from the `TABS` constant in `constants.ts`.
- **Test fixture updates** — adding new required fields to `AgentStats` (not done — it's already defined) or `AgentPerformance` tests: if any existing test file creates an `AgentStats`-typed fixture object, tsc will error on the missing new fields. There are no existing callers of `AgentStats` (the contract was orphaned), so no existing fixtures to update.
- **Icon name validation** — `IconName` is a fixed union in `vendor/ui/icons.tsx`. Verify `"BarChart2"` or the chosen icon for the Stats tab exists in that union before committing; if not, pick an available icon.
- **i18n deep relative path count** — `StatsTab.test.tsx` is at `client/src/app/agents/[id]/_components/AgentEditor/_components/StatsTab/StatsTab.test.tsx`. Path to messages: `../../../../../../../../messages/en/agents.json` — that is 8 levels. Count carefully; wrong depth = ERR_MODULE_NOT_FOUND at Vitest runtime.

---

## Definition of done

- [ ] `pnpm test` passes in `server/` and `client/` (all unit + integration tests green)
- [ ] `pnpm tsc --noEmit` reports zero errors in `server/` and `client/`
- [ ] Both vendor copies of `observability.ts` are byte-for-byte identical for the new `AgentPerformance` section
- [ ] AC-1: Stats tab appears in agent editor alongside Config/Skills/Context/Evals/CI; all listed metrics render for last 30 days
- [ ] AC-2: `GET /agents/:id/stats` response parses against the `AgentStats` Zod schema; server and client vendor copies identical
- [ ] AC-3: Calling `GET /agents/:id/stats` without period params returns a valid response for the last 30 days
- [ ] AC-4: Changing the period on either surface reloads all metrics for exactly that range
- [ ] AC-5: `period=banana`, `from=2026-99-99`, `from > to`, and 5-year custom span each return 422; UI prevents `from > to` submission
- [ ] AC-6: Dashboard loads 4 summary cards in the correct order; avg accept rate uses pooled formula; shows placeholder (not 0%) when nothing acted
- [ ] AC-7: Most-active card names the agent with most runs; tie-break is deterministic
- [ ] AC-8: Cost-card delta and table trend arrows absent when previous period has no data (no infinity or NaN)
- [ ] AC-9: Table columns match spec; default sort is accept rate DESC, null last; ties break deterministically
- [ ] AC-10: View action navigates to `/agents/${id}?tab=stats&period=...` with period preserved; expanded row trend renders
- [ ] AC-11: Two cost donuts render with legends
- [ ] AC-12: `sum(cost_by_agent[].cost_usd) === sum(cost_by_model[].cost_usd) === summary.total_cost_usd` (verified in integration test)
- [ ] AC-13: For seeded agents + each of the 3 presets + 1 custom range: Runs/Avg cost/Avg duration/Accept rate match between dashboard row and Stats tab (verified in integration test)
- [ ] AC-14: Accept rate = accepted / (accepted + dismissed); agent with only pending findings shows null / "—" on both surfaces
- [ ] AC-16: Zero-run agent shows Runs=0 and "—" placeholders; does not crash either surface
- [ ] AC-17: Dashboard with all-zero-runs period shows dedicated empty state; no cards/table/donuts
- [ ] AC-18: Loading indicators while fetching; error state shows no metric values
- [ ] AC-19: Failed/null-cost run counted in run total; excluded from avg cost and total cost (verified in integration test)
- [ ] AC-20: No POST/mutation requests issued from either surface; `agent_runs` row count unchanged after loading, period change, sort, expand, navigate
- [ ] AC-21: Dashboard visual structure matches spec header→cards→table→donuts order
- [ ] AC-22: Custom range `from=2026-01-15&to=2026-01-15` includes run at `23:30 UTC 2026-01-15`; excludes run from day before (verified in integration test)
- [ ] AC-23: Runs for a deleted agent appear in `agents[]` row and `cost_by_agent[]` segment with `agent_id: null` and name `"(deleted agent)"`; row has no View navigation; totals reconcile
