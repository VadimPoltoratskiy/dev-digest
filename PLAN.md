# Plan: Multi-Agent Review History Page

## Spec reference

None — planned directly from the approved plan at `/Users/vpolto/.claude/plans/lets-create-multi-agent-composed-karp.md`, per user's direction in the request.

## Execution mode: multi-agent

Three phases; Phase 2 (backend) and Phase 3 (frontend) run in parallel once Phase 1 (foundation) is complete.

**Dependency chain:** Phase 1 must land first because:
- Phase 2 depends on the DB schema index (migration must be applied before integration tests run) and the `MultiRunSummary`/`MultiRunSummaryList` Zod types (service return type).
- Phase 3 depends on the same Zod types (the `useMultiRuns` hook is typed against `MultiRunSummaryList`).

Phase 2 and Phase 3 have no dependency on each other and can run concurrently once Phase 1 is merged.

## Goal

Once a multi-agent review run finishes and the user navigates away, there is no way back to its results page. This feature adds: (1) a `GET /multi-runs` list endpoint with real `limit`/`offset` pagination and batch-aggregated status/cost/duration, (2) a `/multi-runs` history page listing past runs for the selected repo, and (3) nav and breadcrumb fixes so the sidebar "Multi-Agent Review" item lands on the new list page instead of jumping straight to Configure.

## Modules affected

- `server/` — `db/schema/runs.ts` (new index), `vendor/shared/contracts/observability.ts` (new contracts), `modules/multi-runs/repository.ts` (two new queries), `modules/multi-runs/service.ts` (new list method), `modules/multi-runs/routes.ts` (new GET /multi-runs route)
- `client/` — `vendor/shared/contracts/observability.ts` (contract mirror), `lib/api.ts` (new fetch function), `lib/hooks/multi-runs.ts` (new hook), new `app/multi-runs/page.tsx` and `_components/MultiRunHistoryView/`, `messages/en/multiRuns.json` (new history keys), `vendor/ui/nav.ts` (href fix), two breadcrumb edits

## Engineering Insights applied

- **Cost computed from existing columns, no migration for data** (`2026-06-25`): `costUsd` and `durationMs` are already on `agent_runs`; the new batch query reads them directly.
- **`inArray` + JS Map for batch aggregation without N+1** (`2026-06-25`): `getAgentRunsForMultiRunIds` fetches all child `agent_runs` for the page's multi-run IDs in one `inArray` query; the service groups by `multiAgentRunId` in JS — exact same pattern as `server/src/modules/pulls/routes.ts:131-158`.
- **`COUNT(*) OVER()` for total without a second query** (prior-prs pattern): `findMultiRuns` includes `sql<number>\`count(*) over()\`` per row, read from `rows[0]?.total` in the service.
- **`.nullish()` for list-only derived fields; `.nullable()` only when service always supplies** (`2026-06-25`): `pr_number`/`pr_title` are `.nullish()` for forward compat (joined); `total_cost_usd`/`total_duration_ms` are `.nullable()` because the service always computes them (may be `null` when no agent-run rows have cost/duration data yet).
- **Repo-scoped pages without a repoId column reuse `useActiveRepo()`** (`2026-07-06`): `MultiRunHistoryView` defaults to `useActiveRepo()`, with a switcher via `useRepos()` when more than one repo exists — identical to `ConfigureRunView.tsx` lines 208-219.
- **`vendor/shared/` is a manual mirror** (`2026-06-25`): both `server/src/vendor/shared/contracts/observability.ts` and `client/src/vendor/shared/contracts/observability.ts` must receive the same additions. No tooling enforces the sync.

## Recommendations

- **`useInfiniteQuery` vs offset accumulation in state**: TanStack's `useInfiniteQuery` is the purpose-built primitive for "load more" pagination, but it would be the only usage in the codebase and requires wiring `getNextPageParam`. The approved plan accepts the simpler approach: `useQuery` for each page, with the component accumulating items in `allItems` state and appending on each Load More click. This keeps the hook API consistent with the other three hooks in `multi-runs.ts`. Tradeoff: slightly more component state management; benefit: zero new patterns introduced.
- **`innerJoin` vs `leftJoin` in `findMultiRuns`**: Use `innerJoin` on `pullRequests` (not `leftJoin` as `findMultiRunById` uses). The `prId` FK has `onDelete: 'cascade'` — if the PR is deleted, the multi-run is deleted with it, so orphaned multi-runs cannot exist and `innerJoin` is semantically correct. The `eq(t.pullRequests.repoId, repoId)` filter in the WHERE clause only works correctly with an inner join anyway.

## Architecture decisions

- **New Zod querystring schema defined inline in routes.ts** — `ListMultiRunsQuery` with `repoId: z.string().uuid()` (required), `limit: z.coerce.number().int().min(1).max(100).default(20)`, `offset: z.coerce.number().int().min(0).default(0)`. `z.coerce` is required for querystring numbers — URL values arrive as strings, and Fastify's Zod provider does not auto-coerce without it. Per fastify-best-practices: schema-first validation, never hand-roll `.parse()` in a handler.
- **`repoId` is required in the querystring** — the endpoint is always one-repo-at-a-time per the approved plan's scope decision. This avoids a large cross-repo scan and is consistent with how the client always fetches per active repo.
- **Repository functions remain pure query functions; service holds all aggregation logic** — per onion-architecture layer boundaries: repositories return raw typed rows, services compute DTOs. `getAgentRunsForMultiRunIds` returns raw rows with `multiRunId: string | null`; the service's JS grouping ignores null values (they cannot appear given the `inArray` filter, but the type is nullable in the schema).
- **`MultiRunSummary.status` is `z.enum(['running', 'done', 'failed'])` — excludes `'cancelled'`** — following the approved plan's definition. A multi-run that has zero agent_runs (a pathological race) is treated as `'running'` by the service's status logic.
- **New page lives at `client/src/app/multi-runs/page.tsx`** — a thin async RSC, following the same pattern as `configure/page.tsx` and `[multiRunId]/page.tsx`. The `MultiRunHistoryView` client component is colocated at `client/src/app/multi-runs/_components/MultiRunHistoryView/` per ui-architecture colocation rules.
- **`nav.ts` edit is a deliberate exception to the vendor/ui do-not-touch rule** — `nav.ts` defines app-specific navigation structure (not a UI primitive like a Button or Badge). The policy exists to prevent modifying `@devdigest/ui` primitives; this is application configuration that happens to live in the same folder. Changing one href is safe and explicitly required by the approved plan.

## Tasks

### Phase 1: Foundation — DB schema index + Zod contracts

**Must complete and be available to implementers of Phase 2 and Phase 3 before those phases start.**

- [ ] `server/src/db/schema/runs.ts` — add compound index on `multiAgentRuns` table. Change the table definition's second argument from an empty object `{}` to a `(t) => ({...})` callback (mirroring the `agentRuns` table's pattern at lines 43-49). Add: `multiRunWorkspaceRanAtIdx: index('multi_agent_runs_workspace_id_ran_at_idx').on(t.workspaceId, t.ranAt)`. The column `workspaceId` is the equality filter; `ranAt` is the sort key for DESC pagination — composite order matches the query plan.

- [ ] Run `cd server && pnpm db:generate` — verify a new migration file appears under `server/src/db/migrations/`. Commit it.

- [ ] Run `cd server && pnpm db:migrate` — applies the new index migration.

- [ ] `server/src/vendor/shared/contracts/observability.ts` — append the following two schemas after the existing `MultiRunFindings` export (line 222). New additions only; no existing field is changed:

  ```typescript
  /** One row in the GET /multi-runs list response. */
  export const MultiRunSummary = z.object({
    id: z.string().uuid(),
    pr_id: z.string().uuid(),
    /** Joined from pulls table; nullish for forward compat. */
    pr_number: z.number().int().nullish(),
    /** Joined from pulls table; nullish for forward compat. */
    pr_title: z.string().nullish(),
    ran_at: z.string(),
    agent_count: z.number().int(),
    status: z.enum(['running', 'done', 'failed']),
    /** nullable: service always computes (null when no agent_runs have cost data yet). */
    total_cost_usd: z.number().nullable(),
    /** nullable: service always computes (null when no agent_runs have duration data yet). */
    total_duration_ms: z.number().int().nullable(),
  });
  export type MultiRunSummary = z.infer<typeof MultiRunSummary>;

  /** Paginated response for GET /multi-runs. */
  export const MultiRunSummaryList = z.object({
    items: z.array(MultiRunSummary),
    total: z.number().int(),
  });
  export type MultiRunSummaryList = z.infer<typeof MultiRunSummaryList>;
  ```

- [ ] `client/src/vendor/shared/contracts/observability.ts` — apply the identical additions (same two schemas, same types). Both vendor copies must stay in lockstep.

- [ ] Run `cd server && pnpm typecheck` and `cd client && pnpm typecheck` — verify no errors from the new contract definitions before handing off to Phase 2 and Phase 3 implementers.

---

### Phase 2: Backend API

**Depends on Phase 1. Runs in parallel with Phase 3.**

- [ ] `server/src/modules/multi-runs/repository.ts` — add the following two plain query functions (before the `MultiRunsRepository` class), then add their corresponding class methods.

  **Function 1 — `findMultiRuns`:** Add `sql` and `desc` to the existing `drizzle-orm` import at line 1.

  ```typescript
  export async function findMultiRuns(
    db: Db,
    workspaceId: string,
    repoId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<{
    id: string;
    prId: string;
    prNumber: number | null;
    prTitle: string | null;
    ranAt: Date;
    total: number;
  }[]> {
    return db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        prNumber: t.pullRequests.number,
        prTitle: t.pullRequests.title,
        ranAt: t.multiAgentRuns.ranAt,
        total: sql<number>`count(*) over()`,
      })
      .from(t.multiAgentRuns)
      .innerJoin(t.pullRequests, eq(t.pullRequests.id, t.multiAgentRuns.prId))
      .where(
        and(
          eq(t.multiAgentRuns.workspaceId, workspaceId),
          eq(t.pullRequests.repoId, repoId),
        ),
      )
      .orderBy(desc(t.multiAgentRuns.ranAt))
      .limit(limit)
      .offset(offset);
  }
  ```

  **Function 2 — `getAgentRunsForMultiRunIds`:**

  ```typescript
  export async function getAgentRunsForMultiRunIds(
    db: Db,
    multiRunIds: string[],
  ): Promise<{
    multiRunId: string | null;
    status: string | null;
    costUsd: string | null;
    durationMs: number | null;
  }[]> {
    if (multiRunIds.length === 0) return [];
    return db
      .select({
        multiRunId: t.agentRuns.multiAgentRunId,
        status: t.agentRuns.status,
        costUsd: t.agentRuns.costUsd,
        durationMs: t.agentRuns.durationMs,
      })
      .from(t.agentRuns)
      .where(inArray(t.agentRuns.multiAgentRunId, multiRunIds));
  }
  ```

  **`MultiRunsRepository` class additions** — add these two methods inside the class:

  ```typescript
  findMultiRuns(
    workspaceId: string,
    repoId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ id: string; prId: string; prNumber: number | null; prTitle: string | null; ranAt: Date; total: number }[]> {
    return findMultiRuns(this.db, workspaceId, repoId, opts);
  }

  getAgentRunsForMultiRunIds(
    multiRunIds: string[],
  ): Promise<{ multiRunId: string | null; status: string | null; costUsd: string | null; durationMs: number | null }[]> {
    return getAgentRunsForMultiRunIds(this.db, multiRunIds);
  }
  ```

- [ ] `server/src/modules/multi-runs/service.ts` — add `MultiRunSummary, MultiRunSummaryList` to the existing `@devdigest/shared` import at line 2. Then add the following method to `MultiRunsService` (after `getEstimates`):

  ```typescript
  async listMultiRuns(
    workspaceId: string,
    repoId: string,
    { limit, offset }: { limit: number; offset: number },
  ): Promise<MultiRunSummaryList> {
    const rows = await this.repo.findMultiRuns(workspaceId, repoId, { limit, offset });
    if (rows.length === 0) return { items: [], total: 0 };

    // COUNT(*) OVER() returns a bigint string from Postgres — coerce explicitly.
    const total = Number(rows[0]!.total);
    const multiRunIds = rows.map((r) => r.id);

    // Batch-fetch all child agent_runs (one round-trip, no N+1).
    const agentRunRows = await this.repo.getAgentRunsForMultiRunIds(multiRunIds);

    // Group by multiRunId in JS (same pattern as pulls/routes.ts costByPr block).
    type AgentRunMini = { status: string | null; costUsd: string | null; durationMs: number | null };
    const agentRunsMap = new Map<string, AgentRunMini[]>();
    for (const ar of agentRunRows) {
      if (!ar.multiRunId) continue; // null cannot occur given inArray filter
      const list = agentRunsMap.get(ar.multiRunId) ?? [];
      list.push(ar);
      agentRunsMap.set(ar.multiRunId, list);
    }

    const items: MultiRunSummary[] = rows.map((row) => {
      const childRuns = agentRunsMap.get(row.id) ?? [];

      // Status: running > failed > done. Zero child runs = still setting up => running.
      let status: 'running' | 'done' | 'failed';
      if (childRuns.length === 0 || childRuns.some((r) => !r.status || r.status === 'running')) {
        status = 'running';
      } else if (childRuns.some((r) => r.status === 'failed')) {
        status = 'failed';
      } else {
        status = 'done';
      }

      // Sum cost and duration (mirrors getMultiRun aggregation at service.ts:98-111).
      let totalCostUsd: number | null = null;
      let totalDurationMs: number | null = null;
      for (const ar of childRuns) {
        if (ar.costUsd !== null) {
          const parsed = parseFloat(ar.costUsd);
          if (!isNaN(parsed)) totalCostUsd = (totalCostUsd ?? 0) + parsed;
        }
        if (ar.durationMs !== null) {
          totalDurationMs = (totalDurationMs ?? 0) + ar.durationMs;
        }
      }

      return {
        id: row.id,
        pr_id: row.prId,
        pr_number: row.prNumber ?? null,
        pr_title: row.prTitle ?? null,
        ran_at: row.ranAt.toISOString(),
        agent_count: childRuns.length,
        status,
        total_cost_usd: totalCostUsd,
        total_duration_ms: totalDurationMs,
      };
    });

    return { items, total };
  }
  ```

- [ ] `server/src/modules/multi-runs/routes.ts` — add the `GET /multi-runs` handler. Import `z` from `'zod'` if not already in scope (check existing imports; `MultiReviewRequest` is imported from `@devdigest/shared`, not from `zod` directly, so `z` may not be imported). Add above the existing `POST /pulls/:id/multi-review` handler:

  ```typescript
  const ListMultiRunsQuery = z.object({
    repoId: z.string().uuid(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  // GET /multi-runs?repoId=&limit=&offset=
  app.get(
    '/multi-runs',
    { schema: { querystring: ListMultiRunsQuery } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.listMultiRuns(workspaceId, req.query.repoId, {
        limit: req.query.limit,
        offset: req.query.offset,
      });
    },
  );
  ```

- [ ] `server/src/modules/multi-runs/service.test.ts` — add unit test cases for `listMultiRuns`:
  - Returns `{ items: [], total: 0 }` when `findMultiRuns` returns an empty array.
  - Correctly derives `status: 'running'` when any child agent_run has a null or `'running'` status.
  - Correctly derives `status: 'failed'` when all child runs are terminal but at least one is `'failed'`.
  - Correctly derives `status: 'done'` when all child runs have `status === 'done'`.
  - Sums `total_cost_usd` and `total_duration_ms` from child rows; both are `null` when no child rows have those values.
  - Coerces `total` correctly with `Number(rows[0]!.total)` (stub the repo to return `total: '42'` as a string).

- [ ] `server/src/modules/multi-runs/routes.test.ts` — add unit test cases for `GET /multi-runs`:
  - Returns 422 when `repoId` is missing.
  - Returns 422 when `repoId` is not a valid UUID.
  - Returns 422 when `limit` is `0` or `101`.
  - Returns the mocked `MultiRunSummaryList` on a valid request.
  - Applies default `limit=20` and `offset=0` when those params are omitted.

- [ ] `server/src/modules/multi-runs/repository.it.test.ts` — add integration test cases for `findMultiRuns`:
  - Returns an empty array for a repo with no multi-runs.
  - Returns rows ordered by `ranAt` DESC.
  - `total` correctly reflects the full count when the result set is larger than the page (insert 3 runs, fetch with `limit=1`, verify `total=3` and `items.length=1`).
  - Filters by `repoId` — runs for a different repo in the same workspace are excluded.

---

### Phase 3: Frontend

**Depends on Phase 1 (for `MultiRunSummary`/`MultiRunSummaryList` types). Runs in parallel with Phase 2.**

- [ ] `client/src/lib/api.ts` — add `MultiRunSummaryList` to the existing type import block at the top of the file (line 22). Add the following exported function in the "Multi-Agent Review API functions" section (after `fetchMultiRunFindings`):

  ```typescript
  /** Fetch paginated multi-agent run history for a repo. */
  export function fetchMultiRuns(
    repoId: string,
    limit: number,
    offset: number,
  ): Promise<MultiRunSummaryList> {
    return apiFetch<MultiRunSummaryList>(
      `/multi-runs?repoId=${encodeURIComponent(repoId)}&limit=${limit}&offset=${offset}`,
    );
  }
  ```

- [ ] `client/src/lib/hooks/multi-runs.ts` — add `MultiRunSummaryList` to the type import block at line 12. Add `fetchMultiRuns` to the `import` from `'../api'` at line 11. Append at the end of the file:

  ```typescript
  /**
   * Paginated multi-agent run history for a repo.
   * Pass `repoId = null` to disable (lazy-fetch-on-active-repo pattern).
   */
  export function useMultiRuns(
    repoId: string | null,
    { limit, offset }: { limit: number; offset: number },
  ) {
    return useQuery<MultiRunSummaryList>({
      queryKey: ['multi-runs', repoId, limit, offset],
      queryFn: () => fetchMultiRuns(repoId!, limit, offset),
      enabled: !!repoId,
    });
  }
  ```

- [ ] `client/messages/en/multiRuns.json` — add a `"history"` section as a sibling of `"results"` and `"configure"`:

  ```json
  "history": {
    "title": "Multi-Agent Review",
    "configureRun": "Configure run",
    "emptyTitle": "No runs yet",
    "emptyBody": "No multi-agent review runs for this repo yet.",
    "loadMore": "Load more",
    "errorTitle": "Failed to load history",
    "errorBody": "Could not load multi-agent run history.",
    "columns": {
      "pr": "PR",
      "agents": "Agents",
      "status": "Status",
      "cost": "Cost",
      "duration": "Duration",
      "ranAt": "Run at"
    },
    "status": {
      "running": "Running",
      "done": "Done",
      "failed": "Failed"
    }
  }
  ```

- [ ] `client/src/app/multi-runs/page.tsx` — NEW thin RSC page (no params needed; `MultiRunHistoryView` reads repo from context):

  ```tsx
  /* Multi-Agent Review history page — /multi-runs.
     Thin page: no params/searchParams needed. MultiRunHistoryView reads active repo from context. */

  import { MultiRunHistoryView } from "./_components/MultiRunHistoryView";

  export default function MultiRunsPage() {
    return <MultiRunHistoryView />;
  }
  ```

- [ ] `client/src/app/multi-runs/_components/MultiRunHistoryView/MultiRunHistoryView.tsx` — NEW `"use client"` component. Key behaviors:

  - Crumb: `[{ label: "Multi-Agent Review", href: "/multi-runs" }]` (single level — this IS the list page).
  - Repo picker: copy of `ConfigureRunView.tsx` lines 208-219: `useActiveRepo()` for the default, `useRepos()` to populate the `<select>`, select is only shown when `repos.length > 1`. Changing the repo resets `currentOffset` to 0 and clears `allItems`.
  - Pagination state: `const LIMIT = 20`, `const [currentOffset, setCurrentOffset] = React.useState(0)`, `const [allItems, setAllItems] = React.useState<MultiRunSummary[]>([])`.
  - Query: `const { data, isLoading, isError } = useMultiRuns(selectedRepoId, { limit: LIMIT, offset: currentOffset })`.
  - Items accumulation via `useEffect` on `[data, currentOffset]`: when `currentOffset === 0`, replace `allItems` with `data.items`; otherwise append. This handles both initial load and repo-change reset (repo change always resets `currentOffset` to 0, which triggers the replace branch).
  - Render branches (early returns): loading first page (`isLoading && allItems.length === 0`), error, empty state (`allItems.length === 0` after load), normal table.
  - Table: header row (`t("history.columns.pr")`, `.agents`, `.status`, `.cost`, `.duration`, `.ranAt`). Each run row: PR number + title or fallback, agent count, status badge (`t("history.status.running/done/failed")`), `total_cost_usd` formatted as `$X.XXXX` (null shown as `—`), `total_duration_ms` formatted as `Xs` (null shown as `—`), `ranAt` as `new Date(item.ran_at).toLocaleString()`. Entire row is clickable: `onClick={() => router.push(\`/multi-runs/${item.id}\`)}`.
  - Page header: `<h1>{t("history.title")}</h1>` on left; "Configure run" primary `<button>` on right that calls `router.push(\`/multi-runs/configure?repoId=${selectedRepoId ?? ''}\`)`.
  - Load more: `{allItems.length < (data?.total ?? 0) && !isLoading && <button onClick={() => setCurrentOffset(prev => prev + LIMIT)}>{t("history.loadMore")}</button>}`.
  - Empty state: `t("history.emptyTitle")`, `t("history.emptyBody")`, "Configure run" link button.
  - Style conventions: inline `style` objects using `CSSProperties` with `satisfies` (matching `ConfigureRunView.tsx` pattern), or extracted to `styles.ts`.

- [ ] `client/src/app/multi-runs/_components/MultiRunHistoryView/index.ts` — NEW barrel:

  ```typescript
  export { MultiRunHistoryView } from './MultiRunHistoryView';
  ```

- [ ] `client/src/app/multi-runs/_components/MultiRunHistoryView/styles.ts` — NEW (recommended). Extract `s.page`, `s.heading`, `s.tableCard`, `s.headRow`, `s.headCell`, `s.dataRow`, `s.dataCell`, `s.configureBtn` style objects here. Follows the pattern of `client/src/app/repos/[repoId]/pulls/styles.ts`.

- [ ] `client/src/app/multi-runs/_components/MultiRunHistoryView/MultiRunHistoryView.test.tsx` — NEW RTL tests. Required:
  - Renders `"Multi-Agent Review"` heading.
  - Repo `<select>` is NOT rendered when `useRepos` returns a single repo.
  - Repo `<select>` IS rendered when `useRepos` returns two repos.
  - Shows empty-state title when `useMultiRuns` returns `{ items: [], total: 0 }`.
  - Renders one row per item when data is returned (verify PR number and status text visible).
  - "Configure run" button href includes the active `repoId`.
  - "Load more" button is visible when `total > items.length`; hidden when `total === items.length`.
  - Clicking a row calls `router.push` with `/multi-runs/:id`.
  - `vi.mock('@/lib/hooks/multi-runs', ...)`, `vi.mock('@/lib/hooks', ...)`, `vi.mock('@/lib/repo-context', ...)`.

- [ ] `client/src/vendor/ui/nav.ts` — line 43: change the `href` for the `"multi-agent"` nav item from `"/multi-runs/configure"` to `"/multi-runs"`. No other field changes.

- [ ] `client/src/app/multi-runs/configure/_components/ConfigureRunView/ConfigureRunView.tsx` — update `crumb` at line 317. Change from one level to two:

  ```typescript
  // Before:
  const crumb = [{ label: "Multi-Agent Review", href: "/multi-runs/configure" }];

  // After:
  const crumb = [
    { label: "Multi-Agent Review", href: "/multi-runs" },
    { label: "Configure run" },
  ];
  ```

- [ ] `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/MultiRunResultsView.tsx` — update `crumb` href at line 25 AND in the loading-state render branch (line 94) AND in the error-state render branch (line 129). All three must change from `"/multi-runs/configure"` to `"/multi-runs"`:

  ```typescript
  // Before (all three occurrences):
  const crumb = [{ label: "Multi-Agent Review", href: "/multi-runs/configure" }];

  // After (all three occurrences):
  const crumb = [{ label: "Multi-Agent Review", href: "/multi-runs" }];
  ```

---

## Gotchas

- **Migrations never auto-run.** Phase 1 must run `pnpm db:generate` then `pnpm db:migrate` before any integration test in Phase 2. The `repository.it.test.ts` integration tests start their own Postgres via testcontainers and apply migrations — the committed migration file must exist before those tests can run.
- **`COUNT(*) OVER()` returns a bigint string from Postgres.** `rows[0]?.total` must be coerced with `Number(...)` in the service — the TypeScript annotation `sql<number>` is compile-time only; the runtime value is a string. `prior-prs/service.ts:29` documents this exactly.
- **`vendor/shared/` is a manual mirror.** If `server/src/vendor/shared/contracts/observability.ts` is edited and `client/src/vendor/shared/contracts/observability.ts` is not updated, `pnpm typecheck` in the client will fail with "Cannot find name 'MultiRunSummary'".
- **`z.coerce` on querystring numbers is mandatory.** Without it, `req.query.limit` arrives as the string `"20"` and Zod rejects it as not a number. The existing querystring number params in the codebase (e.g. eval routes) all use `z.coerce`.
- **`nav.ts` is in `client/src/vendor/ui/`** — this edit is a deliberate exception. Only the `href` field of the `"multi-agent"` entry changes. The active-match logic in `client/src/components/app-shell/helpers.ts:28` already uses `pathname.startsWith("/multi-runs")` covering all three sub-routes — no change to `helpers.ts` is needed.
- **`MultiRunResultsView.tsx` has three `crumb` declarations** (one at line 25 for the normal render, one at line 94 inside the loading early return, one at line 129 inside the error early return). All three must be updated, or the breadcrumb will show the old href in loading/error states.
- **Test fixtures for `MultiRunSummary` must include `total_cost_usd` and `total_duration_ms`** as `null` (not `undefined`) — they are `.nullable()` not `.nullish()`. Passing `undefined` will cause TS2741 when the fixture is typed against `MultiRunSummary`.
- **`db/schema/` must never be hand-edited for migration SQL.** Only the `runs.ts` schema file changes (adding the index call); `pnpm db:generate` produces the migration SQL.

## Definition of done

- [ ] `cd server && pnpm test` passes (unit + integration suites).
- [ ] `cd client && pnpm test` passes.
- [ ] `cd server && pnpm typecheck` reports no errors.
- [ ] `cd client && pnpm typecheck` reports no errors.
- [ ] `cd server && pnpm db:generate` produces no new migration (schema is in sync with what was generated in Phase 1).
- [ ] Manual: click "Multi-Agent Review" in the sidebar — the history page loads at `/multi-runs` and the sidebar item is highlighted (active state).
- [ ] Manual: trigger a multi-run, navigate away, click "Multi-Agent Review" — the finished run appears in the list with correct PR title, agent count, status, cost, and duration.
- [ ] Manual: click a run row — navigates to `/multi-runs/:id` and loads the results view correctly.
- [ ] Manual: "Configure run" button on the history page links to `/multi-runs/configure?repoId=...` and pre-selects the correct repo.
- [ ] Manual: "Load more" appears when more than 20 runs exist; clicking it appends the next page without replacing the first 20.
- [ ] Manual: the repo switcher (shown only when >1 repo) changes the list; offset resets to 0.
- [ ] Manual: breadcrumbs — Configure run page shows "Multi-Agent Review > Configure run"; Results page shows "Multi-Agent Review" linking back to `/multi-runs`.
- [ ] Manual: sidebar "Multi-Agent Review" item is active on all three routes (`/multi-runs`, `/multi-runs/configure`, `/multi-runs/:id`).
