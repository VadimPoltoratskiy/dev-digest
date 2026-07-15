# Multi-Agent Review — client routes and components

## Overview

The multi-agent review feature adds three Next.js routes under `app/multi-runs/`:
a **History** page listing past runs for the selected repo, a **Configure Run**
page where the user picks a PR and selects agents, and a **Results** page that
shows per-agent findings side-by-side plus a cross-agent "Where agents disagree"
conflicts view. It also promoted two previously route-local components
(`RunTraceDrawer`, `FindingCard`) to `components/` because the Results page needs
them alongside the existing PR detail page.

All three pages render inside `AppShell` so the left sidebar appears in all render
states (loading, error, and normal). The sidebar nav link
(`client/src/vendor/ui/nav.ts:43`) now points to `/multi-runs` (the history page),
and `activeKeyFor` (`client/src/components/app-shell/helpers.ts:28`) highlights the
nav item for all `/multi-runs/*` paths.

**Breadcrumbs:** the History page shows a single crumb (`Multi-Agent Review` with
`href: "/multi-runs"`). The Configure Run page shows two levels (`Multi-Agent
Review → Configure run`), with the second level carrying no `href` since it is the
current page. The Results page shows a single crumb (`Multi-Agent Review`) linking
back to `/multi-runs`.

## Route map

```mermaid
flowchart TD
  PR["/repos/:repoId/pulls/:number<br/>PR detail page"]
  HIST["/multi-runs<br/>History page"]
  CFG["/multi-runs/configure?prId=<uuid><br/>Configure Run page"]
  RES["/multi-runs/:multiRunId<br/>Results page"]

  PR -->|"Click 'Run with multiple agents'"| CFG
  HIST -->|"Click 'Configure run'"| CFG
  CFG -->|"POST /pulls/:id/multi-review → redirect"| RES
  RES -->|"Breadcrumb: Multi-Agent Review"| HIST

  HIST -->|"GET /multi-runs?repoId=&limit=&offset="| API[("Fastify API :3001")]
  CFG -->|"GET /pulls/:id/agents/estimates"| API
  RES -->|"GET /multi-runs/:id"| API
  RES -->|"GET /multi-runs/:id/findings"| API
  RES -->|"GET /runs/:id/events (SSE, per agent)"| API
```

## History page (`/multi-runs`)

**Files:**
- `client/src/app/multi-runs/page.tsx` — thin RSC; no params or searchParams
  needed; renders `MultiRunHistoryView`.
- `client/src/app/multi-runs/_components/MultiRunHistoryView/MultiRunHistoryView.tsx`
  (1–224)

**Repo picker (`MultiRunHistoryView.tsx:23-35, 122-135`):** initializes
`selectedRepoId` from `useActiveRepo()` once on first render, guarded by a
`didInitRepo` ref to prevent resetting on every re-render. `useRepos()` supplies
the dropdown options; the `<select>` is only rendered when `repos.length > 1`.
Changing the repo resets `currentOffset` to 0 and clears `allItems`, which causes
the accumulation effect (see below) to issue a fresh first-page fetch.

**Pagination (`MultiRunHistoryView.tsx:38-57`):** `LIMIT = 20`, with `currentOffset`
and `allItems` held in component state. `useMultiRuns(selectedRepoId, { limit:
LIMIT, offset: currentOffset })` drives the query. A `useEffect` on
`[data, currentOffset]` accumulates pages: when `currentOffset === 0` it replaces
`allItems` with `data.items` (initial load or repo-change reset); otherwise it
appends. This approach avoids `useInfiniteQuery` to keep the hook API consistent
with the other hooks in `multi-runs.ts`.

**Loading state (`MultiRunHistoryView.tsx:70-82`):** early return when
`isLoading && allItems.length === 0` — suppresses the skeleton only on the first
page; subsequent Load More requests show the already-accumulated rows while waiting.

**Error state (`MultiRunHistoryView.tsx:84-99`):** early return when `isError`;
renders `t("history.errorTitle")` and `t("history.errorBody")`.

**Page header (`MultiRunHistoryView.tsx:106-119`):** `<h1>{t("history.title")}</h1>`
on the left; a primary "Configure run" button on the right that navigates to
`/multi-runs/configure?repoId=${selectedRepoId}`.

**Table (`MultiRunHistoryView.tsx:156-207`):** six columns — PR, Agents, Status,
Cost, Duration, Run at. PR cell shows `#{number} · {title}` when `pr_number` is
non-null, falling back to the raw `pr_id`. Status cell renders
`t("history.status.running/done/failed")`. Cost cell renders `$X.XXXX` via the
`history.costValue` i18n key, or the `history.emptyValue` placeholder when
`total_cost_usd` is null. Duration cell renders `Xs` via `history.durationValue`
(rounding `total_duration_ms` to seconds), or the placeholder when null. Run at
renders `new Date(item.ran_at).toLocaleString()`. The entire row is clickable and
navigates to `/multi-runs/${item.id}`.

**Empty state (`MultiRunHistoryView.tsx:138-153`):** shown when `allItems.length === 0`
after the query resolves without error. Renders `t("history.emptyTitle")`,
`t("history.emptyBody")`, and a "Configure run" link button.

**Load more button (`MultiRunHistoryView.tsx:209-218`):** visible when
`allItems.length < (data?.total ?? 0) && !isLoading`. Clicking it increments
`currentOffset` by `LIMIT`, which triggers a new query and then the append branch
of the accumulation effect.

## Configure Run page (`/multi-runs/configure`)

**Files:**
- `client/src/app/multi-runs/configure/page.tsx` — thin RSC; awaits async
  `searchParams` (Next.js 15 async API) and renders `ConfigureRunView`.
- `client/src/app/multi-runs/configure/_components/ConfigureRunView/ConfigureRunView.tsx`

**Props:** `initialPrId?: string` — pre-seeds the PR selector when the page is
opened with `?prId=<uuid>` from the PR detail page.

**Two-step flow (`ConfigureRunView.tsx:200-477`):**

1. **PR selection** — repo picker (only shown when the workspace has more than one
   repo) + PR dropdown. Changing the repo resets both the PR and agent selections.
   A muted warning appears (non-blocking) when the selected PR is merged or closed.

2. **Agent cards** — rendered only after a PR is selected. Calls
   `useAgentEstimates(selectedPrId)` (`lib/hooks/multi-runs.ts:18-24`), which hits
   `GET /pulls/:id/agents/estimates`. Each card shows:
   - Agent name.
   - `last_finding_summary` — the most recent review summary for this agent
     (rendered as plain text; never `dangerouslySetInnerHTML`).
   - Estimated duration and cost averaged over the last 10 completed runs; shows
     "No history" when `has_historical_data` is false.
   - A checkbox + full-card click target for selection.
   - A "Select all" checkbox with indeterminate state when partially selected.

**Footer aggregate estimates (`helpers.ts:1-38`):**
- `computeAggregateDuration` — `max(estimated_duration_ms)` over selected agents,
  reflecting parallel execution.
- `computeAggregateCost` — `sum(estimated_cost_usd)` over selected agents.
- Returns `null` (not shown) when no agent has historical data.

**Submit (`ConfigureRunView.tsx:290-297`):** calls `useRunMultiReview().mutateAsync`
which POSTs `{ agentIds }` to `/pulls/:id/multi-review`, then navigates to
`/multi-runs/${res.multi_run_id}`.

## Results page (`/multi-runs/:multiRunId`)

**Files:**
- `client/src/app/multi-runs/[multiRunId]/page.tsx` — thin RSC; awaits async
  `params` and renders `MultiRunResultsView`.
- `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/MultiRunResultsView.tsx`

**Data fetching (`MultiRunResultsView.tsx:30-44`):**
- `useMultiRun(multiRunId)` — polls `GET /multi-runs/:id` for agent statuses and
  totals.
- `useMultiRunFindings(multiRunId)` — fetches `GET /multi-runs/:id/findings` for
  per-agent findings lists and cross-agent groups.

**Live SSE streaming (`MultiRunResultsView.tsx:36-62`):** while any agent has
`status === "running"`, the component subscribes to `useRunEvents(activeRunIds)`
which opens one SSE connection per active run (`GET /runs/:id/events`). The last
event `kind` for each run is stored in `sseStatuses` and passed to the view
components for live status text. When all SSE streams close (all agents done or
failed), the component invalidates the `["multi-run", multiRunId]` TanStack Query
key to fetch final statuses.

**View modes (`MultiRunResultsView.tsx:68`):** the user toggles between `"columns"`
and `"tabs"` via buttons in `MultiRunHeader`. Both modes receive the same
`agents[]`, `agentFindings[]`, and `sseStatuses` props.

### Sub-components of the Results page

**`MultiRunHeader`** (`_components/MultiRunHeader/MultiRunHeader.tsx:9-91`):
Breadcrumb that renders `#{number} · {title}` when both `prNumber` and `prTitle`
are available, falling back to `#{number}` or the i18n key `results.title` when
either is absent (`MultiRunHeader.tsx:41-46`). Includes a "Configure Run" link
(pre-fills `?prId=<prId>`), Columns/Tabs toggle buttons, and — when all agents are
complete — a right-aligned `statsBlock` containing wall time and cost that appears
in the actions row alongside the toggle buttons (`MultiRunHeader.tsx:54-59`). An
agent-count summary line renders below the breadcrumb unconditionally
(`MultiRunHeader.tsx:86-88`).

**`ColumnsView`** (`_components/ColumnsView/ColumnsView.tsx:19-114`):
Horizontal-scrollable grid of agent columns. Each column carries a distinct
left-border accent color drawn from the `AGENT_COLORS` constant array
(`ColumnsView.tsx:10-17`) and applied by index, making agents visually
distinguishable at a glance (`ColumnsView.tsx:60`). Each column shows the agent
name, live SSE status or final status badge, score rendered as a circular badge,
finding count, a compact list of finding titles (file + title), and a "View trace"
button that opens `RunTraceDrawer`. Builds a `run_id → findings[]` map in a
`useMemo` by matching `agent_id + agent_name` between `agents[]` and
`agentFindings[]`.

**`TabsView`** (`_components/TabsView/TabsView.tsx:15-169`):
Tab bar (one tab per agent) with a summary card for the active agent and a full
`FindingCard` list (from `components/FindingCard`). Duration and cost appear in
the summary card when the agent is done. Failing agents show their `error` string.

**`ConflictsSection`** (`_components/ConflictsSection/ConflictsSection.tsx:29-108`):
"Where agents disagree" panel below both view modes. Renders every `FindingGroup`
from `GET /multi-runs/:id/findings`. A toggle switch filters to conflict-only
groups. A group is a conflict when `isConflict` returns true — defined as two or
more distinct verdict values across `agent_verdicts`, where `null` maps to
`"did_not_flag"` and any non-null finding maps to its `severity` string
(`ConflictsSection.tsx:21-27`).

## Shared components promoted from the PR detail route

`RunTraceDrawer` and `FindingCard` were previously colocated under
`app/repos/[repoId]/pulls/[number]/_components/`. They are now at:

- `client/src/components/RunTraceDrawer/`
- `client/src/components/FindingCard/`

**Why they moved:** the Results page (`TabsView`, `MultiRunResultsView`) consumes
both components. Once a component is used by two or more routes it belongs in
`components/` per the project's placement decision tree. The PR detail route
imports them from the new shared location (`pulls/[number]/page.tsx:18`,
`FindingsPanel/FindingsPanel.tsx:9`).

### `RunTraceDrawer` (`components/RunTraceDrawer/RunTraceDrawer.tsx`)

A 720 px side drawer with two tabs — Trace and Live log.

**Props (`RunTraceDrawer.tsx:19-29`):**
```typescript
interface RunTraceDrawerProps {
  runId: string;
  agentName?: string | null;
  prNumber?: number | null;
  findings?: FindingRecord[];
  running?: boolean;   // defaults false; true → starts on Live log tab + streams SSE
  onClose: () => void;
}
```

- When `running=true`, the Live-log tab streams SSE via `useRunEvents([runId])`.
- The Trace tab loads the persisted single-document run trace via `useRunTrace(runId)`
  once `stillRunning` becomes false.
- The footer "Copy raw output" button copies `trace.raw_output` to the clipboard,
  with a 1.5 s visual confirmation (`RunTraceDrawer.tsx:54-59`).
- Default export (not named export) so the PR detail page can import it directly.

The Results page (`MultiRunResultsView`) opens the drawer without `findings` or
`running` props — it passes only `runId` and `agentName`, which is sufficient for
viewing historical traces.

### `FindingCard` (`components/FindingCard/FindingCard.tsx`)

Renders one `FindingRecord` with severity badge, category tag, file:line link,
confidence number, markdown rationale, optional suggestion, and accept/dismiss/
reply/create-eval-case actions.

**Props (`FindingCard.tsx:29-47`):**
```typescript
function FindingCard({
  f: FindingRecord;
  focused?: boolean;
  defaultExpanded?: boolean;
  onAction?: (action: FindingActionKind, reply?: string) => void;
  onCreateEvalCase?: (kind: "must_find" | "must_not_flag", name: string) => void;
  pending?: boolean;
  evalCasePending?: boolean;
  repoFullName?: string | null;
  headSha?: string | null;
}): JSX.Element
```

`TabsView` passes the full prop set to each card, mirroring the wiring in
`FindingsPanel`. It calls `useFindingAction()`, `useTurnFindingIntoEvalCase()`,
`useActiveRepo()`, and `usePullDetail(prId)` unconditionally before its early-return
guard (`TabsView.tsx:36-40`), then threads `pending`, `evalCasePending`,
`repoFullName` (`activeRepo?.full_name`), `headSha` (`pr?.head_sha`), `onAction`,
and `onCreateEvalCase` into each card (`TabsView.tsx:142-164`). On a successful
action, `onAction` invalidates the `["multi-run-findings", multiRunId]` query key.
`TabsViewProps` carries two required props to support this — `prId` and `multiRunId`
— threaded in from `MultiRunResultsView.tsx:158-165`.

## Data hooks (`lib/hooks/multi-runs.ts`)

| Hook | Query key | Enabled when |
|------|-----------|--------------|
| `useAgentEstimates(prId)` | `["agent-estimates", prId]` | `prId != null` |
| `useRunMultiReview()` | mutation (no cache key) | always |
| `useMultiRun(multiRunId)` | `["multi-run", multiRunId]` | `multiRunId != null` |
| `useMultiRunFindings(multiRunId)` | `["multi-run-findings", multiRunId]` | `multiRunId != null` |
| `useMultiRuns(repoId, { limit, offset })` | `["multi-runs", repoId, limit, offset]` | `repoId != null` |

All five call functions from `lib/api.ts` (lines 204–239). Pass `null` to disable
a query before the ID is known (lazy-fetch-on-open pattern).

## Related files

| File | Lines | Purpose |
|------|-------|---------|
| `client/src/app/multi-runs/page.tsx` | 1–7 | Thin RSC; no params; renders `MultiRunHistoryView`. |
| `client/src/app/multi-runs/_components/MultiRunHistoryView/MultiRunHistoryView.tsx` | 1–224 | History list: repo picker, offset pagination, run table, empty/loading/error states. |
| `client/src/app/multi-runs/configure/page.tsx` | 1–13 | Thin RSC; reads `searchParams.prId`; renders `ConfigureRunView`. |
| `client/src/app/multi-runs/configure/_components/ConfigureRunView/ConfigureRunView.tsx` | 1–477 | Two-step configure UI: PR picker + agent cards + aggregate estimate footer. |
| `client/src/app/multi-runs/configure/_components/ConfigureRunView/helpers.ts` | 1–38 | Pure `computeAggregateDuration` (max) and `computeAggregateCost` (sum). |
| `client/src/app/multi-runs/[multiRunId]/page.tsx` | 1–13 | Thin RSC; reads `params.multiRunId`; renders `MultiRunResultsView`. |
| `client/src/app/multi-runs/[multiRunId]/_components/MultiRunResultsView/MultiRunResultsView.tsx` | 1–194 | Orchestrator: data fetching, SSE fan-in, view mode toggle, drawer state. `AppShell` wraps all render branches (loading, error, normal). |
| `client/src/app/multi-runs/[multiRunId]/_components/MultiRunHeader/MultiRunHeader.tsx` | 1–91 | Breadcrumb (with PR title when available), Configure Run link, Columns/Tabs toggle, right-aligned stats block when complete, agent-count line. |
| `client/src/app/multi-runs/[multiRunId]/_components/ColumnsView/ColumnsView.tsx` | 1–114 | Horizontal per-agent column grid; per-agent left-border accent color from `AGENT_COLORS`; inline finding title list + View trace button. |
| `client/src/app/multi-runs/[multiRunId]/_components/TabsView/TabsView.tsx` | 1–169 | Tab-per-agent view; renders full `FindingCard` list for the active tab. |
| `client/src/app/multi-runs/[multiRunId]/_components/ConflictsSection/ConflictsSection.tsx` | 1–108 | "Where agents disagree" panel; toggle for conflicts-only filter; `isConflict` predicate. |
| `client/src/components/RunTraceDrawer/RunTraceDrawer.tsx` | 1–107 | Shared trace + live-log drawer; consumed by PR detail page and Results page. |
| `client/src/components/FindingCard/FindingCard.tsx` | 1–196 | Shared finding card; consumed by PR detail `FindingsPanel` and multi-run `TabsView`. |
| `client/src/lib/hooks/multi-runs.ts` | 1–72 | TanStack Query hooks: `useAgentEstimates`, `useRunMultiReview`, `useMultiRun`, `useMultiRunFindings`, `useMultiRuns`. |
| `client/src/lib/api.ts` | 204–239 | API fetch functions: `fetchAgentEstimates`, `triggerMultiReview`, `fetchMultiRun`, `fetchMultiRunFindings`, `fetchMultiRuns`. |
| `client/src/vendor/ui/nav.ts` | 43 | Nav item: `href: "/multi-runs"` (key `"multi-agent"`). |
| `client/src/components/app-shell/helpers.ts` | 28 | `activeKeyFor`: `startsWith("/multi-runs")` returns `"multi-agent"`. |
